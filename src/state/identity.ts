import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAuthored } from '@/assets/pointer.js';
import { hashFile, type Hash } from '@/hash/content.js';
import { hashTree } from '@/hash/tree.js';
import type { Graph, Node } from '@/graph/build.js';
import type { Ledger } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';

/**
 * Resolving an identity to the hash of its CURRENT content — the `hash(resolve(input))` half
 * of the freshness check (data-model.md § Freshness). Everything here reads content and
 * nothing else: no mtime, no size, no network, no craft tool (FR-008, FR-010).
 *
 * An identity is a role, not a path. What resolving one means depends on the node's kind:
 *
 *   - authored: the declared `path`, or the `.asset` stand-in beside it.
 *   - derived:  the bytes the node's ledger record points at (`output.path`).
 *
 * The derived case reads the recorded output PATH, never the recorded `output.hash`. That
 * distinction is load-bearing: `output.hash` is the recorded claim, and comparing a recorded
 * claim against itself can only ever say "consistent". Reading the bytes is what lets an
 * edit made outside the system be seen at all — by the node itself (`modified`, FR-017a) and,
 * where the node is mid-chain, by its consumers.
 */

/** Why an identity has no current content. Distinct reasons; never collapse them. */
export type Absence =
  /** A declared (authored) or recorded (derived output) path that does not exist on disk. */
  | { readonly kind: 'path-absent'; readonly path: string }
  /** A derived node with no ledger record: it has never been built, so it has no bytes. */
  | { readonly kind: 'never-built' };

export type ContentResolution =
  | { readonly kind: 'resolved'; readonly hash: Hash }
  | { readonly kind: 'absent'; readonly absence: Absence };

export interface ResolutionContext {
  /** Every declared and recorded path is interpreted relative to this directory. */
  readonly episodeDir: string;
  readonly graph: Graph;
  readonly ledger: Ledger;
}

export interface ContentResolver {
  resolve(id: Identity): Promise<ContentResolution>;
}

/**
 * Builds a resolver over one episode, memoizing per identity. The memo is a correctness
 * convenience only — resolution is a pure read, so a cached answer and a recomputed one are
 * the same answer — but a mid-chain node is a declared input of several downstreams, and
 * rehashing its bytes once per consumer is wasted work on a command whose whole promise is
 * that it answers instantly (FR-010).
 *
 * The cache holds the in-flight Promise rather than the settled value, so concurrent callers
 * asking for the same identity share one hash rather than racing to duplicate it.
 */
export function createContentResolver(context: ResolutionContext): ContentResolver {
  const cache = new Map<Identity, Promise<ContentResolution>>();

  return {
    resolve(id: Identity): Promise<ContentResolution> {
      const cached = cache.get(id);
      if (cached !== undefined) {
        return cached;
      }
      const pending = resolveUncached(context, id);
      cache.set(id, pending);
      return pending;
    },
  };
}

async function resolveUncached(
  context: ResolutionContext,
  id: Identity
): Promise<ContentResolution> {
  const node = context.graph.nodes.get(id);
  if (node === undefined) {
    const known = [...context.graph.nodes.keys()].join(', ');
    throw new Error(
      `Cannot resolve identity "${id}": it is not a node in this episode's graph. ` +
        `Known identities: ${known || '(none)'}.`
    );
  }
  return node.kind === 'authored'
    ? resolveAuthoredNode(context, node)
    : resolveDerivedNode(context, node);
}

async function resolveAuthoredNode(
  context: ResolutionContext,
  node: Node
): Promise<ContentResolution> {
  const declaredPath = node.path;
  if (declaredPath === undefined) {
    throw new Error(
      `Authored node "${node.id}" has no declared path. Every authored node carries one; ` +
        `a node without it cannot be resolved and must not be treated as absent.`
    );
  }

  const resolution = await resolveAuthored(path.join(context.episodeDir, declaredPath));

  if (resolution.kind === 'absent') {
    return { kind: 'absent', absence: { kind: 'path-absent', path: declaredPath } };
  }

  // FR-025: the stand-in IS the content address. The store is never contacted to answer
  // "what is this input's hash" — that is exactly what lets status run offline.
  if (resolution.kind === 'pointer') {
    return { kind: 'resolved', hash: resolution.pointer.asset };
  }

  return { kind: 'resolved', hash: await hashPath(resolution.path) };
}

async function resolveDerivedNode(
  context: ResolutionContext,
  node: Node
): Promise<ContentResolution> {
  const record = context.ledger.artifacts[node.id];
  if (record === undefined) {
    return { kind: 'absent', absence: { kind: 'never-built' } };
  }

  const recordedPath = record.output.path;
  const hash = await hashPathIfExists(path.join(context.episodeDir, recordedPath));
  if (hash === null) {
    return { kind: 'absent', absence: { kind: 'path-absent', path: recordedPath } };
  }
  return { kind: 'resolved', hash };
}

/**
 * Hashes whatever is at `fullPath`: a directory tree via `hashTree`, a file via `hashFile`.
 *
 * The `stat` here asks exactly one question — file or directory — and reads nothing else off
 * the result. In particular it never looks at mtime: a `touch` must not change any answer
 * this module gives (FR-008).
 */
async function hashPath(fullPath: string): Promise<Hash> {
  const stats = await fs.stat(fullPath);
  return stats.isDirectory() ? hashTree(fullPath) : hashFile(fullPath);
}

/** `hashPath`, but `null` when the path does not exist. Any other stat failure still throws. */
async function hashPathIfExists(fullPath: string): Promise<Hash | null> {
  try {
    return await hashPath(fullPath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ('code' in error && error.code === 'ENOENT') {
    return true;
  }
  // hashFile/hashTree wrap the underlying error rather than rethrowing it, so the ENOENT is
  // one level down. Unwrapping is the only way to tell "not built yet" from a real I/O fault,
  // and collapsing the two would report a broken disk as an absent artifact.
  return error.cause !== undefined && isNotFound(error.cause);
}

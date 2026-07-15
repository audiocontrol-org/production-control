import * as path from 'node:path';
import { resolveAuthored } from '@/assets/pointer.js';
import { type Hash } from '@/hash/content.js';
import { hashPath } from '@/hash/path.js';
import type { Graph, Node } from '@/graph/build.js';
import type { Ledger } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';

/**
 * Resolving an identity to the hash of its CURRENT content — the `hash(resolve(input))` half
 * of the freshness check (data-model.md § Freshness). Everything here reads content and a
 * committed record, and nothing else: no mtime, no size, no network, no craft tool (FR-008,
 * FR-010).
 *
 * An identity is a role, not a path. What resolving one means depends on the node's kind:
 *
 *   - authored: the declared `path`, or the `.asset` stand-in beside it.
 *   - derived:  the hash its own ledger record claims for its output (`output.hash`).
 *
 * **The derived case reads `output.hash`, not the bytes at `output.path`.** That is not a
 * record agreeing with itself. The comparison a consumer makes is between PODCAST's record of
 * voiceover (`artifacts[podcast].inputs.voiceover`) and VOICEOVER's record of itself
 * (`artifacts[voiceover].output.hash`) — two different records, written at two different
 * builds. Rebuilding voiceover rewrites voiceover's record; podcast's copy then no longer
 * matches and podcast goes `stale` of its own accord. That is the main case, and it is exactly
 * how transitive staleness stays emergent rather than propagated (FR-009).
 *
 * Hashing the bytes here instead would blame the wrong node. `dist/` is not committed, so a
 * fresh clone — and a routine `rm -rf dist` — has no built artifacts. Reading `output.path`
 * would make podcast report `blocked` on "voiceover's bytes are absent", when the honest answer
 * is that podcast's own output simply is not built here (SC-004). One missing directory would
 * become a cascade of `blocked` pointing at innocent upstream nodes.
 *
 * An edit made outside the system is still caught, at the node whose bytes were edited:
 * `freshness.ts` compares that node's OWN output bytes against its OWN recorded hash and
 * reports `modified` (FR-017a). Downstream does not need to re-detect it by proxy, and must
 * not — reporting one cause as two symptoms, the second naming the wrong file, is worse than
 * reporting it once at the node that is actually wrong.
 */

/** Why an identity has no current content. Distinct reasons; never collapse them. */
export type Absence =
  /** A declared (authored) or recorded (derived output) path that does not exist on disk. */
  | { readonly kind: 'path-absent'; readonly path: string }
  /**
   * A derived node with no ledger record: it has never been built, so nothing has ever
   * claimed a hash for it. A consumer of it is `blocked` — its input was never built — and
   * that names the right thing, because there is genuinely no answer to inherit.
   */
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
  /**
   * The hash of an identity's current content as its CONSUMERS see it — the answer that goes
   * into the input comparison. For a derived identity this is its recorded claim; see the
   * header.
   */
  resolve(id: Identity): Promise<ContentResolution>;
  /**
   * The hash of the bytes ACTUALLY at a derived node's recorded `output.path` — the answer
   * that goes into the node's own `modified` check (FR-017a). This is the only place bytes at
   * an output path are read, and it is deliberately a separate question from `resolve`:
   * `resolve` answers "what does this node claim it produced", this answers "what is really
   * there", and comparing the two is what makes the check real rather than a record agreeing
   * with itself. Only the node's own check may ask it; nothing asks it about an input.
   */
  readOutputBytes(id: Identity): Promise<ContentResolution>;
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

    // Deliberately NOT memoized alongside `resolve`: it is a different question with a
    // different answer, and one node asks it about itself exactly once per report. Sharing
    // the memo would let one answer be served for the other — the precise confusion this
    // module exists to keep apart.
    readOutputBytes(id: Identity): Promise<ContentResolution> {
      return readOutputBytesUncached(context, id);
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

/**
 * A derived identity resolves to what its own ledger record claims it produced. No disk read
 * happens here at all — which is the point: the record is committed, `dist/` is not, so this
 * answer survives a fresh clone and keeps the provenance chain answerable with the artifacts
 * absent (SC-004). See the header for why this is a real comparison and not a tautology.
 */
function resolveDerivedNode(context: ResolutionContext, node: Node): ContentResolution {
  const record = context.ledger.artifacts[node.id];
  if (record === undefined) {
    return { kind: 'absent', absence: { kind: 'never-built' } };
  }
  return { kind: 'resolved', hash: record.output.hash };
}

/**
 * The bytes really at a derived node's recorded output path (FR-017a). Absent is not an error:
 * an unbuilt or deleted artifact is an ordinary, expected state, and the node reports it on its
 * OWN account rather than any consumer reporting it on the node's behalf.
 */
async function readOutputBytesUncached(
  context: ResolutionContext,
  id: Identity
): Promise<ContentResolution> {
  const node = context.graph.nodes.get(id);
  if (node === undefined || node.kind !== 'derived') {
    throw new Error(
      `Cannot read output bytes for "${id}": only a derived node in this episode's graph has a ` +
        `recorded output. Asking this of anything else is a programming error, not an absence.`
    );
  }

  const record = context.ledger.artifacts[id];
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
 * `hashPath` (see `@/hash/path.js` — the single place the file-or-directory rule lives, shared
 * with `providers/inputs.ts` so status and build cannot answer it differently), but `null` when
 * the path does not exist. Any other stat failure still throws.
 */
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

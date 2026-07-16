import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAuthored, type AssetPointer } from '@/assets/pointer.js';
import type { InputResolver } from '@/assets/resolve.js';
import type { Graph, Node } from '@/graph/build.js';
import { hashFile } from '@/hash/content.js';
import { hashPath } from '@/hash/path.js';
import type { Ledger } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';
import type { BuildInput } from '@/providers/contract.js';

/**
 * Resolving every declared input to a LOCAL path, before a provider is invoked (FR-030, T059).
 *
 * This is the provider boundary's load-bearing half. A provider receives paths that already
 * exist on this machine — it never fetches, never touches an asset store, and never holds a
 * credential, which is exactly what keeps every provider runnable by hand (FR-031). If that
 * resolution cannot be completed, the build REFUSES here, before anything is spawned: naming
 * what is absent is the whole contract (FR-036). Nothing in this file skips an input,
 * substitutes a default, or hands a provider a path it has not checked.
 *
 * The two kinds resolve differently, and the asymmetry mirrors `state/identity.ts`:
 *
 *   - authored: the declared path on disk, or its `.asset` stand-in.
 *   - derived:  the bytes at the path that input's OWN ledger record names.
 *
 * The hash supplied alongside each path is the hash of THE BYTES BEING HANDED OVER, computed
 * here from those bytes. That matters twice: a provider may verify what it received against it
 * (contracts/provider.md), and `pc build` records it as the input hash of the build — so the
 * record states what was actually fed in, not what something else claimed was there.
 */

export interface InputContext {
  /** Absolute. Every declared and recorded path is relative to this. */
  readonly episodeDir: string;
  readonly graph: Graph;
  readonly ledger: Ledger;
  /**
   * How a stand-in's bytes are made local (T070, FR-030). Injected — so a test needs no S3, and
   * so this module never learns what a bucket or a credential is.
   *
   * Required rather than optional, and its resolution is deliberately LAZY (see
   * `assets/config.ts`): an episode whose inputs are all ordinary files must build with no store
   * configured at all, so "no store is configured" has to surface at the moment bytes are wanted
   * rather than at the moment a build starts. An optional resolver would put that same decision
   * here, where it would read as "no resolver, no bytes, carry on" — a fallback, not a refusal.
   */
  readonly assets: InputResolver;
}

/**
 * Every declared input of `target`, keyed by identity, each resolved to a local path and the
 * hash of the bytes at it — or a throw NAMING the first input that cannot be resolved.
 *
 * Order is the declared order, so the input named in a refusal is the first one a reader would
 * look for rather than whichever lost a race.
 */
export async function resolveInputs(
  context: InputContext,
  target: Node
): Promise<Record<Identity, BuildInput>> {
  const declared = target.inputs;
  if (declared === undefined) {
    throw new Error(
      `Derived node "${target.id}" declares no inputs. Every derived node carries an inputs ` +
        `list; a node without one cannot be built.`
    );
  }

  const resolved: Record<Identity, BuildInput> = {};
  for (const identity of declared) {
    resolved[identity] = await resolveOne(context, target.id, identity);
  }
  return resolved;
}

async function resolveOne(
  context: InputContext,
  targetId: Identity,
  identity: Identity
): Promise<BuildInput> {
  const node = context.graph.nodes.get(identity);
  if (node === undefined) {
    // `validateGraph` refuses a dangling input long before this, so reaching here is a
    // programming error rather than an operator's mistake — say so rather than reporting it as
    // an ordinary absence.
    const known = [...context.graph.nodes.keys()].join(', ');
    throw new Error(
      `Cannot build "${targetId}": its declared input "${identity}" is not a node in this ` +
        `episode's graph. Known identities: ${known || '(none)'}.`
    );
  }

  return node.kind === 'authored'
    ? resolveAuthoredInput(context, targetId, node)
    : resolveDerivedInput(context, targetId, node);
}

/**
 * An authored input resolves to its declared path — or to the bytes its `.asset` stand-in
 * addresses, when one is committed beside it.
 *
 * The stand-in case is where the boundary bites. The stand-in carries a content address and
 * nothing else; if the bytes it names are not on this machine, they must be FETCHED — and
 * fetching is not something a provider may be asked to do (FR-030). So it happens HERE, through
 * an injected `InputResolver`, and what the provider receives is an ordinary local path.
 *
 * **This is the first operation that genuinely needs the bytes, and therefore the first place
 * their absence can surface** (spec § Edge Cases). `pc status` resolved the same stand-in
 * offline and answered, because the address was already in the file and reporting state needs
 * nothing more (FR-025). A build needs the actual bytes, so a store that is unreachable — or
 * that does not hold the address — is a REFUSAL here, naming the input and its content address
 * (FR-036). Never a skipped target, never a default, never a build recorded against content
 * nobody has.
 */
async function resolveAuthoredInput(
  context: InputContext,
  targetId: Identity,
  node: Node
): Promise<BuildInput> {
  const declaredPath = node.path;
  if (declaredPath === undefined) {
    throw new Error(
      `Authored node "${node.id}" has no declared path. Every authored node carries one; a node ` +
        `without it cannot be resolved to a local path for a provider.`
    );
  }

  const fullPath = path.join(context.episodeDir, declaredPath);
  const resolution = await resolveAuthored(fullPath);

  if (resolution.kind === 'absent') {
    throw new Error(
      `Cannot build "${targetId}": its declared input "${node.id}" is absent. Nothing exists at ` +
        `"${declaredPath}". Supply it — this build will not skip the target or substitute a ` +
        `default (FR-036).`
    );
  }

  if (resolution.kind === 'pointer') {
    const address = resolution.pointer.asset;
    if (!(await isFile(fullPath))) {
      // Not on this machine: fetch it. The provider still never learns the store exists (FR-030).
      const localPath = await fetchAsset(
        context,
        targetId,
        node.id,
        declaredPath,
        resolution.pointer
      );

      // The hash handed over is OBSERVED from the fetched bytes, never the address the stand-in
      // merely CLAIMS — symmetry with the beside-the-stand-in branch below, which hashes the file
      // on disk. `InputResolver` is an injected interface whose contract cannot compel every
      // implementation to verify; a resolver that returned bytes not matching the address (a
      // truncated download, a partial cache entry from an interrupted run, a store that indexes by
      // key rather than content) would otherwise have `pc build` record an input hash nothing on
      // disk matches — silent, and the exact corruption this boundary exists to refuse (FR-036,
      // AUDIT-20260716-19).
      const actual = await hashFile(localPath);
      if (actual !== address) {
        throw new Error(
          `Cannot build "${targetId}": the asset store returned bytes that are not the asset for ` +
            `its declared input "${node.id}". The stand-in addresses ${address}, but the bytes ` +
            `fetched to "${localPath}" hash to ${actual}. The store returned bytes that are not ` +
            `the asset; building would record provenance against content that does not exist ` +
            `under that address.`
        );
      }
      return { path: localPath, hash: actual };
    }

    // The bytes ARE here beside the stand-in. They are only this input if they hash to the
    // address the stand-in claims: handing a provider bytes under an address that does not
    // describe them would record a build against content nobody has.
    const actual = await hashFile(fullPath);
    if (actual !== address) {
      throw new Error(
        `Cannot build "${targetId}": the file at "${declaredPath}" does not match the asset its ` +
          `stand-in addresses. The stand-in names ${address}; the bytes on disk are ${actual}. ` +
          `One of the two is wrong, and building would record provenance against content that ` +
          `does not exist under that address.`
      );
    }
    return { path: fullPath, hash: address };
  }

  // A directory hashes to its TREE hash, a file to its content hash — `hashPath` asks that one
  // question in the one place `state/identity.ts` asks it too, so `pc status` and `pc build`
  // cannot answer it differently. What the provider receives for a directory input is the
  // DIRECTORY'S OWN PATH: it walks it itself, exactly as it would outside production-control
  // (contracts/provider.md § BuildRequest — "inputs are always local paths"; a directory is one).
  // Nothing here flattens, tars, or copies it: that would be production-control doing craft work.
  return { path: fullPath, hash: await hashPath(fullPath) };
}

/**
 * Where a fetched asset is materialized for a provider to read. Under `.production/` — beside the
 * read-through byte cache — because it is derived, disposable, and reproducible from the store.
 */
function assetDir(episodeDir: string): string {
  return path.join(episodeDir, '.production', 'assets');
}

/** The read-through cache `storeBackedResolver` keeps, per `assets/cache.ts`'s stated convention. */
export function assetCacheDir(episodeDir: string): string {
  return path.join(episodeDir, '.production', 'cache');
}

/**
 * Fetches a stand-in's bytes to a local path, or REFUSES naming the input AND its content address.
 *
 * The address is in the message because it is the only handle anyone has on bytes that are not in
 * the repo: it is what an operator greps the bucket for, what tells two people they are talking
 * about the same asset, and what distinguishes "the store is down" from "this asset was never
 * uploaded". A refusal that named only the input would send someone to look at a file that is
 * deliberately not there (FR-036).
 *
 * The underlying cause is preserved and quoted rather than replaced — "unreachable" and "not
 * found at address" are different problems with different remedies, and collapsing them into one
 * generic failure would cost the reader the only fact that tells them which they have.
 */
async function fetchAsset(
  context: InputContext,
  targetId: Identity,
  inputId: Identity,
  declaredPath: string,
  pointer: AssetPointer
): Promise<string> {
  try {
    // The materialized file must keep a meaningful extension: a provider gets only `{path, hash}`,
    // and multimedia tools detect format from the extension. The basename of the authored
    // declaration carries that type; `path.basename` strips any directory, so it cannot smuggle a
    // traversal into the destination (AUDIT-20260716-27).
    const filename = path.basename(declaredPath);
    return await context.assets.resolveToLocalPath(pointer, assetDir(context.episodeDir), filename);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot build "${targetId}": its declared input "${inputId}" is held outside version ` +
        `control as asset ${pointer.asset} (declared at "${declaredPath}"), those bytes are not ` +
        `on this machine, and they could not be obtained from the asset store — ${cause} ` +
        `A provider is never handed a store or a credential (FR-030), so the bytes must be local ` +
        `before the build runs. This build will not skip the target or substitute a default.`,
      { cause: error }
    );
  }
}

/**
 * A derived input resolves to the bytes at the path ITS OWN record names — the artifact a
 * previous build of that node produced and recorded.
 *
 * Both refusals below name the input rather than the target, because both are the input's
 * problem and both have the same remedy — build it. This is the one place a build reads an
 * upstream node's bytes: `pc status` deliberately never does (a gitignored `dist/` must not make
 * a whole chain report `blocked`), but a provider needs real bytes, so a build must have them.
 *
 * The hash supplied is of those real bytes, NOT the upstream's recorded `output.hash`. They are
 * the same thing whenever the upstream is intact, and when they differ the upstream has been
 * edited outside the system (`modified`, FR-017a) — in which case recording its record's claim
 * would state that this target was built from bytes that were never fed to the provider. The
 * record must describe what actually happened; `pc status` reports the modification on the
 * upstream's own account, where it belongs.
 */
async function resolveDerivedInput(
  context: InputContext,
  targetId: Identity,
  node: Node
): Promise<BuildInput> {
  const record = context.ledger.artifacts[node.id];
  if (record === undefined) {
    throw new Error(
      `Cannot build "${targetId}": its declared input "${node.id}" has never been built, so ` +
        `there are no bytes to build from. Build "${node.id}" first.`
    );
  }

  const recordedPath = record.output.path;
  const fullPath = path.join(context.episodeDir, recordedPath);
  if (!(await isFile(fullPath))) {
    throw new Error(
      `Cannot build "${targetId}": its declared input "${node.id}" was built and recorded, but ` +
        `its artifact is not present at "${recordedPath}" on this machine (\`dist/\` is not ` +
        `committed). Build "${node.id}" to produce it.`
    );
  }

  return { path: fullPath, hash: await hashFile(fullPath) };
}

async function isFile(fullPath: string): Promise<boolean> {
  try {
    return (await fs.stat(fullPath)).isFile();
  } catch {
    return false;
  }
}

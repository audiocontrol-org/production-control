import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TrackedCheck } from '@/assets/git-tracked.js';
import type { InputResolver } from '@/assets/resolve.js';
import type { Graph, Node } from '@/graph/build.js';
import type { ArtifactRecord, Ledger } from '@/ledger/schema.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
import type { Identity, ProviderDecl } from '@/manifest/schema.js';
import type { BuildImpure, BuildInput, BuildResponse } from '@/providers/contract.js';
import { resolveInputs } from '@/providers/inputs.js';
import { invokeProvider, type ProducedOutput } from '@/providers/invoke.js';
import type { ProviderRunner } from '@/providers/run.js';
import { classifyZone, impureOutputRoot, pureOutputRoot, zoningRefusal } from '@/zoning/index.js';

/**
 * **Building an output and recording its origin, as ONE INDIVISIBLE ACT** (FR-014, T059/T060).
 *
 * This is the requirement the whole system is built around, and the guarantee it makes is not
 * that recording is *enabled by default* — it is that **there is no alternative path**. There is
 * no `--no-record` flag, no separate `record` verb, no "build only" mode, and no seam here that
 * could be composed into one. `buildTarget` resolves, invokes, hashes, ingests, and records, or
 * it throws. Nothing else is exported, so nothing else can be called.
 *
 * Do not add one. An unrecorded artifact is indistinguishable from a fabricated one — an
 * operator holding a file nobody can say the origin of is holding a rumour — and a system that
 * offers the option will eventually be run with it.
 *
 * The order below is the contract's (contracts/provider.md § What production-control does with
 * the response), and each step exists to keep the next honest:
 *
 *   1. Resolve every input to a local path, or REFUSE naming it (FR-030, FR-036). Before the
 *      spawn: a provider must never be started against a world that is not ready for it.
 *   2. Invoke the provider into a fresh, empty `output_dir`.
 *   3. Hash the produced output HERE, never trusting the provider's word for it.
 *   4. STAGE the bytes to a temp sibling under `dist/` — off to the side, NOT yet their final path.
 *   5. Write the record: inputs as SUPPLIED, tool as REPORTED, output hash as COMPUTED.
 *   6. COMMIT the bytes with a single atomic `rename` into their final `dist/` location.
 *
 * A failure at any step throws. Steps 4–6 are ordered so the VISIBLE artifact changes LAST and
 * ATOMICALLY. A failure before step 6 leaves the previous artifact bytes exactly where they were
 * and discards the staged copy — the new bytes never overwrite the old where a reader could observe
 * a half-done state. The one interruptible window is the single rename in step 6: an interrupt
 * there can leave the freshly written record (`H_new`) beside the previous bytes (`H_old`), which
 * `src/state/modified.ts` reports as a divergence and a rerun repairs — but the bytes on disk are
 * never a partial file, and the record is never stranded over bytes it does not describe.
 *
 * This is why step 4 does NOT `copyFile` straight onto the final `dist/` path (the prior shape,
 * AUDIT-20260716-14): doing so overwrote the visible artifact BEFORE the record existed, so a record
 * failure (readLedger throwing, writeLedger hitting ENOSPC/EPERM, an interrupt) left the ledger
 * asserting `H_old` for bytes already replaced with `H_new` — the ledger claiming an origin for
 * bytes that are not the bytes on disk. So it is NOT true that a failure leaves the artifact bytes
 * untouched only because the record is written last; it is true because the bytes are not made
 * visible until after the record lands (FR-017).
 */

export interface BuildContext {
  /** Absolute. Every declared and recorded path is relative to this. */
  readonly episodeDir: string;
  readonly graph: Graph;
  readonly ledger: Ledger;
  readonly runner: ProviderRunner;
  /**
   * How a stand-in's bytes are made local, before a provider is spawned (FR-030). See
   * `InputContext.assets` — this is the same seam, and step 1 below is where it is used.
   */
  readonly assets: InputResolver;
  /**
   * Whether an authored input path is tracked by version control (FR-026). Passed straight to
   * `resolveInputs` (`InputContext.tracked`) — the build path is where the FR-026 refusal belongs,
   * and where git is available. Injected at the CLI boundary as `gitTrackedCheck()`; a test passes
   * a stub or `untrackedCheck()`.
   */
  readonly tracked: TrackedCheck;
  /**
   * `built_at`, ISO-8601 UTC. Injected because a clock is a seam — and because reading one in
   * here would put a timestamp inside the module that must never decide on one (research R7).
   * It is RECORDED and never read back by any decision: nothing in `src/state/` looks at it.
   */
  readonly at: string;
}

/**
 * Builds `id` and records it, returning the record that landed.
 *
 * Throws — naming what failed — if the target is not buildable, an input cannot be resolved,
 * the provider fails or misbehaves, or the ingest cannot be completed. In every one of those
 * cases the ledger is untouched.
 */
export async function buildTarget(context: BuildContext, id: Identity): Promise<ArtifactRecord> {
  const node = derivedNode(context.graph, id);
  const decl = providerOf(node);

  const inputs = await resolveInputs(context, node);

  // Inside `dist/` (already gitignored) and named for the target, so two builds cannot collide
  // and a crash leaves its debris somewhere obviously disposable rather than in the source tree.
  const outputDir = path.join(context.episodeDir, 'dist', `.pc-build-${id}`);
  // The provider writes into `dist/.pc-build-<id>` BEFORE `stage()` runs, so a symlinked `dist/`
  // would let provider scratch bytes land OUTSIDE the episode even though the build is ultimately
  // refused. Refuse a symlinked scratch root up front, so nothing is ever written outside — not
  // even transiently (AUDIT-03/AUDIT-10). `stage()` re-checks the FINAL root (`.ai`/`dist`) too.
  await assertContainedRoot(context.episodeDir, pureOutputRoot());
  try {
    const { response, output } = await invokeProvider({
      runner: context.runner,
      decl,
      target: id,
      inputs,
      outputDir,
    });

    // An IMPURE output is not reproducible: regenerating it yields different bytes, so it IS the
    // durable record and must be COMMITTED — in a directory whose name makes plain it was not
    // human-crafted, so nobody mistakes it for authored content. A PURE output is reproducible and
    // stays in gitignored `dist/`. production-control already knows which this is (the same
    // impurity it records), so the routing is principled, not a per-target flag.
    const impure = impurityOf(decl, response) !== undefined;
    const outputRoot = impure ? impureOutputRoot() : pureOutputRoot();

    // Step 4: stage the produced bytes to a temp sibling — NOT their final path yet.
    const staged = await stage(context.episodeDir, outputRoot, output, impure, id);
    try {
      // Step 5: write the record. If this throws, nothing visible has changed — the staged bytes
      // are off to the side and the `finally` below removes them, leaving the prior artifact intact.
      const artifact = await record(
        context,
        id,
        decl,
        inputs,
        response,
        staged.recordedPath,
        output.hash
      );
      // Step 6: make the change visible in ONE atomic rename, within `dist/` (one filesystem).
      await fs.rename(staged.tempPath, staged.destination);
      return artifact;
    } finally {
      // Remove the staged temp if it is still there: on the success path the rename already consumed
      // it (`force` ignores the resulting ENOENT); on any failure path this clears the orphan so a
      // half-produced artifact never lingers in `dist/` (AUDIT-20260716-14).
      await fs.rm(staged.tempPath, { force: true });
    }
  } finally {
    // The provider's scratch space is ours to clean up, on every path. A failed build must not
    // leave a half-produced artifact lying inside `dist/` looking like a build product.
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

export function derivedNode(graph: Graph, id: Identity): Node {
  const node = graph.nodes.get(id);
  if (node === undefined) {
    const known = [...graph.nodes.keys()].join(', ');
    throw new Error(`"${id}" is not a node in this episode. Known nodes: ${known || '(none)'}.`);
  }
  if (node.kind !== 'derived') {
    throw new Error(
      `"${id}" is an authored node: nothing produces it, so it cannot be built. Authored ` +
        `content is written by a human, and this system never generates or alters it (FR-037).`
    );
  }
  return node;
}

function providerOf(node: Node): ProviderDecl {
  const decl = node.provider;
  if (decl === undefined) {
    throw new Error(
      `Derived node "${node.id}" declares no provider. Every derived node names the tool that ` +
        `produces it; there is no default tool to fall back to (FR-036).`
    );
  }
  return decl;
}

/** What `stage` hands back: where the bytes will finally live, where they are staged, and the
 * episode-relative posix path the record will state. */
interface StagedOutput {
  readonly recordedPath: string;
  readonly destination: string;
  readonly tempPath: string;
}

/**
 * STAGES the produced bytes: copies them to a UNIQUE temp sibling under `<episodeDir>/dist`, and
 * returns that temp path, the final `destination`, and the `recordedPath` the record will state
 * (episode-relative, posix). The caller writes the record, then `rename`s the temp into
 * `destination` — so the visible artifact only ever appears via that ONE atomic rename, never a
 * `copyFile` straight onto the live path (AUDIT-20260716-14).
 *
 * The copy targets a temp (rather than moving the scratch file) because the provider's scratch dir
 * may sit on a different filesystem than `dist/`, where `rename` would fail — but the
 * temp→destination rename is WITHIN `dist/`, one filesystem, so it is atomic. `crypto.randomUUID`
 * names the temp because `Math.random`/`Date.now` are unavailable in this environment; a crash
 * mid-copy leaves the temp as an orphan under `dist/`, which `buildTarget`'s `finally` removes.
 *
 * The output is always a FILE, never a directory: `invoke.ts` hashes it with `hashFile` and
 * `onlyOutput` admits exactly one, so a directory-valued output would already have thrown upstream.
 * The file-to-file copy-then-rename here is the only shape ingest is ever handed.
 */
async function stage(
  episodeDir: string,
  root: string,
  output: ProducedOutput,
  impure: boolean,
  target: Identity
): Promise<StagedOutput> {
  const recordedPath = path.posix.join(root, output.relPath);
  const destination = path.join(episodeDir, recordedPath);
  const outputRoot = path.join(episodeDir, root);

  // (b) LEXICAL containment. Defense in depth: `BuildOutputSchema.path` (RelativePathSchema)
  // already refuses a traversing output on the wire, but this composition trusts `output.relPath`,
  // and a future caller that builds a ProducedOutput another way must still not be able to write
  // outside the output root (`dist/` for pure, `.ai/` for impure). The schema guards the wire; this
  // guards the composition (FR-036). This fires FIRST, before any filesystem is touched.
  const relToRoot = path.relative(outputRoot, destination);
  if (relToRoot === '..' || relToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relToRoot)) {
    throw new Error(
      `output.path "${output.relPath}" escapes the episode's ${root}/ directory — a build output ` +
        `must resolve within ${outputRoot} (FR-036).`
    );
  }

  // (c0) THE OUTPUT ROOT ITSELF must resolve to `<episode>/<root>` (AUDIT-03) — creates ONLY the
  // single-segment root (never `dirname(destination)` yet, whose intermediate segments could
  // traverse an escaping symlink — AUDIT-05) so it can be realpath-resolved, and refuses a
  // symlinked root that escapes the episode. Shared with the pre-invocation scratch-root guard in
  // `buildTarget`. Nothing is created outside the real output root until (c0)/(c) pass.
  const { realEpisodeDir, realOutputRoot } = await assertContainedRoot(episodeDir, root);

  // (c) REAL-PATH containment of the DESTINATION (FR-009/FR-010). The lexical guard cannot see
  // through a symlink BENEATH the root. Resolve the REAL destination WITHOUT creating anything:
  // realpath the deepest EXISTING ancestor of the destination's parent and re-append the not-yet-
  // existing remainder (`realpathDeepest`), then append the basename — which the atomic `rename` in
  // step 6 REPLACES rather than follows, so it must NOT itself be resolved. Confirm the result
  // stays within the realpath-resolved output root BEFORE any nested directory is created (AUDIT-05).
  const realParent = await realpathDeepest(path.dirname(destination));
  const resolved = path.join(realParent, path.basename(destination));

  const realRel = path.relative(realOutputRoot, resolved);
  if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) {
    throw new Error(
      `output.path "${output.relPath}" resolves through a symlink to ` +
        `"${toPosix(path.relative(realEpisodeDir, resolved))}", which escapes the episode's ` +
        `${root}/ directory — a build output must resolve within ${realOutputRoot} (FR-009).`
    );
  }

  // (d) ZONING (FR-010/FR-011). An IMPURE output whose REAL destination classifies human-safe is
  // refused, naming the resolved path. Impure output routes under `.ai/` by construction, so the
  // only way its real destination lands human-safe is a symlink — which (c) has now resolved. Pure
  // output legitimately lives under human-safe `dist/`, so this guard is impure-only.
  const resolvedRel = toPosix(path.relative(realEpisodeDir, resolved));
  if (impure && classifyZone(resolvedRel, 'file') === 'human-safe') {
    throw zoningRefusal({ path: resolvedRel, target });
  }

  // Only NOW, with the resolved destination proven contained, create its parent directories. The
  // deepest existing ancestor resolved inside the real output root, and the not-yet-existing
  // remainder cannot be a symlink, so this `recursive` mkdir creates real directories inside the
  // real output root only — never following an escaping symlink out of it (AUDIT-05).
  await fs.mkdir(path.dirname(destination), { recursive: true });

  // (e) STAGE the bytes to a temp sibling under `outputRoot`. Both the temp and its eventual
  // destination are then within one filesystem, so the caller's temp->destination rename is atomic.
  const tempPath = path.join(outputRoot, `.pc-ingest-${crypto.randomUUID()}`);
  await fs.copyFile(output.fullPath, tempPath);

  return { recordedPath, destination, tempPath };
}

/** Episode-relative paths are recorded and classified POSIX-separated, regardless of host OS. */
function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/**
 * Creates the single-segment output root `<episodeDir>/<root>` (`dist`/`.ai`) and asserts it is the
 * episode's OWN directory, not a symlink whose real target escapes the episode (AUDIT-03). If
 * `<episodeDir>/<root>` is a symlink, its real target could be anywhere — outside the episode, or a
 * human-safe directory inside it — so any later containment check measured against it would be
 * measured relative to where the root POINTS. Refuses loudly, naming the symlinked target. Returns
 * the realpath-resolved episode dir and output root so the caller need not resolve them again.
 *
 * Called BOTH before invoking the provider (on the `dist/` scratch root, so provider bytes never
 * land outside even transiently — AUDIT-10) and inside `stage()` (on the final `.ai/`|`dist/` root).
 */
async function assertContainedRoot(
  episodeDir: string,
  root: string
): Promise<{ realEpisodeDir: string; realOutputRoot: string }> {
  const outputRoot = path.join(episodeDir, root);
  // `recursive` is a no-op when the root (or a symlink standing in for it) already exists.
  await fs.mkdir(outputRoot, { recursive: true });
  const realEpisodeDir = await fs.realpath(episodeDir);
  const realOutputRoot = await fs.realpath(outputRoot);
  const rootReal = toPosix(path.relative(realEpisodeDir, realOutputRoot));
  if (rootReal !== root) {
    throw new Error(
      `the ${root}/ output root resolves through a symlink to "${rootReal}", which is not the ` +
        `episode's own ${root}/ directory — refusing to write build output outside ` +
        `${realEpisodeDir}/${root} (FR-009).`
    );
  }
  return { realEpisodeDir, realOutputRoot };
}

/**
 * Resolves `target` to its REAL location WITHOUT creating anything: realpaths the deepest existing
 * ancestor and re-appends the not-yet-existing remainder (which, not existing, cannot be a symlink).
 *
 * This is what lets containment (guard (c)) be proven BEFORE `dirname(destination)` is created
 * (AUDIT-05): `fs.realpath` needs its whole argument to exist, so realpathing `dirname(destination)`
 * directly would force the escaping `mkdir` to run first. Walking up to the deepest existing ancestor
 * — a symlink there is followed (an in-root symlink resolves inside the root and is allowed; an
 * escaping one resolves outside and (c) refuses it) — and re-appending the purely-lexical remainder
 * yields the real destination parent with no filesystem mutation at all.
 */
async function realpathDeepest(target: string): Promise<string> {
  const remainder: string[] = [];
  let current = target;
  for (;;) {
    const real = await realpathOrNull(current);
    if (real !== null) {
      return remainder.length === 0 ? real : path.join(real, ...remainder);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`no existing ancestor of "${target}" could be resolved.`);
    }
    remainder.unshift(path.basename(current));
    current = parent;
  }
}

/** `fs.realpath`, returning `null` for a path that does not exist (ENOENT, incl. a dangling
 * symlink) and rethrowing every other I/O fault by name. */
async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Writes the record — the half of the act that makes the other half meaningful (FR-013).
 *
 * The ledger is re-read here rather than reused from the context: everything else in it (other
 * artifacts, and every human decision in `reviews`) must survive this write untouched, and the
 * copy loaded before the provider ran is a snapshot from before. A build writes exactly one
 * artifact record and never a review — a build is not a human deciding anything (FR-022a).
 */
async function record(
  context: BuildContext,
  id: Identity,
  decl: ProviderDecl,
  inputs: Readonly<Record<Identity, BuildInput>>,
  response: BuildResponse,
  outputPath: string,
  outputHash: string
): Promise<ArtifactRecord> {
  const impure = impurityOf(decl, response);

  const artifact: ArtifactRecord = {
    producer: { tool: response.tool.name, version: response.tool.version },
    ...(impure !== undefined ? { producer_impure: { reason: impure.reason } } : {}),
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([identity, input]) => [identity, input.hash])
    ),
    output: { path: outputPath, hash: outputHash },
    built_at: context.at,
    // FR-006b: absent is MEANINGFUL. A provider that reported no verdict leaves this absent —
    // "not yet validated" — never defaulted to `passed`, which would be this system inventing a
    // verdict nobody reached.
    ...(response.validation !== undefined
      ? { validation: { state: response.validation.state, at: context.at } }
      : {}),
  };

  const current = await readLedger(context.episodeDir);
  await writeLedger(context.episodeDir, {
    ...current,
    artifacts: { ...current.artifacts, [id]: artifact },
  });

  return artifact;
}

/**
 * The impurity declaration to record — **with its REASON**, which is the entire point (FR-032,
 * T060). A bare "not reproducible" flag says only "expect different bytes"; the reason says
 * whether the impurity is incidental (a font fetch, fixable by vendoring), inherent (a model
 * call), or a bug (a clock in a filename). A reader deciding whether to trust, cache, or repair
 * this artifact needs to know which. Both sources below carry a reason — neither schema admits
 * a bare boolean — so there is no path by which a reason-less impurity reaches the ledger.
 *
 * The provider's own declaration wins: it is the tool speaking about the invocation that
 * actually happened. The profile's declaration is consulted only when the provider said nothing,
 * and it is honoured rather than dropped — an operator who declared a tool impure has stated a
 * fact about it, and silently discarding that would leave the artifact looking reproducible on
 * the strength of the tool's own silence.
 */
function impurityOf(decl: ProviderDecl, response: BuildResponse): BuildImpure | undefined {
  return response.impure ?? decl.impure;
}

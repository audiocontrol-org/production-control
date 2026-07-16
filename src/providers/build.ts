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
  try {
    const { response, output } = await invokeProvider({
      runner: context.runner,
      decl,
      target: id,
      inputs,
      outputDir,
    });

    // Step 4: stage the produced bytes to a temp sibling — NOT their final path yet.
    const staged = await stage(context.episodeDir, output);
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
async function stage(episodeDir: string, output: ProducedOutput): Promise<StagedOutput> {
  const recordedPath = path.posix.join('dist', output.relPath);
  const destination = path.join(episodeDir, recordedPath);

  // Defense in depth. `BuildOutputSchema.path` (RelativePathSchema) already refuses a traversing
  // output on the wire, but this composition trusts `output.relPath`, and a future caller that
  // builds a ProducedOutput another way must still not be able to write outside `<episodeDir>/dist`.
  // The schema guards the wire; this guards the composition (FR-036).
  const distRoot = path.join(episodeDir, 'dist');
  const relToDist = path.relative(distRoot, destination);
  if (relToDist === '..' || relToDist.startsWith(`..${path.sep}`) || path.isAbsolute(relToDist)) {
    throw new Error(
      `output.path "${output.relPath}" escapes the episode's dist/ directory — a build output ` +
        `must resolve within ${distRoot} (FR-036).`
    );
  }

  // `dirname(destination)` is at or under `distRoot`, so this also creates `distRoot`, where the
  // temp sibling lands. Both the temp and its eventual destination are then within one filesystem.
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const tempPath = path.join(distRoot, `.pc-ingest-${crypto.randomUUID()}`);
  await fs.copyFile(output.fullPath, tempPath);

  return { recordedPath, destination, tempPath };
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

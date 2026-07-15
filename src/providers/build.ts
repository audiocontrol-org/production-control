import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
 *   4. Ingest it to its final `dist/` location.
 *   5. Write the record: inputs as SUPPLIED, tool as REPORTED, output hash as COMPUTED.
 *
 * A failure at any step throws, and the ledger is written only at step 5 — so a failed build
 * writes no record claiming success and leaves any previous record untouched (FR-017).
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

    const recordedPath = await ingest(context.episodeDir, output);
    return await record(context, id, decl, inputs, response, recordedPath, output.hash);
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

/**
 * Moves the produced bytes from the provider's scratch directory to their final home under
 * `dist/`, and returns the path as the record will state it (episode-relative, posix).
 *
 * `copyFile` then let the `finally` above remove the scratch dir, rather than `rename`: the two
 * are only equivalent within one filesystem, and `dist/` is exactly the kind of directory
 * someone mounts elsewhere.
 */
async function ingest(episodeDir: string, output: ProducedOutput): Promise<string> {
  const recordedPath = path.posix.join('dist', output.relPath);
  const destination = path.join(episodeDir, recordedPath);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(output.fullPath, destination);

  return recordedPath;
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

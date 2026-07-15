import {
  EXIT_OK,
  EXIT_USAGE,
  runVerb,
  toJsonText,
  type CliDeps,
  type ReadOptions,
} from '@/cli/runtime.js';
import type { Hash } from '@/hash/content.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';
import { buildTarget } from '@/providers/build.js';
import { subprocessRunner } from '@/providers/run.js';

/**
 * `pc build <target>` (T059, FR-014, contracts/cli.md § `pc build`).
 *
 * **Building and recording are ONE INDIVISIBLE ACT, and the guarantee is the absence of an
 * alternative.** Read the options below: there is no `--no-record`. There is no `record` verb
 * beside this one in `index.ts`. There is no environment variable, no config key, and no
 * internal seam that produces bytes without a record — `buildTarget` is the only thing
 * `src/providers/build.ts` exports, and it does both or throws.
 *
 * **Do not add one.** Not for testing, not for a dry run, not for "just this once". An
 * unrecorded artifact is indistinguishable from a fabricated one, and an option to create one
 * will eventually be used. If a flag ever appears here, this requirement is gone — not weakened.
 *
 * This file is the thin part: it reads options, hands the loaded episode to the act, and renders
 * what the act recorded. Every refusal it can make happens before the ledger is touched, and a
 * failed build exits 1 naming what failed (FR-017, FR-036) — never a record claiming success.
 */

/**
 * Snake_case throughout: this reports the RECORD that was written, not a paraphrase of it. An
 * agent reading this and an agent reading `.production/ledger.yaml` must see the same field
 * names for the same facts.
 */
export interface BuildJson {
  readonly episode: string;
  readonly target: Identity;
  readonly producer: { readonly tool: string; readonly version: string };
  /** The reason, never a bare flag (FR-032). `null` = the tool is referentially transparent. */
  readonly producer_impure: { readonly reason: string } | null;
  /** As SUPPLIED to the provider — the comparison basis every future `pc status` reads. */
  readonly inputs: Readonly<Record<Identity, Hash>>;
  /** `hash` computed by production-control from the bytes, never as the provider reported it. */
  readonly output: { readonly path: string; readonly hash: Hash };
  readonly built_at: string;
  /** `null` = the provider reported no verdict: NOT VALIDATED, distinct from failed (FR-006b). */
  readonly validation: 'passed' | 'failed' | null;
}

function toBuildJson(episode: string, target: Identity, record: ArtifactRecord): BuildJson {
  return {
    episode,
    target,
    producer: record.producer,
    producer_impure: record.producer_impure ?? null,
    inputs: record.inputs,
    output: record.output,
    built_at: record.built_at,
    validation: record.validation?.state ?? null,
  };
}

/**
 * The human rendering. It leads with what was RECORDED rather than "ok", because the record is
 * the product — the artifact is reproducible from it, and it is the half that survives a clone.
 */
function renderBuild(answer: BuildJson): readonly string[] {
  const lines = [
    `built  ${answer.target}  (${answer.producer.tool} ${answer.producer.version})`,
    `  output:   ${answer.output.path}  ${answer.output.hash}`,
  ];
  for (const [identity, hash] of Object.entries(answer.inputs)) {
    lines.push(`  input:    ${identity}  ${hash}`);
  }
  lines.push(`  recorded: ${answer.built_at}`);
  if (answer.producer_impure !== null) {
    // Surfaced at the moment of the build, not buried in the ledger: this artifact cannot be
    // re-derived identically, and the reason is what tells a reader whether that is fixable.
    lines.push(`  impure:   ${answer.producer_impure.reason}`);
  }
  lines.push(
    answer.validation === null
      ? `  validation: none reported — "${answer.target}" is NOT VALIDATED`
      : `  validation: ${answer.validation}`
  );
  return lines;
}

/**
 * Builds `id`, or refuses NAMING what failed.
 *
 * The clock and the runner are bound here rather than in `CliDeps`: `CliDeps` is shared with the
 * read verbs, and a runner on it would put `child_process` on `status`'s import path — which is
 * precisely the reach `tests/unit/architecture.test.ts` proves the read verbs do not have
 * (FR-010). `pc build` exists to exec a craft tool (FR-029); `pc status` must never be able to.
 */
export async function buildCommand(
  deps: CliDeps,
  id: Identity,
  options: ReadOptions
): Promise<number> {
  return runVerb(deps.output, 'build', async () => {
    const { episodeDir, manifest, graph, ledger } = await deps.loader.load(options.episode);

    const node = graph.nodes.get(id);
    if (node === undefined) {
      // The caller named something that is not in this episode: their mistake, not a build
      // failure and not a gate's verdict (FR-035).
      const known = [...graph.nodes.keys()].join(', ');
      deps.output.err(
        `pc build: "${id}" is not a node in episode "${manifest.id}". ` +
          `Known nodes: ${known || '(none)'}.`
      );
      return EXIT_USAGE;
    }
    if (node.kind !== 'derived') {
      deps.output.err(
        `pc build: "${id}" is an authored node — nothing produces it, so it cannot be built. ` +
          `Authored content is written by a human, and this system never generates or alters it ` +
          `(FR-037).`
      );
      return EXIT_USAGE;
    }

    // Anything past this point that goes wrong is a REFUSAL (exit 1 via `runVerb`), naming what
    // failed and surfacing the provider's own stderr — never a record claiming success (FR-017).
    const record = await buildTarget(
      { episodeDir, graph, ledger, runner: subprocessRunner(), at: new Date().toISOString() },
      id
    );

    const answer = toBuildJson(manifest.id, id, record);
    if (options.json === true) {
      deps.output.out(toJsonText(answer));
    } else {
      for (const line of renderBuild(answer)) {
        deps.output.out(line);
      }
    }

    return EXIT_OK;
  });
}

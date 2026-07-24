import * as process from 'node:process';
import { envInputResolver } from '@/assets/config.js';
import { gitTrackedCheck } from '@/assets/git-tracked.js';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  nameError,
  runVerb,
  toJsonText,
  type CliDeps,
  type ReadOptions,
} from '@/cli/runtime.js';
import type { Identity } from '@/manifest/schema.js';
import type { BuildContext } from '@/providers/build.js';
import { assetCacheDir } from '@/providers/inputs.js';
import { subprocessRunner } from '@/providers/run.js';
import { validateTarget } from '@/providers/validate.js';

/**
 * `pc validate [<target>]` (T062, FR-006b, contracts/cli.md § `pc validate`).
 *
 * A GATE: exit 0 only when every requested target validated `passed`; exit 1 otherwise
 * (FR-035). It runs the provider's validation and records the verdict — see
 * `src/providers/validate.ts` for why obtaining a verdict means invoking the provider, and why
 * it refuses rather than rebuilding over an artifact.
 *
 * **Absent is not passed and not failed** (FR-006b). A target whose provider reported no verdict
 * is NOT VALIDATED: this verb records nothing for it and does not pass it. Exiting 0 there would
 * be the false clean the whole ledger exists to prevent — a caller would read "validated" from a
 * gate that validated nothing.
 *
 * With no target named, every target the episode declares is validated. Every one of them is
 * attempted and every outcome is reported, rather than aborting at the first refusal: a gate's
 * job is to name everything that blocks (SC-005). Nothing is ever silently skipped — a target
 * that could not be validated appears in the report, and it fails the gate (FR-036).
 */

/** One target's outcome. `unresolved` carries the refusal for a target that could not answer. */
interface TargetVerdict {
  readonly target: Identity;
  readonly state: 'passed' | 'failed' | 'unresolved';
  readonly detail: string | null;
}

export interface ValidateJson {
  readonly episode: string;
  readonly valid: boolean;
  readonly targets: readonly TargetVerdict[];
}

function renderValidate(answer: ValidateJson): readonly string[] {
  const width = answer.targets.reduce((widest, item) => Math.max(widest, item.target.length), 0);
  return answer.targets.map((item) => {
    const head = `${item.target.padEnd(width)}  ${item.state}`;
    return item.detail === null ? head : `${head}  ${item.detail}`;
  });
}

/** Runs one target's validation, converting a refusal into an outcome rather than a throw. */
async function verdictFor(context: BuildContext, target: Identity): Promise<TargetVerdict> {
  try {
    const verdict = await validateTarget(context, target);
    return { target, state: verdict.state, detail: null };
  } catch (error) {
    // Named, never swallowed: this target did not validate, and the reason is the only thing the
    // operator has to act on (FR-036). It is reported as `unresolved` rather than `failed` —
    // "the tool judged this bad" and "no verdict could be obtained" are different facts, and
    // collapsing them would put a verdict in the report that nobody reached.
    return { target, state: 'unresolved', detail: nameError(error) };
  }
}

export async function validateCommand(
  deps: CliDeps,
  target: Identity | undefined,
  options: ReadOptions
): Promise<number> {
  return runVerb(deps.output, 'validate', async () => {
    const { episodeDir, manifest, graph, ledger } = await deps.loader.load(options.episode);

    if (target !== undefined && !graph.nodes.has(target)) {
      const known = [...graph.nodes.keys()].join(', ');
      deps.output.err(
        `pc validate: "${target}" is not a node in episode "${manifest.id}". ` +
          `Known nodes: ${known || '(none)'}.`
      );
      return EXIT_USAGE;
    }

    // `graph.targets` is what the episode ASKED FOR — a narrower thing than every derived node
    // in the graph, and the right default: validating a target nobody declared would answer a
    // question the operator did not ask.
    const requested = target !== undefined ? [target] : graph.targets;
    if (requested.length === 0) {
      deps.output.err(
        `pc validate: episode "${manifest.id}" declares no targets, so there is nothing to ` +
          `validate. Name one in \`targets\`, or pass a target explicitly.`
      );
      return EXIT_USAGE;
    }

    // `assets` for the same reason `pc build` binds one: validation re-invokes the provider, so
    // it resolves the same inputs, and a stand-in's bytes must be local before the spawn (FR-030).
    // Lazily configured — an episode with no asset inputs validates with no store configured.
    const context: BuildContext = {
      episodeDir,
      graph,
      ledger,
      runner: subprocessRunner(),
      assets: envInputResolver(process.env, assetCacheDir(episodeDir)),
      // Validation re-invokes the provider and so re-resolves the same inputs — the FR-026 guard
      // applies exactly as it does for `pc build`, with the real git-backed check (AUDIT-20260716-26).
      tracked: gitTrackedCheck(),
      at: new Date().toISOString(),
    };

    const verdicts: TargetVerdict[] = [];
    for (const id of requested) {
      verdicts.push(await verdictFor(context, id));
    }

    const valid = verdicts.every((verdict) => verdict.state === 'passed');
    const answer: ValidateJson = { episode: manifest.id, valid, targets: verdicts };

    if (options.json === true) {
      deps.output.out(toJsonText(answer));
    } else {
      for (const line of renderValidate(answer)) {
        deps.output.out(line);
      }
    }

    // The gate's verdict. Anything short of every target passing is a "no", and it is
    // distinguishable from a caller's mistake (2) by being 1 (FR-035).
    return valid ? EXIT_OK : EXIT_FAILED;
  });
}

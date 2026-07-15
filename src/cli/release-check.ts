import { toNodeJson, renderStatus, type NodeStatusJson } from '@/cli/status.js';
import {
  EXIT_FAILED,
  EXIT_OK,
  runVerb,
  toJsonText,
  type CliDeps,
  type ReadOptions,
} from '@/cli/runtime.js';
import { assessRelease } from '@/state/release.js';
import type { NodeStatus } from '@/state/resolve.js';

/**
 * `pc release-check` (T039) — the release question (contracts/cli.md, FR-012).
 *
 * A GATE, not a read verb: exit 0 only when the production can actually ship, exit 1 when it
 * cannot. This is the one place in this CLI where "the answer is no" and "exit non-zero" are
 * the same thing, and that is precisely because the question is a gate's question. `status`
 * and `next` report the same underlying facts and still exit 0 — they were asked what is true,
 * not whether to proceed.
 *
 * Every negative answer NAMES what blocks it (SC-005). `assessRelease` returns the blockers
 * alongside the verdict rather than a bare boolean, so this verb cannot report "no" without
 * being able to say why — there is no code path here that re-derives the reason or omits it.
 */

export interface ReleaseCheckJson {
  readonly episode: string;
  readonly releasable: boolean;
  readonly blockers: readonly NodeStatusJson[];
}

/** Blockers are full `NodeStatus` values — the same shape `pc status` reports, cause and all. */
export function toReleaseCheckJson(
  episode: string,
  releasable: boolean,
  blockers: readonly NodeStatus[]
): ReleaseCheckJson {
  return { episode, releasable, blockers: blockers.map(toNodeJson) };
}

export function renderRelease(
  releasable: boolean,
  blockers: readonly NodeStatus[]
): readonly string[] {
  if (releasable) {
    return ['releasable'];
  }
  // Reuses `status`'s node rendering: a blocker is a node in a state, and reading it should not
  // require learning a second layout for the same fact.
  return ['not releasable:', ...renderStatus({ episode: '', nodes: blockers }).map(indent)];
}

function indent(line: string): string {
  return `  ${line}`;
}

export async function releaseCheckCommand(deps: CliDeps, options: ReadOptions): Promise<number> {
  return runVerb(deps.output, 'release-check', async () => {
    const { status, manifest } = await deps.loader.load(options.episode);
    const verdict = assessRelease(status, manifest.targets);

    if (options.json === true) {
      deps.output.out(
        toJsonText(toReleaseCheckJson(status.episode, verdict.releasable, verdict.blockers))
      );
    } else {
      for (const line of renderRelease(verdict.releasable, verdict.blockers)) {
        deps.output.out(line);
      }
    }

    return verdict.releasable ? EXIT_OK : EXIT_FAILED;
  });
}

import { EXIT_OK, runVerb, toJsonText, type CliDeps, type ReadOptions } from '@/cli/runtime.js';
import type { Identity } from '@/manifest/schema.js';
import { frontier, type Action, type FrontierItem } from '@/state/frontier.js';

/**
 * `pc next` (T038) — the actionable frontier (contracts/cli.md, FR-011).
 *
 * Distinct from `status` because "everything that is true" and "what should I do now" are
 * different questions, and making an agent derive the second from the first is making it guess.
 *
 * Every item names an ACTION, never a state (FR-006b). That is why `validate` appears here
 * without `unvalidated` ever being a state: a `fresh` node with no recorded validation is
 * actionable, and the thing a caller needs is the verb to run, not a new state word to
 * interpret. `frontier` already encodes that mapping; this verb renders it and adds nothing.
 *
 * `blocked` nodes are excluded — by `frontier`, not here. A blocked node is not actionable; its
 * absent input is, and that input appears in this list on its own account under `supply`.
 */

export interface FrontierItemJson {
  readonly id: Identity;
  readonly action: Action;
  readonly reason: string;
}

export interface NextJson {
  readonly episode: string;
  readonly frontier: readonly FrontierItemJson[];
}

export function toNextJson(episode: string, items: readonly FrontierItem[]): NextJson {
  return {
    episode,
    frontier: items.map((item) => ({ id: item.id, action: item.action, reason: item.reason })),
  };
}

/** `1. id  action  reason` — numbered, because a frontier is a list a human works down. */
export function renderNext(items: readonly FrontierItem[]): readonly string[] {
  if (items.length === 0) {
    // Not an empty answer: it is the answer. Saying nothing here would leave a caller unsure
    // whether the verb ran.
    return ['nothing to do: no node is actionable.'];
  }

  const ordinalWidth = `${items.length}`.length;
  const idWidth = widest(items.map((item) => item.id));
  const actionWidth = widest(items.map((item) => item.action));

  return items.map((item, index) => {
    const ordinal = `${index + 1}.`.padStart(ordinalWidth + 1);
    return `${ordinal} ${item.id.padEnd(idWidth)}  ${item.action.padEnd(actionWidth)}  ${item.reason}`;
  });
}

function widest(values: readonly string[]): number {
  return values.reduce((widthSoFar, value) => Math.max(widthSoFar, value.length), 0);
}

export async function nextCommand(deps: CliDeps, options: ReadOptions): Promise<number> {
  return runVerb(deps.output, 'next', async () => {
    const { status } = await deps.loader.load(options.episode);
    const items = frontier(status);

    if (options.json === true) {
      deps.output.out(toJsonText(toNextJson(status.episode, items)));
    } else {
      for (const line of renderNext(items)) {
        deps.output.out(line);
      }
    }

    return EXIT_OK;
  });
}

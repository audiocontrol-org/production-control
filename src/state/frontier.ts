import type { Identity } from '@/manifest/schema.js';
import type { EpisodeStatus, NodeState } from '@/state/resolve.js';

/**
 * The actionable frontier (T036, FR-011): "everything that is true" and "what should I do
 * now" are different questions. `resolveStatus` answers the first; this answers the second,
 * as its own query rather than something a caller derives by re-interpreting full state.
 */
export type Action = 'build' | 'rebuild' | 'validate' | 'review' | 'supply' | 'resolve-edit';

/**
 * `reason` carries the node's cause message verbatim, so the frontier names WHY without a
 * second lookup back into `EpisodeStatus`.
 */
export interface FrontierItem {
  readonly id: Identity;
  readonly action: Action;
  readonly reason: string;
}

/**
 * Maps a node's state to the action it calls for, or `undefined` when the node is not
 * actionable at all.
 *
 * `blocked` is excluded entirely (not mapped to any action): a blocked node's own input is
 * absent, and that absent input already appears in the frontier under `supply` when it is
 * walked in turn — listing the blocked node too would point at something nobody can act on
 * directly.
 *
 * `modified` maps to `resolve-edit`, never `rebuild`: rebuilding would destroy the human
 * edit that made the node `modified` in the first place, which is the entire reason
 * `modified` is a state distinct from `stale`.
 *
 * `fresh` is actionable only when it carries no recorded validation (FR-006b) — `validate`.
 * A `fresh` node that IS validated, and a `present` authored node, need no action and are
 * absent from the frontier.
 */
function actionFor(
  state: NodeState,
  validated: 'passed' | 'failed' | undefined
): Action | undefined {
  switch (state) {
    case 'missing':
      return 'build';
    case 'stale':
      return 'rebuild';
    case 'invalid':
      return 'rebuild';
    case 'modified':
      return 'resolve-edit';
    case 'needs-review':
      return 'review';
    case 'absent':
      return 'supply';
    case 'blocked':
      return undefined;
    case 'present':
      return undefined;
    case 'fresh':
      return validated === undefined ? 'validate' : undefined;
  }
}

/** The actionable set, in the same order `status.nodes` reports them. */
export function frontier(status: EpisodeStatus): readonly FrontierItem[] {
  const items: FrontierItem[] = [];

  for (const node of status.nodes) {
    const action = actionFor(node.state, node.validated);
    if (action === undefined) {
      continue;
    }
    items.push({ id: node.id, action, reason: node.cause.message });
  }

  return items;
}

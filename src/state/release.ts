import type { Identity } from '@/manifest/schema.js';
import type { EpisodeStatus, NodeStatus } from '@/state/resolve.js';

/**
 * The release question (T035, FR-012, FR-017b).
 *
 * "Is everything green" and "can we ship" are different questions from `resolveStatus`'s
 * per-node report — this is the aggregate answer, and the negative case is the one that
 * matters: a caller must be able to say exactly what stands in the way, not just that
 * something does.
 */

/**
 * `blockers` is empty if and only if `releasable` is true — the two facts describe the same
 * thing from opposite directions, and this is a struct rather than a boolean so a caller
 * never has to re-derive the reason from `releasable` alone.
 */
export interface ReleaseVerdict {
  readonly releasable: boolean;
  readonly blockers: readonly NodeStatus[];
}

/**
 * Releasable only when ALL of:
 *
 *   - every declared target is `fresh`;
 *   - every target has a RECORDED validation of `passed` — FR-006b: `validated === undefined`
 *     ("not yet validated") is distinct from `passed` and blocks release exactly like
 *     `failed` does. Collapsing the two would make an unchecked artifact indistinguishable
 *     from a verified one, which is the false-clean this system exists to refuse.
 *   - no node anywhere has an outstanding `needs-review` (an unwaived human question); and
 *   - no node anywhere is `modified` (FR-017b) — a hand-edited output blocks release until a
 *     human resolves it; the system must not decide on their behalf.
 *
 * The last two checks run over EVERY node, not just targets: a stale narration behind a
 * fresh voiceover still means a human has an unanswered question, and the target being fresh
 * does not make that question go away.
 */
export function assessRelease(status: EpisodeStatus, targets: readonly Identity[]): ReleaseVerdict {
  const byId = new Map(status.nodes.map((node) => [node.id, node] as const));
  const blocking = new Set<NodeStatus>();

  for (const id of targets) {
    const node = byId.get(id);
    if (node === undefined) {
      throw new Error(
        `Release target "${id}" has no resolved status — it is not among the episode's nodes.`
      );
    }
    if (node.state !== 'fresh' || node.validated !== 'passed') {
      blocking.add(node);
    }
  }

  for (const node of status.nodes) {
    if (node.state === 'needs-review' || node.state === 'modified') {
      blocking.add(node);
    }
  }

  // Preserve `status.nodes` order rather than the target-then-review insertion order, so the
  // reported blockers read in the same order the full state does.
  const blockers = status.nodes.filter((node) => blocking.has(node));

  return { releasable: blockers.length === 0, blockers };
}

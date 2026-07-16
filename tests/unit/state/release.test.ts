import { describe, it, expect } from 'vitest';
import type { Identity } from '@/manifest/schema.js';
import type { Cause, EpisodeStatus, NodeState, NodeStatus } from '@/state/resolve.js';
import { assessRelease } from '@/state/release.js';

/**
 * T035 — the release question (FR-012, FR-017b, FR-006b).
 *
 * These build `EpisodeStatus` values directly as typed objects: `assessRelease` is a pure
 * function over an already-resolved status, so there is nothing here that touches a
 * filesystem or a ledger. The subtle case (a `fresh` target with NO recorded validation
 * still blocks) gets its own dedicated test per the brief — it is the one place a lazy
 * implementation would quietly ship a false-clean.
 */

const cause = (message: string): Cause => ({ code: 'ok', message });

function node(
  id: Identity,
  kind: 'authored' | 'derived',
  state: NodeState,
  options?: { readonly validated?: 'passed' | 'failed'; readonly message?: string }
): NodeStatus {
  return {
    id,
    kind,
    state,
    cause: cause(options?.message ?? `${id} is ${state}`),
    ...(options?.validated !== undefined ? { validated: options.validated } : {}),
  };
}

function statusOf(nodes: readonly NodeStatus[]): EpisodeStatus {
  return { episode: 'ep-1', nodes };
}

describe('state/release — assessRelease (T035)', () => {
  it('is releasable when every target is fresh and validated, with no reviews or edits pending', () => {
    const status = statusOf([
      node('podcast', 'derived', 'fresh', { validated: 'passed' }),
      node('epub', 'derived', 'fresh', { validated: 'passed' }),
      node('narration', 'authored', 'present'),
    ]);

    const verdict = assessRelease(status, ['podcast', 'epub']);

    expect(verdict.releasable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it('a stale target blocks release, and is named in the blockers', () => {
    const status = statusOf([
      node('podcast', 'derived', 'stale', { message: 'voiceover rebuilt' }),
      node('epub', 'derived', 'fresh', { validated: 'passed' }),
    ]);

    const verdict = assessRelease(status, ['podcast', 'epub']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toEqual(['podcast']);
  });

  it(
    'the subtle case: a target that is FRESH but has NO recorded validation still blocks ' +
      '(FR-006b) — undefined must never be treated as passing',
    () => {
      const status = statusOf([node('epub', 'derived', 'fresh')]);

      const verdict = assessRelease(status, ['epub']);

      expect(verdict.releasable).toBe(false);
      expect(verdict.blockers).toHaveLength(1);
      expect(verdict.blockers[0]?.id).toBe('epub');
      expect(verdict.blockers[0]?.validated).toBeUndefined();
    }
  );

  it(
    'the REACHABLE failed-validation path: a target the resolver reports as `invalid` + ' +
      '`validated: failed` blocks release (AUDIT-20260716-11)',
    () => {
      // This is the combination `resolveStatus` actually emits for a failed validation —
      // resolve.test.ts Case 9 (`ledger validation "failed" -> state is invalid, validated:
      // "failed"`) proves `invalid`+`failed` is the reachable node state, NOT `fresh`+`failed`.
      // This is the cell FR-006b exists to guard: an artifact whose validation FAILED must never
      // ship. If `assessRelease` gated on some `validated`-only predicate but omitted `invalid`
      // from its blocker logic, a genuinely invalid target would ship — this test refuses that.
      const status = statusOf([node('epub', 'derived', 'invalid', { validated: 'failed' })]);

      const verdict = assessRelease(status, ['epub']);

      expect(verdict.releasable).toBe(false);
      expect(verdict.blockers.map((b) => b.id)).toEqual(['epub']);
      expect(verdict.blockers[0]?.state).toBe('invalid');
    }
  );

  it('a `blocked` target (a reachable target state — resolve.test.ts Case 7) blocks release', () => {
    // `blocked` is reachable for a derived target: an absent input makes the target `blocked`
    // (FR-006a). A target that cannot even be resolved is emphatically not releasable.
    const status = statusOf([node('podcast', 'derived', 'blocked', { message: 'input absent' })]);

    const verdict = assessRelease(status, ['podcast']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toEqual(['podcast']);
    expect(verdict.blockers[0]?.state).toBe('blocked');
  });

  it('a `missing` (never-built) target blocks release', () => {
    // `missing`/`never-built` is reachable for a target (resolve.test.ts / freshness Case 3).
    const status = statusOf([node('podcast', 'derived', 'missing', { message: 'never built' })]);

    const verdict = assessRelease(status, ['podcast']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toEqual(['podcast']);
    expect(verdict.blockers[0]?.state).toBe('missing');
  });

  it(
    'DEFENSE-IN-DEPTH (unreachable combination): a `fresh` target carrying `validated: failed` ' +
      'still blocks — the resolver never emits `fresh`+`failed` (it emits `invalid`+`failed`, ' +
      'see the reachable case above), so this only pins that the target gate never treats a ' +
      'non-passing validation as passing, even in a state that cannot occur',
    () => {
      const status = statusOf([node('epub', 'derived', 'fresh', { validated: 'failed' })]);

      const verdict = assessRelease(status, ['epub']);

      expect(verdict.releasable).toBe(false);
      expect(verdict.blockers.map((b) => b.id)).toEqual(['epub']);
    }
  );

  it(
    'DEFENSE-IN-DEPTH (unreachable combination): an `absent` target blocks — a derived target ' +
      'reports `missing`, never `absent` (only authored non-targets go `absent`), so this pins ' +
      'that the target gate blocks any non-`fresh` state word, even one it will not encounter',
    () => {
      const status = statusOf([node('epub', 'derived', 'absent', { message: 'not on disk' })]);

      const verdict = assessRelease(status, ['epub']);

      expect(verdict.releasable).toBe(false);
      expect(verdict.blockers.map((b) => b.id)).toEqual(['epub']);
    }
  );

  it('an unwaived needs-review ANYWHERE blocks release, even on a non-target node', () => {
    const status = statusOf([
      node('podcast', 'derived', 'fresh', { validated: 'passed' }),
      node('voiceover', 'derived', 'fresh', { validated: 'passed' }),
      node('narration', 'authored', 'needs-review', {
        message: 'spoken changed since take-03 was recorded',
      }),
    ]);

    const verdict = assessRelease(status, ['podcast']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toEqual(['narration']);
  });

  it('a modified node ANYWHERE blocks release, even on a non-target node (FR-017b)', () => {
    const status = statusOf([
      node('podcast', 'derived', 'fresh', { validated: 'passed' }),
      node('transcript', 'derived', 'modified', { message: 'output edited by hand' }),
    ]);

    const verdict = assessRelease(status, ['podcast']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toEqual(['transcript']);
  });

  it('every blocker is named — multiple simultaneous blockers are all reported, not just one', () => {
    const status = statusOf([
      node('podcast', 'derived', 'stale', { message: 'voiceover rebuilt' }),
      node('epub', 'derived', 'fresh'),
      node('narration', 'authored', 'needs-review', { message: 'spoken changed' }),
    ]);

    const verdict = assessRelease(status, ['podcast', 'epub']);

    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((b) => b.id).sort()).toEqual(['epub', 'narration', 'podcast']);
  });

  it('a non-target node being merely stale does NOT block — only declared targets must be fresh', () => {
    const status = statusOf([
      node('podcast', 'derived', 'fresh', { validated: 'passed' }),
      node('transcript', 'derived', 'stale', { message: 'spoken changed' }),
    ]);

    const verdict = assessRelease(status, ['podcast']);

    expect(verdict.releasable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it('throws when a declared target has no corresponding resolved node', () => {
    const status = statusOf([node('podcast', 'derived', 'fresh', { validated: 'passed' })]);

    expect(() => assessRelease(status, ['podcast', 'ghost'])).toThrow(/ghost/);
  });
});

import { describe, it, expect } from 'vitest';
import type { Identity } from '@/manifest/schema.js';
import type { Cause, EpisodeStatus, NodeState, NodeStatus } from '@/state/resolve.js';
import { frontier } from '@/state/frontier.js';

/**
 * T036 — the actionable frontier (FR-011).
 *
 * `EpisodeStatus` values are built directly as typed objects: `frontier` is a pure function
 * over an already-resolved status, so no filesystem or ledger is needed to exercise every
 * state → action mapping.
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

describe('state/frontier — frontier (T036)', () => {
  it('missing -> build', () => {
    const status = statusOf([node('podcast', 'derived', 'missing', { message: 'never built' })]);
    expect(frontier(status)).toEqual([{ id: 'podcast', action: 'build', reason: 'never built' }]);
  });

  it('stale -> rebuild', () => {
    const status = statusOf([
      node('podcast', 'derived', 'stale', { message: 'voiceover rebuilt' }),
    ]);
    expect(frontier(status)).toEqual([
      { id: 'podcast', action: 'rebuild', reason: 'voiceover rebuilt' },
    ]);
  });

  it('invalid -> rebuild (fix and rebuild)', () => {
    const status = statusOf([node('epub', 'derived', 'invalid', { message: 'validation failed' })]);
    expect(frontier(status)).toEqual([
      { id: 'epub', action: 'rebuild', reason: 'validation failed' },
    ]);
  });

  it('modified -> resolve-edit, NEVER rebuild — rebuilding would destroy the human edit', () => {
    const status = statusOf([
      node('transcript', 'derived', 'modified', { message: 'output edited by hand' }),
    ]);
    const items = frontier(status);
    expect(items).toEqual([
      { id: 'transcript', action: 'resolve-edit', reason: 'output edited by hand' },
    ]);
    expect(items.map((i) => i.action)).not.toContain('rebuild');
  });

  it('needs-review -> review', () => {
    const status = statusOf([
      node('narration', 'authored', 'needs-review', {
        message: 'spoken changed since take-03 was recorded',
      }),
    ]);
    expect(frontier(status)).toEqual([
      {
        id: 'narration',
        action: 'review',
        reason: 'spoken changed since take-03 was recorded',
      },
    ]);
  });

  it('absent (authored) -> supply', () => {
    const status = statusOf([
      node('narration', 'authored', 'absent', { message: 'its path does not exist' }),
    ]);
    expect(frontier(status)).toEqual([
      { id: 'narration', action: 'supply', reason: 'its path does not exist' },
    ]);
  });

  it('fresh with no recorded validation -> validate', () => {
    const status = statusOf([node('epub', 'derived', 'fresh', { message: 'built, unchanged' })]);
    expect(frontier(status)).toEqual([
      { id: 'epub', action: 'validate', reason: 'built, unchanged' },
    ]);
  });

  it('fresh + validated is absent from the frontier', () => {
    const status = statusOf([node('epub', 'derived', 'fresh', { validated: 'passed' })]);
    expect(frontier(status)).toEqual([]);
  });

  it('present (authored) is absent from the frontier', () => {
    const status = statusOf([node('narration', 'authored', 'present')]);
    expect(frontier(status)).toEqual([]);
  });

  it('blocked is EXCLUDED entirely — the absent input appears instead, under supply', () => {
    const status = statusOf([
      node('podcast', 'derived', 'blocked', { message: 'input "spoken" is absent' }),
      node('spoken', 'authored', 'absent', { message: 'its path does not exist' }),
    ]);

    const items = frontier(status);

    expect(items.map((i) => i.id)).not.toContain('podcast');
    expect(items).toEqual([{ id: 'spoken', action: 'supply', reason: 'its path does not exist' }]);
  });

  it('reasons carry the cause message verbatim, for every mapped action', () => {
    const status = statusOf([
      node('a', 'derived', 'missing', { message: 'reason-a' }),
      node('b', 'derived', 'stale', { message: 'reason-b' }),
      node('c', 'authored', 'needs-review', { message: 'reason-c' }),
    ]);

    const reasons = frontier(status).map((item) => item.reason);
    expect(reasons).toEqual(['reason-a', 'reason-b', 'reason-c']);
  });

  it('mixes several nodes and reports only the actionable ones, in status order', () => {
    const status = statusOf([
      node('podcast', 'derived', 'fresh', { validated: 'passed' }), // excluded
      node('epub', 'derived', 'fresh'), // validate
      node('narration', 'authored', 'needs-review', { message: 'drift' }), // review
      node('spoken', 'authored', 'present'), // excluded
      node('transcript', 'derived', 'blocked', { message: 'blocked' }), // excluded
      node('voiceover', 'derived', 'modified', { message: 'edited' }), // resolve-edit
    ]);

    expect(frontier(status).map((i) => [i.id, i.action])).toEqual([
      ['epub', 'validate'],
      ['narration', 'review'],
      ['voiceover', 'resolve-edit'],
    ]);
  });
});

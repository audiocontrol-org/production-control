import { describe, it, expect } from 'vitest';
import { explainChain } from '@/cli/chain.js';
import type { Graph, Node } from '@/graph/build.js';
import type { Cause, EpisodeStatus, NodeState, NodeStatus } from '@/state/resolve.js';
import type { Identity } from '@/manifest/schema.js';

/**
 * The causal chain walk (`chain.ts`, T044, FR-011a) — the two governance findings it exists to
 * refuse:
 *
 *   - AUDIT-20260716-23: the halt is for an AUTHORED node awaiting a human decision, not for any
 *     node that happens to be `needs-review`. A derived node in `needs-review` is a graph/status
 *     disagreement and must be refused loudly, not silently truncated.
 *   - AUDIT-20260716-24: a derived node's explanation follows only the input IMPLICATED in its
 *     state, not every declared input — an unrelated fresh branch is not part of why the node is
 *     stale/blocked.
 *
 * These build `Graph`/`EpisodeStatus` values directly: `explainChain` is a pure walk over an
 * already-resolved status, so nothing here touches a filesystem or ledger.
 */

function graphOf(nodes: readonly Node[]): Graph {
  return {
    nodes: new Map(nodes.map((node) => [node.id, node] as const)),
    targets: [],
  };
}

function statusOf(nodes: readonly NodeStatus[]): EpisodeStatus {
  return { episode: 'ep-1', nodes };
}

function cause(code: Cause['code'], identity?: Identity): Cause {
  return {
    code,
    message: `${code}${identity !== undefined ? ` (${identity})` : ''}`,
    ...(identity !== undefined ? { identity } : {}),
  };
}

function status(
  id: Identity,
  kind: 'authored' | 'derived',
  state: NodeState,
  c: Cause
): NodeStatus {
  return { id, kind, state, cause: c };
}

describe('chain — causal descent (AUDIT-20260716-24)', () => {
  it('a stale derived node with multiple inputs follows ONLY the input the cause names, not the fresh sibling', () => {
    // podcast ← [voiceover, coverart]. voiceover moved (podcast is stale of it); coverart is a
    // fresh, unrelated authored input. The explanation must not present coverart as causal.
    const graph = graphOf([
      { id: 'podcast', kind: 'derived', inputs: ['voiceover', 'coverart'] },
      { id: 'voiceover', kind: 'derived', inputs: ['narration'] },
      { id: 'coverart', kind: 'authored', path: 'coverart.png' },
      { id: 'narration', kind: 'authored', path: 'narration.wav' },
    ]);
    const episodeStatus = statusOf([
      status('podcast', 'derived', 'stale', cause('input-changed', 'voiceover')),
      status('voiceover', 'derived', 'fresh', cause('ok')),
      status('coverart', 'authored', 'present', cause('present')),
      status('narration', 'authored', 'present', cause('present')),
    ]);

    const chain = explainChain(graph, episodeStatus, 'podcast');
    const ids = chain.links.map((link) => link.id);

    // Before the fix this walked EVERY input, so `coverart` — a fresh branch that did not
    // contribute to the stale — appeared as a causal link.
    expect(ids).toEqual(['podcast', 'voiceover', 'narration']);
    expect(ids).not.toContain('coverart');
  });

  it('a blocked derived node follows only the absent input the cause names', () => {
    const graph = graphOf([
      { id: 'out', kind: 'derived', inputs: ['present-input', 'absent-input'] },
      { id: 'present-input', kind: 'authored', path: 'a.md' },
      { id: 'absent-input', kind: 'authored', path: 'b.md' },
    ]);
    const episodeStatus = statusOf([
      status('out', 'derived', 'blocked', cause('input-absent', 'absent-input')),
      status('present-input', 'authored', 'present', cause('present')),
      status('absent-input', 'authored', 'absent', cause('path-absent', 'absent-input')),
    ]);

    const chain = explainChain(graph, episodeStatus, 'out');
    const ids = chain.links.map((link) => link.id);

    expect(ids).toEqual(['out', 'absent-input']);
    expect(ids).not.toContain('present-input');
  });

  it('a FRESH derived node still shows its full provenance — every input, no cause to narrow to', () => {
    // Regression guard: the causal narrowing must not prune a fresh node down to nothing.
    const graph = graphOf([
      { id: 'podcast', kind: 'derived', inputs: ['voiceover'] },
      { id: 'voiceover', kind: 'derived', inputs: ['narration'] },
      { id: 'narration', kind: 'authored', path: 'narration.wav' },
    ]);
    const episodeStatus = statusOf([
      status('podcast', 'derived', 'fresh', cause('ok')),
      status('voiceover', 'derived', 'fresh', cause('ok')),
      status('narration', 'authored', 'present', cause('present')),
    ]);

    const chain = explainChain(graph, episodeStatus, 'podcast');
    expect(chain.links.map((link) => link.id)).toEqual(['podcast', 'voiceover', 'narration']);
  });
});

describe('chain — the halt is authored-only (AUDIT-20260716-23)', () => {
  it('a DERIVED node in needs-review is a graph/status disagreement and is refused loudly, not silently truncated', () => {
    const graph = graphOf([
      { id: 'weird', kind: 'derived', inputs: ['narration'] },
      { id: 'narration', kind: 'authored', path: 'narration.wav' },
    ]);
    const episodeStatus = statusOf([
      status('weird', 'derived', 'needs-review', cause('followed-changed', 'narration')),
      status('narration', 'authored', 'present', cause('present')),
    ]);

    // Before the fix, `visit` keyed the halt on state alone: it truncated the chain at `weird`,
    // printed a claim about authored bytes, and dropped `narration` — exit-0, no signal.
    expect(() => explainChain(graph, episodeStatus, 'weird')).toThrow(/needs-review|authored/i);
  });

  it('an AUTHORED node in needs-review still halts as the root and shows its observation', () => {
    // Regression guard: scoping the halt to authored nodes must not stop authored halts firing.
    const graph = graphOf([
      { id: 'narration', kind: 'authored', path: 'narration.wav', follows: 'spoken' },
      { id: 'spoken', kind: 'authored', path: 'script.md' },
    ]);
    const episodeStatus = statusOf([
      status('narration', 'authored', 'needs-review', cause('followed-changed', 'spoken')),
      status('spoken', 'authored', 'present', cause('present')),
    ]);

    const chain = explainChain(graph, episodeStatus, 'narration');
    const narration = chain.links.find((link) => link.id === 'narration');
    const spoken = chain.links.find((link) => link.id === 'spoken');

    expect(narration?.halt?.kind).toBe('pending-human-decision');
    expect(spoken?.via).toBe('observation');
    expect(spoken?.halt?.kind).toBe('observation-does-not-propagate');
  });
});

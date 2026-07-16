import type { Graph, Node } from '@/graph/build.js';
import type { Identity } from '@/manifest/schema.js';
import type { Cause, EpisodeStatus, NodeState, NodeStatus } from '@/state/resolve.js';

/**
 * The causal chain behind one node's state (T044, FR-011a).
 *
 * **This walk exists because the chain is counter-intuitive.** With `profiles/editorial-audio`
 * (`voiceover ← [narration]`, `podcast ← [voiceover]`, `narration follows spoken`), revising
 * `spoken` leaves `voiceover` and `podcast` FRESH and raises `needs-review` on `narration`. A
 * reader who understands the design still predicts `spoken → voiceover → podcast`, reasoning
 * about the podcast as "a performance of the script" rather than about the declared inputs.
 * The change flows THROUGH a human: only re-recording narration carries it downstream. An
 * explanation that implied propagation past that pending decision would be worse than none.
 *
 * So the walk distinguishes the two relationship kinds, and treats them differently:
 *
 *   - **dependency** (`inputs`, "is built from") — propagates. The walk follows it upstream.
 *   - **observation** (`follows`, "is a response to") — does NOT propagate. The walk never
 *     crosses one on its way up from a downstream node, because doing so would draw exactly
 *     the false line the verb exists to erase.
 */

export type LinkKind = 'root' | 'dependency' | 'observation';

/**
 * Why the walk stopped here — present only where stopping is the SURPRISING part, so a caller
 * can trust that a halt means something rather than marking every leaf.
 *
 * An authored node with no `follows` is a plain end of the chain: it is an authored input, the
 * chain was walking back to authored inputs, and it arrived. That needs no explanation and
 * carries no halt.
 */
export interface Halt {
  readonly kind: 'pending-human-decision' | 'observation-does-not-propagate';
  readonly message: string;
}

/**
 * One link. `via`/`from` describe how this node was REACHED — `from` is the node the walk
 * descended from, `via` is the edge kind it crossed. The root has `via: 'root'` and no `from`.
 *
 * Naming the edge kind on every link is FR-011a's "naming each link": a reader must be able to
 * see that `podcast ← voiceover` is a dependency while `narration ← spoken` is an observation,
 * because the two behave differently and the difference is the whole point.
 *
 * `depth` is distance from the root, so a renderer can indent without re-deriving the tree —
 * and so a node with several inputs (`transcript ← [narration, spoken]`) flattens into this
 * list without losing its shape.
 */
export interface ChainLink {
  readonly id: Identity;
  readonly state: NodeState;
  readonly cause: Cause;
  readonly via: LinkKind;
  readonly from?: Identity;
  readonly depth: number;
  readonly halt?: Halt;
}

const HALT_PENDING_DECISION =
  'the chain stops here: this node awaits a human decision. Its own bytes have not changed, ' +
  'so nothing propagates past it — only a human revising this node would carry the change ' +
  'downstream.';

const HALT_OBSERVATION =
  'this is an observation ("is a response to"), not a dependency ("is built from"). It draws ' +
  'no edge, rebuilds nothing, and does not propagate: a human decides whether the node above ' +
  'still answers it.';

export interface Chain {
  readonly node: Identity;
  readonly state: NodeState;
  readonly links: readonly ChainLink[];
}

/**
 * Walks back from `root` to the authored inputs responsible for its state.
 *
 * Throws naming `root` and the known nodes if it is not in the graph — a caller asking about a
 * node that does not exist made a usage error, and answering with an empty chain would be a
 * fabricated answer to a question nobody asked (FR-036).
 */
export function explainChain(graph: Graph, status: EpisodeStatus, root: Identity): Chain {
  const byId = new Map(status.nodes.map((node) => [node.id, node] as const));
  const rootStatus = lookup(byId, root);
  const links: ChainLink[] = [];

  visit(graph, byId, links, { status: rootStatus, via: 'root', depth: 0 });

  return { node: rootStatus.id, state: rootStatus.state, links };
}

interface Descent {
  readonly status: NodeStatus;
  readonly via: LinkKind;
  readonly from?: Identity;
  readonly depth: number;
}

/**
 * Emits one link and decides whether the walk continues through it.
 *
 * The rules, and what each one refuses to say:
 *
 *   - A DERIVED node's state comes from its declared `inputs`. Descend into the ones IMPLICATED
 *     by the state as `dependency` links — the single input the cause names when it names one,
 *     every input otherwise (see `causalInputs`). This is the propagating edge, and following it
 *     is the only way the chain reaches the authored inputs actually responsible.
 *
 *   - An AUTHORED node awaiting a human decision (`needs-review`) HALTS the walk (FR-011a).
 *     Nothing upstream of it is reported as reaching the root, because nothing does: the
 *     followed node's change raised a question here and stopped. Listing the followed node as
 *     a further link in a downstream node's chain would lay out `spoken → voiceover → podcast`
 *     on the page and let a reader draw the propagation the design forbids.
 *
 *   - An AUTHORED node otherwise is an authored input: the end of the chain, no halt needed.
 *
 * The `follows` edge is crossed in exactly ONE case, handled below: when the node awaiting the
 * decision IS the node being explained. See `descendObservation`.
 */
function visit(
  graph: Graph,
  byId: ReadonlyMap<Identity, NodeStatus>,
  links: ChainLink[],
  descent: Descent
): void {
  const node = graph.nodes.get(descent.status.id);
  if (node === undefined) {
    throw new Error(
      `Node "${descent.status.id}" has a resolved status but is not in the episode's graph — ` +
        `the status report and the graph disagree, so no chain can be trusted.`
    );
  }

  // The halt is for an AUTHORED node awaiting a human decision (FR-011a) — the halt text asserts
  // a fact about authored bytes ("its own bytes have not changed"), and only an authored node can
  // be `needs-review` (FR-006). Keying the halt on state alone would silently truncate the chain
  // at any node that happened to be `needs-review`, printing that unverified claim and dropping
  // the responsible inputs (AUDIT-20260716-23). A derived node in `needs-review` is a
  // graph/status disagreement, and this codebase refuses those loudly rather than papering over
  // them.
  const isAuthored = node.kind === 'authored';
  if (!isAuthored && descent.status.state === 'needs-review') {
    throw new Error(
      `Derived node "${descent.status.id}" resolved to "needs-review", a state only an authored ` +
        `node can hold (FR-006). The status report and the graph disagree, so no chain can be ` +
        `trusted.`
    );
  }

  const isPendingDecision = isAuthored && descent.status.state === 'needs-review';
  const halt: Halt | undefined = isPendingDecision
    ? { kind: 'pending-human-decision', message: HALT_PENDING_DECISION }
    : undefined;

  links.push({
    id: descent.status.id,
    state: descent.status.state,
    cause: descent.status.cause,
    via: descent.via,
    ...(descent.from !== undefined ? { from: descent.from } : {}),
    depth: descent.depth,
    ...(halt !== undefined ? { halt } : {}),
  });

  if (isPendingDecision) {
    // Halted. The ONE exception: if the pending decision is the very node being explained,
    // show what it observes. There is no downstream in that chain for a reader to wrongly
    // propagate into — the question "why does narration need review?" is answered by naming
    // spoken, and the link is labelled `observation` and carries its own halt so it cannot be
    // mistaken for a dependency. Reached from anywhere else, this edge stays uncrossed.
    if (descent.via === 'root') {
      descendObservation(byId, links, node.follows, descent);
    }
    return;
  }

  for (const input of causalInputs(node, descent.status)) {
    visit(graph, byId, links, {
      status: lookup(byId, input),
      via: 'dependency',
      from: descent.status.id,
      depth: descent.depth + 1,
    });
  }
}

/**
 * The declared inputs actually IMPLICATED in this node's state (FR-011a, AUDIT-20260716-24).
 *
 * When the cause names a specific input — `stale` on a changed input, `blocked` on an absent one
 * — the chain follows ONLY that input. An unrelated FRESH input did not contribute to the state
 * being explained, and rendering it as part of the causal chain would point a reader (or an
 * unattended consumer treating every link as causal) at the wrong branch of the graph.
 *
 * When no single input is implicated — a `fresh` node's provenance, a `missing` node that was
 * simply never built, an `input-removed` cause whose named identity is no longer a declared input
 * — every declared input is part of the honest answer, and all are followed.
 *
 * Following only the causal input also collapses a diamond to the one path that matters, so a
 * shared upstream node is not reported twice for a state that only one branch caused.
 */
function causalInputs(node: Node, status: NodeStatus): readonly Identity[] {
  const inputs = node.inputs ?? [];
  const causal = status.cause.identity;
  if (causal !== undefined && inputs.includes(causal)) {
    return [causal];
  }
  return inputs;
}

/**
 * Emits the observed node as a terminal, explicitly non-propagating link, and never descends
 * from it. Whatever raised the question upstream of `spoken` is not part of why `narration`
 * needs review — that a human must look is the fact, and the chain ends on it.
 */
function descendObservation(
  byId: ReadonlyMap<Identity, NodeStatus>,
  links: ChainLink[],
  followed: Identity | undefined,
  descent: Descent
): void {
  if (followed === undefined) {
    return;
  }
  const observed = lookup(byId, followed);
  links.push({
    id: observed.id,
    state: observed.state,
    cause: observed.cause,
    via: 'observation',
    from: descent.status.id,
    depth: descent.depth + 1,
    halt: { kind: 'observation-does-not-propagate', message: HALT_OBSERVATION },
  });
}

function lookup(byId: ReadonlyMap<Identity, NodeStatus>, id: Identity): NodeStatus {
  const node = byId.get(id);
  if (node === undefined) {
    const known = [...byId.keys()].join(', ');
    throw new Error(
      `Node "${id}" has no resolved status in this episode. Known nodes: ${known || '(none)'}.`
    );
  }
  return node;
}

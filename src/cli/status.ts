import { EXIT_OK, runVerb, toJsonText, type CliDeps, type ReadOptions } from '@/cli/runtime.js';
import type { Identity } from '@/manifest/schema.js';
import type { EpisodeStatus, NodeState, NodeStatus } from '@/state/resolve.js';

/**
 * `pc status` (T037) — every node, its state, and WHY (contracts/cli.md).
 *
 * A read verb: it exits 0 whenever it ANSWERS, including when the answer is that every node is
 * broken (FR-035). It never mutates the episode, and it reaches no network and no craft tool
 * (FR-010, FR-025) — content addressing already put the hash in the pointer file, so nothing
 * needs fetching to answer staleness.
 */

/**
 * `identity` and `validated` are rendered as explicit `null` rather than omitted.
 *
 * `JSON.stringify` drops `undefined` keys, which would make "this node has no validation
 * record" and "this field does not exist in the schema" the same bytes on the wire. They are
 * not the same thing. FR-006b turns on `validated: null` ("not yet validated") being readable
 * and distinct from `"passed"` and `"failed"` — an agent must be able to test the field, not
 * infer it from a key's absence.
 */
export interface CauseJson {
  readonly code: string;
  readonly message: string;
  readonly identity: Identity | null;
}

/**
 * FR-016's report. `null` means the ledger records this tool at exactly one version — never
 * that the question was not asked.
 *
 * Note what is NOT here: any effect on `state`. A tool moving is information; staleness is a
 * fact about content. An agent reading this must be able to see the drift and see that the node
 * is still `fresh`, because it is (see `producerDriftFor`).
 */
export interface ProducerDriftJson {
  readonly tool: string;
  readonly recorded: string;
  readonly others: readonly string[];
}

export interface NodeStatusJson {
  readonly id: Identity;
  readonly kind: 'authored' | 'derived';
  readonly state: NodeState;
  readonly cause: CauseJson;
  readonly validated: 'passed' | 'failed' | null;
  readonly producer_drift: ProducerDriftJson | null;
}

export interface StatusJson {
  readonly episode: string;
  readonly nodes: readonly NodeStatusJson[];
}

/**
 * The single node→JSON projection, shared with `release-check`'s blockers so the two verbs
 * cannot drift into describing the same node two different ways.
 *
 * `cause` is non-optional in `NodeStatus` and non-optional here: FR-007 makes a state without
 * a cause an invalid report, and the type carries that rather than a runtime check hoping for
 * it. A state word alone ("stale") makes an agent guess which of six inputs moved.
 */
export function toNodeJson(node: NodeStatus): NodeStatusJson {
  return {
    id: node.id,
    kind: node.kind,
    state: node.state,
    cause: {
      code: node.cause.code,
      message: node.cause.message,
      identity: node.cause.identity ?? null,
    },
    validated: node.validated ?? null,
    producer_drift: node.producerDrift ?? null,
  };
}

export function toStatusJson(status: EpisodeStatus): StatusJson {
  return { episode: status.episode, nodes: status.nodes.map(toNodeJson) };
}

/** `id  state  cause` — the convenience layer over the JSON, in the same order and no other. */
export function renderStatus(status: EpisodeStatus): readonly string[] {
  if (status.nodes.length === 0) {
    return [];
  }
  const idWidth = widest(status.nodes.map((node) => node.id));
  const stateWidth = widest(status.nodes.map((node) => node.state));
  return status.nodes.flatMap((node) => {
    const line = `${node.id.padEnd(idWidth)}  ${node.state.padEnd(stateWidth)}  ${node.cause.message}`;
    const drift = node.producerDrift;
    if (drift === undefined) {
      return [line];
    }
    // Its own line, never folded into the cause: the cause explains the STATE, and this did not
    // cause the state — the node is whatever it is regardless of the tool having moved (FR-016).
    return [
      line,
      `${' '.repeat(idWidth)}  ${' '.repeat(stateWidth)}  ` +
        `note: ${drift.tool} is also recorded at ${drift.others.join(', ')} ` +
        `(this was built by ${drift.recorded}); reported, not a reason to rebuild`,
    ];
  });
}

function widest(values: readonly string[]): number {
  return values.reduce((widthSoFar, value) => Math.max(widthSoFar, value.length), 0);
}

export async function statusCommand(deps: CliDeps, options: ReadOptions): Promise<number> {
  return runVerb(deps.output, 'status', async () => {
    const { status } = await deps.loader.load(options.episode);

    if (options.json === true) {
      deps.output.out(toJsonText(toStatusJson(status)));
    } else {
      for (const line of renderStatus(status)) {
        deps.output.out(line);
      }
    }

    // The answer was given. Whether the answer is good is a different question, and it is not
    // this exit code's question (FR-035).
    return EXIT_OK;
  });
}

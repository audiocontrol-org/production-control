import { buildGraph, validateGraph, type Node } from '@/graph/build.js';
import type { Hash } from '@/hash/content.js';
import type { Ledger } from '@/ledger/schema.js';
import type { EpisodeManifest, Identity, Profile } from '@/manifest/schema.js';
import { assessFreshness } from '@/state/freshness.js';
import { createContentResolver, type ContentResolver } from '@/state/identity.js';
import { describeAbsence, message } from '@/state/messages.js';

/**
 * The oracle (T034): what state is every node in, and why (FR-006, FR-006a, FR-006b, FR-007,
 * FR-020, FR-022c).
 *
 * Reading state requires no network, no craft tool, and modifies nothing (FR-010) — it reads
 * declared content and the committed ledger, and that is all. The Milestone 1 / Milestone 2
 * boundary is enforced structurally by `tests/unit/architecture.test.ts`, not by discipline.
 */

/** FR-006: a derived node has a producer, so freshness is a question that can be asked of it. */
export type DerivedState = 'fresh' | 'stale' | 'missing' | 'blocked' | 'invalid' | 'modified';

/**
 * FR-006: an authored node has NO `stale` state. Nothing produces it, so staleness is not a
 * question that can be asked of it — this is the authored/derived distinction, expressed in
 * the state model rather than merely documented next to it.
 */
export type AuthoredState = 'present' | 'absent' | 'needs-review';

export type NodeState = DerivedState | AuthoredState;

/**
 * FR-007: why a node is in the state it is in. `message` NAMES the responsible thing, and
 * `identity` carries it structurally whenever there is one, so an agent reads a fact instead
 * of guessing from a state word.
 */
export interface Cause {
  readonly code:
    | 'ok'
    | 'never-built'
    | 'input-changed'
    | 'input-removed'
    | 'input-absent'
    | 'output-edited'
    | 'validation-failed'
    | 'followed-changed'
    | 'followed-absent'
    | 'path-absent'
    | 'present';
  readonly message: string;
  readonly identity?: Identity;
}

/**
 * FR-016: the producing tool that made this artifact is recorded elsewhere in this ledger at a
 * DIFFERENT version. Information, never a state.
 *
 * `recorded` is the version this artifact's own record names; `others` is every other version
 * the same tool is recorded at, sorted so the report is stable.
 */
export interface ProducerDrift {
  readonly tool: string;
  readonly recorded: string;
  readonly others: readonly string[];
}

export interface NodeStatus {
  readonly id: Identity;
  readonly kind: 'authored' | 'derived';
  readonly state: NodeState;
  /** Never optional (FR-007): a state without a cause is not a valid report. */
  readonly cause: Cause;
  /**
   * FR-006b: validation is a recorded FACT, not a state, and it is orthogonal to freshness.
   * `undefined` means "not yet validated" — distinct from both `passed` and `failed`, and it
   * must never be collapsed into either: that would make an unchecked artifact
   * indistinguishable from a checked one.
   */
  readonly validated?: 'passed' | 'failed';
  /**
   * FR-016: reported, and **never** allowed to affect `state`. See `producerDriftFor`.
   */
  readonly producerDrift?: ProducerDrift;
}

export interface EpisodeStatus {
  readonly episode: string;
  readonly nodes: readonly NodeStatus[];
}

export interface ResolveInput {
  readonly episodeDir: string;
  readonly manifest: EpisodeManifest;
  readonly profile: Profile;
  readonly ledger: Ledger;
}

/**
 * Resolves the state of every node in an episode.
 *
 * The graph is validated first: a dangling input or a `follows` naming nothing is a refusal
 * (FR-005), never a node quietly reported as absent. Refusing is the point — a state report
 * over a graph that does not hold together is worse than no report.
 *
 * Note what is NOT here: any walk over a node's consumers. Transitive staleness is emergent
 * from content addressing (FR-009); see the header of `freshness.ts`.
 */
export async function resolveStatus(input: ResolveInput): Promise<EpisodeStatus> {
  const { episodeDir, manifest, profile, ledger } = input;

  validateGraph(manifest, profile);
  const graph = buildGraph(manifest, profile);
  const resolver = createContentResolver({ episodeDir, graph, ledger });

  const nodes: NodeStatus[] = [];
  for (const node of graph.nodes.values()) {
    nodes.push(
      node.kind === 'authored'
        ? await resolveAuthoredNode(resolver, ledger, node)
        : await resolveDerivedNode(resolver, ledger, node)
    );
  }

  return { episode: manifest.id, nodes };
}

// ---------------------------------------------------------------------------
// Derived nodes
// ---------------------------------------------------------------------------

/**
 * Maps the freshness assessment (the facts) onto a state and its cause (the report).
 *
 * The precedence is FR-006a's rule — report the state that asserts LEAST — and every step of
 * it is load-bearing:
 *
 *   - `blocked` over `stale`: with an input absent, "stale" would assert something unverified.
 *   - `stale` over `modified`: if the inputs moved, the output was going to be replaced
 *     anyway and its divergence is not news. The two must never be conflated — rebuilding a
 *     `stale` node is correct, rebuilding a `modified` one destroys a human's work (FR-017a).
 *   - `invalid` last: a recorded validation verdict describes the artifact that was
 *     validated. Once an input has moved or the output has been edited, that artifact is not
 *     the one on disk, and reporting `invalid` would assert a verdict on bytes nobody checked.
 *     Nothing is lost by this ordering: `validated` reports the recorded fact either way.
 */
async function resolveDerivedNode(
  resolver: ContentResolver,
  ledger: Ledger,
  node: Node
): Promise<NodeStatus> {
  const assessment = await assessFreshness(resolver, ledger, node);
  const validated = ledger.artifacts[node.id]?.validation?.state;
  const drift = producerDriftFor(ledger, node.id);
  const report = (state: DerivedState, cause: Cause): NodeStatus =>
    buildStatus(node.id, 'derived', state, cause, validated, drift);

  switch (assessment.kind) {
    case 'input-absent':
      return report('blocked', {
        code: 'input-absent',
        message: message.inputAbsent(
          node.id,
          assessment.identity,
          describeAbsence(assessment.absence)
        ),
        identity: assessment.identity,
      });

    case 'never-built':
      return report('missing', { code: 'never-built', message: message.neverBuilt(node.id) });

    case 'input-changed':
      return report('stale', {
        code: 'input-changed',
        message: message.inputChanged(
          node.id,
          assessment.identity,
          assessment.recorded,
          assessment.current
        ),
        identity: assessment.identity,
      });

    case 'input-removed':
      return report('stale', {
        code: 'input-removed',
        message: message.inputRemoved(node.id, assessment.identity, assessment.recorded),
        identity: assessment.identity,
      });

    case 'output-absent':
      return report('missing', {
        code: 'path-absent',
        message: message.outputAbsent(node.id, assessment.path),
      });

    case 'output-edited':
      return report('modified', {
        code: 'output-edited',
        message: message.outputEdited(
          node.id,
          assessment.path,
          assessment.recorded,
          assessment.current
        ),
      });

    case 'consistent':
      return validated === 'failed'
        ? report('invalid', {
            code: 'validation-failed',
            message: message.validationFailed(node.id, assessment.path),
          })
        : report('fresh', { code: 'ok', message: message.ok(node.id, assessment.path) });
  }
}

/**
 * Producer version drift (T061, FR-016) — **reported, never auto-staling**.
 *
 * FR-016 has two halves and the second is the load-bearing one: report that the tool moved, and
 * *do not* treat that alone as making the output stale. If a version bump staled anything, then
 * upgrading a tool would restale every episode ever built with it — hundreds of rebuilds
 * producing byte-identical artifacts, to satisfy a comparison of version STRINGS rather than of
 * content. Staleness is a fact about content (FR-008/FR-009); a version is not content. So this
 * function contributes to `NodeStatus.producerDrift` and to nothing else: it is spread into the
 * status beside `state`, never into the decision that produces it, and `release.ts` does not
 * read it.
 *
 * **The comparison basis is the ledger itself**, and it has to be. Knowing the tool's version
 * *right now* would mean executing it, and `src/state/` cannot — reporting state requires no
 * craft tool, and `tests/unit/architecture.test.ts` enforces that this module can never import
 * `src/providers/` (FR-010). What the ledger DOES know is every version each tool has been
 * recorded at across this episode's builds. When a tool appears at more than one, the artifacts
 * here were made by different versions of the same tool, and that is exactly the fact FR-016
 * asks to be surfaced — visible before a reader wonders why two artifacts from "the same tool"
 * disagree.
 *
 * It is deliberately not phrased as "the OLD version" or "the current one". Deciding which
 * version came later would mean reading `built_at`, and `built_at` is recorded precisely so that
 * nothing ever decides on it (research R7). This states what is recorded and stops there.
 */
function producerDriftFor(ledger: Ledger, id: Identity): ProducerDrift | undefined {
  const record = ledger.artifacts[id];
  if (record === undefined) {
    return undefined;
  }

  const tool = record.producer.tool;
  const others = new Set<string>();
  for (const other of Object.values(ledger.artifacts)) {
    if (other.producer.tool === tool && other.producer.version !== record.producer.version) {
      others.add(other.producer.version);
    }
  }
  if (others.size === 0) {
    return undefined;
  }

  return { tool, recorded: record.producer.version, others: [...others].sort() };
}

// ---------------------------------------------------------------------------
// Authored nodes
// ---------------------------------------------------------------------------

/**
 * `follows` is an OBSERVATION ("is a response to"), never a dependency ("is built from"). It
 * draws no edge, contributes to no staleness, and triggers no rebuild (FR-019). When the
 * followed node's content differs from the baseline a human last accepted, the tracking node
 * asks a human to look — and stops there. Propagation halts at the human.
 *
 * Precedence (FR-022c): the node's OWN absence outranks everything. A node whose own declared
 * file cannot be read is `absent`, full stop — no drift, and no review question, can be claimed
 * on a node that is not there. That check runs first.
 *
 * A node whose own file IS present but whose FOLLOWED node cannot be read is a DIFFERENT
 * situation, and must not borrow the followed node's state word. It is not `absent` — its own
 * bytes are right there — and drift cannot be CLAIMED either, because the followed content cannot
 * be read to compare against the baseline. What remains true is that a human question is open:
 * the followed node must be restored before the review can be answered. So the tracking node
 * reports `needs-review`, with a cause that names the followed node and says why. This keeps the
 * state a fact about THIS node (AUDIT-20260716-30), and keeps an unresolved human question in the
 * release blocker set (FR-017b) rather than letting a deletion of the followed file turn the
 * release light green (AUDIT-20260716-29).
 */
async function resolveAuthoredNode(
  resolver: ContentResolver,
  ledger: Ledger,
  node: Node
): Promise<NodeStatus> {
  // An authored node has no producer, so neither a validation nor a producer version is a
  // question that can be asked of it (FR-006).
  const report = (state: AuthoredState, cause: Cause): NodeStatus =>
    buildStatus(node.id, 'authored', state, cause, undefined, undefined);

  const own = await resolver.resolve(node.id);
  if (own.kind === 'absent') {
    return report('absent', {
      code: 'path-absent',
      message: message.authoredAbsent(node.id, describeAbsence(own.absence)),
      identity: node.id,
    });
  }

  const followed = node.follows;
  if (followed === undefined) {
    return report('present', { code: 'present', message: message.present(node.id) });
  }

  const followedResolution = await resolver.resolve(followed);
  if (followedResolution.kind === 'absent') {
    // Control only reaches here after `own.kind !== 'absent'` — this node's own file resolved.
    // The FOLLOWED node is the one that cannot be read. Reporting `absent`/`path-absent` here
    // would make a claim about the wrong file and would silently drop this node out of the
    // release blocker set. The truthful, self-describing state is `needs-review`: a human must
    // restore the followed node before the review question can be answered (AUDIT-20260716-30,
    // AUDIT-20260716-29).
    return report('needs-review', {
      code: 'followed-absent',
      message: message.followedAbsent(
        node.id,
        followed,
        describeAbsence(followedResolution.absence)
      ),
      identity: followed,
    });
  }

  return reviewStatus(ledger, node.id, followed, followedResolution.hash, report);
}

/**
 * The waiver is the ONLY recorded anchor for "a human has looked at this": `waived_hash` pins
 * the followed node's content at the moment of acceptance (data-model.md § Waiver). Drift is
 * therefore measured against that baseline, which is what makes FR-022 work — a waiver applies
 * only to the change it was recorded against, and the next revision raises the question again.
 *
 * With no waiver recorded at all there is NO accepted baseline: nobody has ever confirmed this
 * node against the one it follows. That is `needs-review`, not `present`. Reporting `present`
 * would be the exact false-clean the advisory edge exists to prevent — declare `follows`, never
 * review, revise the followed node forever, and the system reports green while the tracking
 * node answers a version that no longer exists.
 */
function reviewStatus(
  ledger: Ledger,
  id: Identity,
  followed: Identity,
  followedHash: Hash,
  report: (state: AuthoredState, cause: Cause) => NodeStatus
): NodeStatus {
  const baseline = ledger.reviews[id]?.waived_hash;

  if (baseline === undefined) {
    return report('needs-review', {
      code: 'followed-changed',
      message: message.neverReviewed(id, followed, followedHash),
      identity: followed,
    });
  }

  if (baseline !== followedHash) {
    return report('needs-review', {
      code: 'followed-changed',
      message: message.followedChanged(id, followed, baseline, followedHash),
      identity: followed,
    });
  }

  return report('present', { code: 'present', message: message.reviewed(id, followed) });
}

// ---------------------------------------------------------------------------

/**
 * The single construction site for a `NodeStatus`, so `cause` is structurally impossible to
 * omit (FR-007) and the two genuinely optional fields are spread conditionally rather than
 * set to `undefined` — under `exactOptionalPropertyTypes` a present-but-undefined property is
 * a different thing from an absent one, and `validated` is a field whose absence MEANS
 * something (FR-006b).
 */
function buildStatus(
  id: Identity,
  kind: 'authored' | 'derived',
  state: NodeState,
  cause: Cause,
  validated: 'passed' | 'failed' | undefined,
  producerDrift: ProducerDrift | undefined
): NodeStatus {
  return {
    id,
    kind,
    state,
    cause: {
      code: cause.code,
      message: cause.message,
      ...(cause.identity !== undefined ? { identity: cause.identity } : {}),
    },
    ...(validated !== undefined ? { validated } : {}),
    // Spread beside `state`, never into it: drift is information a reader may act on, and never
    // a state change (FR-016).
    ...(producerDrift !== undefined ? { producerDrift } : {}),
  };
}

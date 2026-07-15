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
    | 'input-absent'
    | 'output-edited'
    | 'validation-failed'
    | 'followed-changed'
    | 'path-absent'
    | 'present';
  readonly message: string;
  readonly identity?: Identity;
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
  const report = (state: DerivedState, cause: Cause): NodeStatus =>
    buildStatus(node.id, 'derived', state, cause, validated);

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

// ---------------------------------------------------------------------------
// Authored nodes
// ---------------------------------------------------------------------------

/**
 * `follows` is an OBSERVATION ("is a response to"), never a dependency ("is built from"). It
 * draws no edge, contributes to no staleness, and triggers no rebuild (FR-019). When the
 * followed node's content differs from the baseline a human last accepted, the tracking node
 * asks a human to look — and stops there. Propagation halts at the human.
 *
 * Precedence (FR-022c): absence outranks needs-review, in both directions the requirement can
 * be read. Drift cannot be claimed on a node whose own file cannot be read, and it cannot be
 * claimed against a followed node whose file cannot be read either. Both are checked before
 * any drift comparison, so neither can be papered over with a claim about content nobody saw.
 */
async function resolveAuthoredNode(
  resolver: ContentResolver,
  ledger: Ledger,
  node: Node
): Promise<NodeStatus> {
  const report = (state: AuthoredState, cause: Cause): NodeStatus =>
    buildStatus(node.id, 'authored', state, cause, undefined);

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
    return report('absent', {
      code: 'path-absent',
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
  validated: 'passed' | 'failed' | undefined
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
  };
}

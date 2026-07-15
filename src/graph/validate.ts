import { reachableTargets } from '@/graph/reachable.js';
import type { EpisodeManifest, Profile, Identity } from '@/manifest/schema.js';

/**
 * Validates an EpisodeManifest against a Profile, refusing (by throwing) any
 * malformed graph. Never returns a partial result — a refusal is total.
 *
 * Refusals (each names the offending declaration, per FR-005):
 *   1. A dependency cycle among the targets this episode asked for.
 *   2. An `inputs` entry naming an identity that is neither authored nor a
 *      profile target (dangling dependency).
 *   3. A `follows` naming a non-existent identity.
 *   4. A manifest target the profile does not produce.
 *   5. `follows` declared on a derived node.
 *   6. An identity that is both authored AND a profile target.
 *
 * **What is validated is the REACHABLE set, not the profile's catalogue**
 * (FR-004, see `reachable.ts`). A profile enumerates every target the recipe
 * can produce; an episode selects a subset via `manifest.targets`, and the
 * graph is the closure of that selection. Rules 1, 2, 5 and 6 are questions
 * about NODES, so they are asked of the nodes this episode actually has.
 * Holding an episode to the inputs of a target it never asked for is what
 * would make a "generic, reusable recipe" usable by exactly one episode.
 *
 * Nothing is weakened by this. A cycle reachable from a declared target is
 * still refused, and a dangling input on any target the episode depends on is
 * still refused. A defect confined to a target the episode never asked for is
 * not this episode's problem — and it will be refused, correctly, the moment
 * some episode does ask for it.
 *
 * Rules 3 and 4 are NOT scoped this way, and deliberately:
 *   - Rule 4 is what DEFINES the selection, so it is checked against the whole
 *     catalogue and runs first. A target the profile cannot produce is refused
 *     by name, never silently dropped as "unreachable".
 *   - Rule 3 is about authored nodes, which are all in the graph regardless of
 *     reachability, and `follows` may name any known identity.
 *
 * `follows` is the advisory relationship ("is a response to"). It is drawn
 * only from authored nodes, never propagates, and never participates in
 * dependency resolution or cycle detection — it is not an edge in the
 * dependency graph at all.
 */
export function validateGraph(manifest: EpisodeManifest, profile: Profile): void {
  const authoredIds = new Set(Object.keys(manifest.authored));
  const targetIds = new Set(Object.keys(profile.targets));

  // Rule 4: every manifest target must be produced by the profile. FIRST, because it is the
  // precondition for reachability meaning anything: an undeclared target reaches nothing, and
  // reporting that as "not in the graph" instead of naming it would be a silent drop.
  for (const target of manifest.targets) {
    if (!targetIds.has(target)) {
      throw new Error(
        `Manifest target "${target}" is not produced by profile "${manifest.profile}" (declared targets: ${[...targetIds].join(', ') || '(none)'}).`
      );
    }
  }

  // The targets this episode actually asks for, transitively. Everything below that is a
  // question about a derived node is asked of exactly these.
  const reached = reachableTargets(manifest, profile);

  // Rule 6: an identity cannot be both authored and a derived node of THIS episode's graph.
  // An identity that is authored and also names an UNREACHABLE profile target is not a
  // conflict: the catalogue entry is not a node here, so the identity is unambiguously
  // authored and exactly one kind (FR-002).
  for (const id of authoredIds) {
    if (reached.has(id)) {
      throw new Error(
        `Identity "${id}" is declared both in authored and as a profile target — every node must be exactly one kind (authored or derived).`
      );
    }
  }

  // An identity is "known" if it is authored or a profile target.
  const knownIds = new Set<Identity>([...authoredIds, ...targetIds]);

  // Rule 3: `follows` must name an existing identity.
  for (const [id, decl] of Object.entries(manifest.authored)) {
    if (decl.follows !== undefined && !knownIds.has(decl.follows)) {
      throw new Error(
        `Authored node "${id}" declares follows: "${decl.follows}", which is not a known identity (not authored and not a profile target).`
      );
    }
  }

  // Rule 5: `follows` is meaningless on a derived node. `follows` is only a
  // field of AuthoredDecl, so a "derived node with follows" can only arise
  // if an identity is simultaneously authored (carrying follows) and a
  // reachable profile target (derived) — which rule 6 above already refuses.
  // We still check explicitly here so the offending identity is named against
  // this specific rule, in case rule ordering ever changes.
  for (const [id, decl] of Object.entries(manifest.authored)) {
    if (decl.follows !== undefined && reached.has(id)) {
      throw new Error(
        `Identity "${id}" declares follows on a derived node — follows is advisory and only meaningful on an authored node.`
      );
    }
  }

  // Rule 2: every `inputs` entry of a REACHABLE target must resolve to a known identity. This
  // is what makes `resolveStatus` total: every input of every node in the graph is itself a
  // node in the graph, so nothing can be asked about an identity that does not exist.
  //
  // Note that a reachable target's inputs are checked in FULL — the loop does not stop at the
  // first input that resolves. Scoping is by REACHABILITY, never by how far some other check
  // happened to get.
  for (const [targetId, decl] of Object.entries(profile.targets)) {
    if (!reached.has(targetId)) {
      continue;
    }
    for (const input of decl.inputs) {
      if (!knownIds.has(input)) {
        throw new Error(
          `Target "${targetId}" declares input "${input}", which is neither authored nor a profile target (dangling dependency).`
        );
      }
    }
  }

  // Rule 1: no dependency cycle among the targets this episode asked for. `inputs` is the only
  // edge considered here — `follows` never participates in cycle detection.
  detectCycle(manifest, profile, reached);
}

/**
 * Depth-first cycle detection over the dependency graph formed by `inputs`. Only derived
 * (target) nodes can form a cycle: authored nodes have no `inputs`, only an advisory
 * `follows`, which is excluded here by construction.
 *
 * The search is over the REACHABLE set and rooted at `manifest.targets`, so any cycle this
 * episode's declarations lead into is still caught — reachability is closed under `inputs`, so
 * a cycle downstream of a declared target is entirely inside `reached` and every one of its
 * members is discovered from some root. A cycle among targets the episode never asked for is
 * not this episode's problem, and refusing to answer `pc status` because of one would be
 * refusing over a graph the episode does not have.
 *
 * An identity outside `reached` is uncolored, so it is neither traversed nor mistaken for a
 * cycle member: `color.get` returns `undefined`, which is neither GRAY nor WHITE.
 */
function detectCycle(
  manifest: EpisodeManifest,
  profile: Profile,
  reached: ReadonlySet<Identity>
): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<Identity, number>();
  for (const id of reached) {
    color.set(id, WHITE);
  }

  const stack: Identity[] = [];

  function visit(id: Identity): void {
    const decl = profile.targets[id];
    // Only targets participate in cycle detection; an input naming an
    // authored identity is a leaf with no further inputs to traverse.
    if (decl === undefined) {
      return;
    }

    color.set(id, GRAY);
    stack.push(id);

    for (const input of decl.inputs) {
      const inputColor = color.get(input);
      if (inputColor === GRAY) {
        const cycleStart = stack.indexOf(input);
        const members = stack.slice(cycleStart);
        throw new Error(
          `Dependency cycle detected among targets: ${members.join(' -> ')} -> ${input}.`
        );
      }
      if (inputColor === WHITE) {
        visit(input);
      }
    }

    stack.pop();
    color.set(id, BLACK);
  }

  for (const id of manifest.targets) {
    if (color.get(id) === WHITE) {
      visit(id);
    }
  }
}

import type { EpisodeManifest, Profile, Identity } from '@/manifest/schema.js';

/**
 * Validates an EpisodeManifest against a Profile, refusing (by throwing) any
 * malformed graph. Never returns a partial result — a refusal is total.
 *
 * Refusals (each names the offending declaration, per FR-005):
 *   1. A dependency cycle among targets.
 *   2. An `inputs` entry naming an identity that is neither authored nor a
 *      profile target (dangling dependency).
 *   3. A `follows` naming a non-existent identity.
 *   4. A manifest target the profile does not produce.
 *   5. `follows` declared on a derived node.
 *   6. An identity that is both authored AND a profile target.
 *
 * `follows` is the advisory relationship ("is a response to"). It is drawn
 * only from authored nodes, never propagates, and never participates in
 * dependency resolution or cycle detection — it is not an edge in the
 * dependency graph at all.
 */
export function validateGraph(manifest: EpisodeManifest, profile: Profile): void {
  const authoredIds = new Set(Object.keys(manifest.authored));
  const targetIds = new Set(Object.keys(profile.targets));

  // Rule 6: an identity cannot be both authored and a profile target.
  for (const id of authoredIds) {
    if (targetIds.has(id)) {
      throw new Error(
        `Identity "${id}" is declared both in authored and as a profile target — every node must be exactly one kind (authored or derived).`
      );
    }
  }

  // Rule 4: every manifest target must be produced by the profile.
  for (const target of manifest.targets) {
    if (!targetIds.has(target)) {
      throw new Error(
        `Manifest target "${target}" is not produced by profile "${manifest.profile}" (declared targets: ${[...targetIds].join(', ') || '(none)'}).`
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
  // profile target (derived) — which rule 6 above already refuses. We still
  // check explicitly here so the offending identity is named against this
  // specific rule, in case rule ordering ever changes.
  for (const [id, decl] of Object.entries(manifest.authored)) {
    if (decl.follows !== undefined && targetIds.has(id)) {
      throw new Error(
        `Identity "${id}" declares follows on a derived node — follows is advisory and only meaningful on an authored node.`
      );
    }
  }

  // Rule 2: every `inputs` entry must resolve to a known identity.
  for (const [targetId, decl] of Object.entries(profile.targets)) {
    for (const input of decl.inputs) {
      if (!knownIds.has(input)) {
        throw new Error(
          `Target "${targetId}" declares input "${input}", which is neither authored nor a profile target (dangling dependency).`
        );
      }
    }
  }

  // Rule 1: no dependency cycle among targets. `inputs` is the only edge
  // considered here — `follows` never participates in cycle detection.
  detectCycle(profile);
}

/**
 * Depth-first cycle detection over the dependency graph formed by
 * `inputs`. Only derived (target) nodes can form a cycle: authored nodes
 * have no `inputs`, only an advisory `follows`, which is excluded here by
 * construction.
 */
function detectCycle(profile: Profile): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<Identity, number>();
  for (const id of Object.keys(profile.targets)) {
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

  for (const id of Object.keys(profile.targets)) {
    if (color.get(id) === WHITE) {
      visit(id);
    }
  }
}

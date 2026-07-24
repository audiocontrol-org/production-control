import type { EpisodeManifest, Profile, Identity } from '@/manifest/schema.js';

/**
 * A profile is a CATALOGUE; an episode SELECTS from it (FR-004).
 *
 * `profile.targets` enumerates every target the recipe knows how to produce. An episode's
 * `manifest.targets` names the ones it actually asks for. The set that matters to an episode
 * is therefore neither of those two: it is the CLOSURE of `manifest.targets` over `inputs` —
 * the declared targets plus every target they are transitively built from.
 *
 * This is what makes a profile reusable. `editorial-audio` can produce `podcast ← voiceover ←
 * narration` and `epub ← [longform, assets]`; an episode that declares only `epub` is not
 * thereby obliged to author `narration`, because it never asked for anything that needs it.
 * Treating the whole catalogue as the episode's graph would force every episode to author the
 * UNION of every target's inputs, and a profile would be usable by exactly one episode shape —
 * reusability in the header and nowhere else.
 *
 * An input naming something that is NOT a profile target (an authored node, or a dangling
 * identity) is a leaf here: there is nothing further to walk. Whether it resolves to anything
 * at all is `validateGraph`'s question, not this one — this function is pure reachability and
 * refuses nothing.
 *
 * A cycle among the walked targets does not hang the walk: an identity is added to `reached`
 * BEFORE its inputs are visited, so a second arrival at it terminates. Refusing the cycle is
 * `validateGraph`'s job, and it must be able to build this set in order to do it.
 */
export function reachableTargets(
  manifest: EpisodeManifest,
  profile: Profile
): ReadonlySet<Identity> {
  const reached = new Set<Identity>();

  const visit = (id: Identity): void => {
    if (reached.has(id)) {
      return;
    }
    const decl = profile.targets[id];
    // Not a profile target: an authored identity or a dangling one. Either way it produces
    // nothing, so the walk stops. Naming it is `validateGraph`'s business.
    if (decl === undefined) {
      return;
    }

    reached.add(id);
    for (const input of decl.inputs) {
      visit(input);
    }
  };

  for (const target of manifest.targets) {
    visit(target);
  }

  return reached;
}

import { reachableTargets } from '@/graph/reachable.js';
import type {
  EpisodeManifest,
  Profile,
  Identity,
  ProviderDecl,
  ValidatorDecl,
} from '@/manifest/schema.js';

export { validateGraph } from '@/graph/validate.js';

/**
 * A single node in the production graph. Every node is exactly one kind
 * (FR-002):
 *
 *   - `authored`: declared in `manifest.authored`. Carries `path` and,
 *     optionally, the advisory `follows` relationship. Has no producer, and
 *     therefore no `inputs`/`provider`.
 *   - `derived`: a `profile.targets` entry. Carries `inputs` (the dependency
 *     relationship — "is built from") and `provider`. Has no `path`.
 *
 * `follows` is never a dependency: it is drawn only from authored nodes, it
 * never appears in `inputs`, and it never participates in cycle detection.
 */
export interface Node {
  readonly id: Identity;
  readonly kind: 'authored' | 'derived';
  readonly path?: string;
  readonly follows?: Identity;
  readonly inputs?: readonly Identity[];
  readonly provider?: ProviderDecl;
  readonly validator?: ValidatorDecl;
}

export interface Graph {
  readonly nodes: ReadonlyMap<Identity, Node>;
  readonly targets: readonly Identity[];
}

/**
 * Constructs the production graph from a manifest and its profile. This is
 * pure construction — it does not refuse malformed input; call
 * `validateGraph` first (or separately) to enforce the refusal rules.
 *
 * The graph is the CLOSURE of `manifest.targets` over the dependency
 * relation, plus every authored node. It is NOT the profile's whole
 * catalogue (FR-004, see `reachable.ts`). Two rules, and both are
 * load-bearing:
 *
 *   - Every `manifest.authored` identity is a node. The operator declared it;
 *     its presence is a fact about the episode, not a consequence of anything
 *     consuming it. An authored file nobody builds from is still an authored
 *     file, and `pc status` must say so.
 *   - A profile target is a node only if it is reachable from
 *     `manifest.targets` by walking `inputs`. A target the episode never asked
 *     for — and nothing it asked for is built from — is absent from
 *     `graph.nodes` entirely: not validated, not resolved, not reported.
 *     Reporting it would answer a question the operator did not ask, about
 *     inputs they had no reason to author, and could not act on.
 *
 * `graph.targets` is exactly `manifest.targets` — what was ASKED FOR, which is
 * a narrower thing than what is in the graph (the closure also holds the
 * intermediate targets those declarations are built from).
 */
export function buildGraph(manifest: EpisodeManifest, profile: Profile): Graph {
  const nodes = new Map<Identity, Node>();

  for (const [id, decl] of Object.entries(manifest.authored)) {
    const node: Node = {
      id,
      kind: 'authored',
      path: decl.path,
      ...(decl.follows !== undefined ? { follows: decl.follows } : {}),
    };
    nodes.set(id, node);
  }

  // Iterating `profile.targets` (filtered) rather than the reachable set keeps node order
  // stable and declaration-driven: it does not depend on the order the closure happened to
  // discover things, which is an artifact of the walk and not a fact about the episode.
  const reached = reachableTargets(manifest, profile);
  for (const [id, decl] of Object.entries(profile.targets)) {
    if (!reached.has(id)) {
      continue;
    }
    const node: Node = {
      id,
      kind: 'derived',
      inputs: decl.inputs,
      provider: decl.provider,
      ...(decl.validator !== undefined ? { validator: decl.validator } : {}),
    };
    nodes.set(id, node);
  }

  return {
    nodes,
    targets: manifest.targets,
  };
}

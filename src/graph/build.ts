import type { EpisodeManifest, Profile, Identity, ProviderDecl } from '@/manifest/schema.js';

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
}

export interface Graph {
  readonly nodes: ReadonlyMap<Identity, Node>;
  readonly targets: readonly Identity[];
}

/**
 * Constructs the production graph from a manifest and its profile. This is
 * pure construction — it does not refuse malformed input; call
 * `validateGraph` first (or separately) to enforce the refusal rules.
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

  for (const [id, decl] of Object.entries(profile.targets)) {
    const node: Node = {
      id,
      kind: 'derived',
      inputs: decl.inputs,
      provider: decl.provider,
    };
    nodes.set(id, node);
  }

  return {
    nodes,
    targets: manifest.targets,
  };
}

import { describe, it, expect } from 'vitest';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import { validateGraph } from '@/graph/build.js';
import { classifyZone } from '@/zoning/index.js';

/**
 * US2 / FR-006 / D2b — the AUTHORED direction of INV-3: an authored node's declared path must
 * resolve to a human-safe location. A dot-zone is AI-permitted (`classifyZone`), so an authored
 * node routed there tells a human "safe to author in" while the path itself says the opposite
 * (INV-2). Quickstart Scenario 7 (`specs/003-content-zone-segregation/quickstart.md`).
 *
 * `validateGraph` (src/graph/validate.ts) does not yet implement this check — the authored-
 * direction refusal is T017, a separate task. The dot-zone case below is therefore EXPECTED to
 * be RED until T017 lands; it is committed RED on purpose (T015). The human-safe case passes
 * today because nothing refuses it, and must keep passing once T017 exists.
 */
describe('graph/validate — authored-direction zoning (US2, FR-006/D2b)', () => {
  // No derived targets are needed to exercise this rule — an authored node's path is a property
  // of the node itself, checked independently of anything the profile can produce.
  const emptyProfile: Profile = { version: 1, targets: {} };

  it('sanity: the fixture paths below actually classify the way this test relies on', () => {
    // Guards the test against a classifier drift silently turning both cases below into false
    // positives — this test's fixtures must classify exactly as INV-2 defines the zones.
    expect(classifyZone('.ai/draft.md')).toBe('ai-permitted');
    expect(classifyZone('article.mdx')).toBe('human-safe');
  });

  it('Scenario 7a: an authored node whose declared path is under a dot-zone is refused, naming the node', () => {
    const manifest: EpisodeManifest = {
      version: 1,
      id: 'test',
      title: 'Test',
      profile: 'test-profile',
      authored: {
        // `.ai/` is a dot-prefixed directory segment — ai-permitted, per `classifyZone`'s
        // any-dot-wins rule. An authored node has no business here (INV-1/INV-3, authored
        // direction): the graph calls this node human-authored while the path calls the
        // location AI-permitted, which is exactly the contradiction INV-3 forbids.
        longform: { path: '.ai/draft.md' },
      },
      targets: [],
    };

    expect(() => validateGraph(manifest, emptyProfile)).toThrow();
    // The refusal must NAME the offending node, per the "every refusal names the offense"
    // convention `validateGraph` already follows for every other rule (FR-005/FR-006).
    expect(() => validateGraph(manifest, emptyProfile)).toThrow(/longform/);
  });

  it('Scenario 7b: an authored node under a human-safe (dot-free) path is accepted', () => {
    const manifest: EpisodeManifest = {
      version: 1,
      id: 'test',
      title: 'Test',
      profile: 'test-profile',
      authored: {
        longform: { path: 'article.mdx' },
      },
      targets: [],
    };

    expect(() => validateGraph(manifest, emptyProfile)).not.toThrow();
  });
});

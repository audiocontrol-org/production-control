import { describe, it, expect } from 'vitest';
import type { EpisodeManifest, Profile, ProviderDecl } from '@/manifest/schema.js';
import { buildGraph, validateGraph } from '@/graph/build.js';

describe('graph/validate', () => {
  // Helper to construct a ProviderDecl
  const provider = (cmd: string[]): ProviderDecl => ({
    cmd,
  });

  // Case 5-11: validateGraph — every refusal names the offense (FR-005)
  describe('validateGraph', () => {
    it('Case 5: A CYCLE is refused and the error names the cycles members', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {},
        targets: ['a', 'b', 'c'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          a: {
            inputs: ['b'],
            provider: provider(['npx', 'tooling', 'build-a']),
          },
          b: {
            inputs: ['c'],
            provider: provider(['npx', 'tooling', 'build-b']),
          },
          c: {
            inputs: ['a'],
            provider: provider(['npx', 'tooling', 'build-c']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(/a.*b.*c|cycle|cycle members/i);
    });

    it('Case 6: A dangling inputs reference is refused, naming the missing identity', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          spoken: {
            path: 'script.md',
          },
        },
        targets: ['voiceover'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          voiceover: {
            inputs: ['narration'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(/narration/);
    });

    it('Case 7: A follows naming a non-existent identity is refused, naming it', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          spoken: {
            path: 'script.md',
          },
          narration: {
            path: 'narration.mp3',
            follows: 'nonexistent',
          },
        },
        targets: [],
      };

      const profile: Profile = {
        version: 1,
        targets: {},
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(/nonexistent/);
    });

    it('Case 7b (AUDIT-20260716-05/-31): follows naming an UNREACHABLE profile target is refused — it is not a node in this episode graph', () => {
      // `website` is in the profile catalogue, but this episode asks for `epub` and nothing it
      // asks for is built from `website`, so `website` is NOT a node in `buildGraph`'s output.
      // A `follows` pointing at it passes the old "known identity" check but makes
      // `resolveStatus`/`pc explain` throw at runtime ("not a node in this episode's graph").
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          longform: { path: 'article.mdx' },
          tracker: { path: 'tracker.md', follows: 'website' },
        },
        targets: ['epub'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          epub: { inputs: ['longform'], provider: provider(['npx', 'epub-tooling', 'build']) },
          // Exists in the catalogue, but unreachable from `epub`.
          website: { inputs: ['longform'], provider: provider(['npx', 'web-tooling', 'build']) },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      // Names both the offending declaration and the dangling followed identity (FR-005).
      expect(() => validateGraph(manifest, profile)).toThrow(/website/);
      expect(() => validateGraph(manifest, profile)).toThrow(/tracker/);
      // And `buildGraph` confirms the premise: `website` is genuinely not a node here.
      expect(buildGraph(manifest, profile).nodes.has('website')).toBe(false);
    });

    it('Case 7c: follows naming a REACHABLE profile target is still allowed — only unreachable targets are refused', () => {
      // The counterpart to 7b: an authored node may follow a target that IS a node of this
      // episode's graph. This must NOT be over-refused by the 7b fix.
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          longform: { path: 'article.mdx' },
          tracker: { path: 'tracker.md', follows: 'epub' },
        },
        targets: ['epub'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          epub: { inputs: ['longform'], provider: provider(['npx', 'epub-tooling', 'build']) },
        },
      };

      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });

    it('Case 8: A target in the manifest that the profile does not produce is refused, naming the target', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          longform: {
            path: 'article.mdx',
          },
        },
        targets: ['epub', 'podcast'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          epub: {
            inputs: ['longform'],
            provider: provider(['npx', 'epub-tooling', 'build']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(/podcast/);
    });

    it('Case 9: follows declared on a DERIVED node is refused', () => {
      // `follows` can only reach a derived node one way: an identity that is BOTH
      // authored-with-follows AND a profile target. The schema puts `follows` on
      // AuthoredDecl only, so there is no other route.
      //
      // The original fixture here declared `narration` authored WITH follows and fed it
      // to the derived target `voiceover` — but that is the `advisory` fixture's shape and
      // it is VALID. An authored node carrying an advisory edge is the whole point of the
      // feature; refusing it would break every advisory edge in the system.
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          spoken: {
            path: 'script.md',
          },
          // `voiceover` is authored AND a profile target — so its `follows` lands on a
          // node the profile says is derived.
          voiceover: {
            path: 'voiceover.wav',
            follows: 'spoken',
          },
        },
        targets: ['voiceover'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          voiceover: {
            inputs: ['spoken'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(/voiceover/i);
    });

    it('Case 9a: an authored node carrying `follows` that FEEDS a derived target is VALID', () => {
      // The counterpart to Case 9, and the case the system exists for: `narration follows
      // spoken` while `narration` is an input to `voiceover`. Advisory and dependency are
      // different relationships (data-model.md § Two kinds of relationship) and both must
      // coexist. This must NOT throw.
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          narration: { path: 'narration.mp3', follows: 'spoken' },
        },
        targets: ['voiceover'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          voiceover: {
            inputs: ['narration'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });

    it('Case 10: An identity that is both authored AND a profile target is refused', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          voiceover: {
            path: 'voiceover.mp3',
          },
        },
        targets: ['voiceover'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          voiceover: {
            inputs: ['narration'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).toThrow();
      expect(() => validateGraph(manifest, profile)).toThrow(
        /voiceover|both|authored|derived|duplicate/i
      );
    });

    it('Case 11: A VALID graph (matching editorial-audio.yaml shape) passes without throwing', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test-episode',
        title: 'Test Episode',
        profile: 'editorial-audio',
        authored: {
          longform: {
            path: 'article.mdx',
          },
          assets: {
            path: 'assets',
          },
          spoken: {
            path: 'script.md',
          },
          narration: {
            path: 'narration.mp3',
          },
        },
        targets: ['website', 'epub', 'voiceover', 'podcast', 'transcript'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          website: {
            inputs: ['longform', 'assets'],
            provider: provider(['npx', 'web-tooling', 'build']),
          },
          epub: {
            inputs: ['longform', 'assets'],
            provider: provider(['npx', 'epub-tooling', 'build']),
          },
          voiceover: {
            inputs: ['narration'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
          podcast: {
            inputs: ['voiceover'],
            provider: provider(['npx', 'audio-tooling', 'publish']),
          },
          transcript: {
            inputs: ['narration', 'spoken'],
            provider: provider(['npx', 'alignment-tooling', 'align']),
          },
        },
      };

      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });

    it('Case 11a: a dangling input is refused wherever it sits in the inputs list — scoping is by REACHABILITY, never by how far a check happened to get', () => {
      // `blocked` in tests/fixtures is `transcript ← [narration, spoken]` with `spoken`
      // unauthored, and `narration` comes FIRST. A fix that scoped validation by bailing at
      // the first unresolvable input would let that fixture pass for the wrong reason, and
      // would then break the moment someone reordered a profile's `inputs` list. The
      // reachable set is computed from the manifest, so position cannot matter — assert it
      // in both orders rather than trusting that it does not.
      const base = (
        inputs: readonly string[]
      ): { manifest: EpisodeManifest; profile: Profile } => ({
        manifest: {
          version: 1,
          id: 'test',
          title: 'Test',
          profile: 'test-profile',
          authored: { narration: { path: 'narration.mp3' } },
          targets: ['transcript'],
        },
        profile: {
          version: 1,
          targets: {
            transcript: {
              inputs: [...inputs],
              provider: provider(['npx', 'alignment-tooling', 'align']),
            },
          },
        },
      });

      // Dangling input LAST — the position a first-failure short-circuit would never reach.
      const last = base(['narration', 'spoken']);
      expect(() => validateGraph(last.manifest, last.profile)).toThrow(/spoken/);

      // Dangling input FIRST — same refusal, same name.
      const first = base(['spoken', 'narration']);
      expect(() => validateGraph(first.manifest, first.profile)).toThrow(/spoken/);
    });

    it('Case 11b: a cycle REACHABLE from a declared target is still refused; one among targets the episode never asked for is not its problem', () => {
      const cyclicProfile: Profile = {
        version: 1,
        targets: {
          epub: {
            inputs: ['longform'],
            provider: provider(['npx', 'epub-tooling', 'build']),
          },
          // A cycle sitting in the catalogue: a -> b -> a.
          a: { inputs: ['b'], provider: provider(['npx', 'tooling', 'build-a']) },
          b: { inputs: ['a'], provider: provider(['npx', 'tooling', 'build-b']) },
        },
      };

      const asks = (targets: readonly string[]): EpisodeManifest => ({
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: { longform: { path: 'article.mdx' } },
        targets: [...targets],
      });

      // Declaring `a` walks straight into the cycle: still a refusal, still named.
      expect(() => validateGraph(asks(['a']), cyclicProfile)).toThrow(/a.*b|cycle/i);

      // Declaring only `epub` reaches neither `a` nor `b`. Refusing to answer `pc status`
      // here would be refusing over a graph this episode does not have.
      expect(() => validateGraph(asks(['epub']), cyclicProfile)).not.toThrow();
      const graph = buildGraph(asks(['epub']), cyclicProfile);
      expect(graph.nodes.has('a')).toBe(false);
      expect(graph.nodes.has('b')).toBe(false);
    });
  });

  // Case 12: The advisory vs dependency distinction
  describe('advisory vs dependency distinction (FR-022)', () => {
    it('Case 12: follows must NOT be treated as an input', () => {
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          spoken: {
            path: 'script.md',
          },
          narration: {
            path: 'narration.mp3',
            follows: 'spoken',
          },
        },
        targets: [],
      };

      const profile: Profile = {
        version: 1,
        targets: {},
      };

      const graph = buildGraph(manifest, profile);

      // narration node must be authored (not derived), so it has no inputs
      const narrationNode = graph.nodes.get('narration')!;
      expect(narrationNode.kind).toBe('authored');
      expect(narrationNode.inputs).toBeUndefined();

      // narration must have follows, not inputs
      expect(narrationNode.follows).toBe('spoken');

      // follows must NOT appear in inputs
      // `?? []` is load-bearing: vitest's toContain rejects an `undefined` subject
      // outright — "the given combination of arguments (undefined and string) is invalid"
      // — even under `.not`. Asserted directly, this line fails for every correct
      // implementation, because an authored node's `inputs` is legitimately undefined.
      expect(narrationNode.inputs ?? []).not.toContain('spoken');

      // The graph must NOT have a dependency edge from narration to spoken
      // (confirmed by inputs being undefined, not containing 'spoken')
    });
  });
});

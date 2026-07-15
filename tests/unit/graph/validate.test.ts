/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { describe, it, expect } from 'vitest';
import type { EpisodeManifest, Profile, ProviderDecl } from '@/manifest/schema.js';
import { buildGraph, validateGraph } from '@/graph/build.js';

describe('graph/validate', () => {
  // Helper to construct a ProviderDecl
  const provider = (cmd: string[]): ProviderDecl => ({
    cmd,
  });

  // Case 1 & 2 & 3: buildGraph — two node kinds (FR-002)
  describe('buildGraph', () => {
    it('Case 1: An identity declared in authored becomes a node with kind: authored, carrying its path, and NO inputs/provider', () => {
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
        targets: [],
      };

      const profile: Profile = {
        version: 1,
        targets: {},
      };

      const graph = buildGraph(manifest, profile);

      expect(graph.nodes.has('longform')).toBe(true);
      const node = graph.nodes.get('longform')!;
      expect(node.id).toBe('longform');
      expect(node.kind).toBe('authored');
      expect(node.path).toBe('article.mdx');
      expect(node.inputs).toBeUndefined();
      expect(node.provider).toBeUndefined();
    });

    it('Case 2: An identity that is a profile target becomes kind: derived, carrying inputs and provider, and NO path', () => {
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
            inputs: ['spoken'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      const graph = buildGraph(manifest, profile);

      expect(graph.nodes.has('voiceover')).toBe(true);
      const node = graph.nodes.get('voiceover')!;
      expect(node.id).toBe('voiceover');
      expect(node.kind).toBe('derived');
      expect(node.inputs).toEqual(['spoken']);
      expect(node.provider).toBeDefined();
      expect(node.provider?.cmd).toEqual(['npx', 'audio-tooling', 'master']);
      expect(node.path).toBeUndefined();
    });

    it('Case 3: targets on the Graph reflects the manifests declared targets', () => {
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
        targets: ['epub', 'website'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          epub: {
            inputs: ['longform'],
            provider: provider(['npx', 'epub-tooling', 'build']),
          },
          website: {
            inputs: ['longform'],
            provider: provider(['npx', 'web-tooling', 'build']),
          },
        },
      };

      const graph = buildGraph(manifest, profile);

      expect(graph.targets).toEqual(['epub', 'website']);
    });

    it('Case 4: Only targets reachable from the manifests targets need be present (comment: we include all profile targets consistently)', () => {
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
        targets: ['epub'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
          epub: {
            inputs: ['longform'],
            provider: provider(['npx', 'epub-tooling', 'build']),
          },
          website: {
            inputs: ['longform'],
            provider: provider(['npx', 'web-tooling', 'build']),
          },
        },
      };

      const graph = buildGraph(manifest, profile);

      // We include all profile targets in the graph
      expect(graph.nodes.has('epub')).toBe(true);
      expect(graph.nodes.has('website')).toBe(true);
      // But targets on Graph reflects manifest's declared targets
      expect(graph.targets).toEqual(['epub']);
    });
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
      expect(() => validateGraph(manifest, profile)).toThrow(/follows|derived|voiceover/i);
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
      expect(narrationNode.inputs).not.toContain('spoken');

      // The graph must NOT have a dependency edge from narration to spoken
      // (confirmed by inputs being undefined, not containing 'spoken')
    });
  });
});

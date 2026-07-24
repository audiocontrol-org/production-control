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

    it('Case 4: Only targets reachable from the manifests targets are present — a profile is a catalogue an episode selects from (FR-004)', () => {
      // The profile can produce `website`, but this episode asked for `epub` and nothing it
      // asked for is built from `website`. So `website` is not in this episode's graph, and
      // its unauthored input (`gallery`) is not this episode's problem — which is the whole
      // of FR-004: if selecting `epub` obliged the episode to author `gallery` too, a
      // "generic, reusable recipe" would be usable by exactly one episode shape.
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
            // `gallery` is authored by NO episode here. Reachable, this would be a refusal.
            inputs: ['longform', 'gallery'],
            provider: provider(['npx', 'web-tooling', 'build']),
          },
        },
      };

      const graph = buildGraph(manifest, profile);

      // The declared target and its authored input are present...
      expect(graph.nodes.has('epub')).toBe(true);
      expect(graph.nodes.has('longform')).toBe(true);
      // ...and the unreachable profile target is ABSENT. Not present-but-ignored: absent.
      // A node in the graph is a node `pc status` reports on, and reporting `website` would
      // answer a question this operator never asked and cannot act on.
      expect(graph.nodes.has('website')).toBe(false);
      expect(graph.nodes.has('gallery')).toBe(false);

      // `targets` is what was ASKED FOR, which stays exactly the manifest's list.
      expect(graph.targets).toEqual(['epub']);

      // And the payoff: the unreachable target's dangling input is NOT a refusal.
      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });

    it('Case 4a: an INTERMEDIATE target — reachable via another target inputs, never declared — IS in the graph', () => {
      // The counterpart to Case 4, and the reason the rule is CLOSURE rather than "just the
      // declared targets": `chain` declares `podcast`, which is built from `voiceover`. Drop
      // `voiceover` from the graph and `podcast` has an input that is not a node — the exact
      // "Cannot resolve identity" failure that resolution must be structurally incapable of.
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          narration: { path: 'narration.mp3' },
        },
        targets: ['podcast'],
      };

      const profile: Profile = {
        version: 1,
        targets: {
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

      const graph = buildGraph(manifest, profile);

      expect(graph.nodes.has('podcast')).toBe(true);
      // Never declared, but `podcast` is built from it — so it is this episode's business.
      expect(graph.nodes.has('voiceover')).toBe(true);
      expect(graph.nodes.has('transcript')).toBe(false);
      // Declared targets, not the closure: `voiceover` is in the graph but was not asked for.
      expect(graph.targets).toEqual(['podcast']);

      // Every input of every node in the graph is itself a node in the graph. This is the
      // invariant `resolveStatus` relies on, so assert it directly rather than by proxy.
      for (const node of graph.nodes.values()) {
        for (const input of node.inputs ?? []) {
          expect(graph.nodes.has(input), `input "${input}" of "${node.id}" is not a node`).toBe(
            true
          );
        }
      }

      // `transcript`'s unauthored `spoken` is unreachable, so it is not a refusal.
      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });

    it('Case 4b: an authored node is in the graph even when nothing reachable consumes it', () => {
      // Authored presence is a FACT the operator declared, not a consequence of something
      // consuming it. An authored file nobody builds from is still an authored file.
      const manifest: EpisodeManifest = {
        version: 1,
        id: 'test',
        title: 'Test',
        profile: 'test-profile',
        authored: {
          longform: { path: 'article.mdx' },
          // Nothing reachable from `epub` is built from `narration`.
          narration: { path: 'narration.mp3' },
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
          voiceover: {
            inputs: ['narration'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };

      const graph = buildGraph(manifest, profile);

      expect(graph.nodes.get('narration')?.kind).toBe('authored');
      expect(graph.nodes.has('voiceover')).toBe(false);
      expect(() => validateGraph(manifest, profile)).not.toThrow();
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import { resolveStatus, type DerivedState, type EpisodeStatus } from '@/state/resolve.js';
import {
  makeTempEpisodeDir,
  cleanupTempDirs,
  writeAndHash,
  overwrite,
  provider,
  FIXED_TIMESTAMP,
  getNode,
} from './support.js';

/**
 * T041 — `modified` (data-model.md § Node state, FR-017a/FR-017b).
 *
 * Freshness order matters (data-model.md § Freshness): `stale` is evaluated FIRST, and the
 * output-edited check runs ONLY if no input moved. `modified` means a human edited a
 * machine-made output; `stale` means an input moved and the output was going to be replaced
 * anyway. The two states have OPPOSITE remedies — rebuilding a `stale` node is correct;
 * rebuilding a `modified` node destroys a human's work — which is exactly why they must never
 * be conflated.
 */
describe('state/resolve — modified (T041)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it(
    "Case 13: a built output's OWN bytes were edited while its inputs are UNCHANGED -> " +
      'modified, cause output-edited — NOT fresh',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const inputHash = await writeAndHash(episodeDir, 'script.md', 'script content, unedited');
      const recordedOutputHash = await writeAndHash(
        episodeDir,
        'dist/out.bin',
        'machine-built bytes'
      );
      // A human hand-edits the built output after the fact. The input never moved.
      await overwrite(episodeDir, 'dist/out.bin', 'hand-edited bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'modified-basic',
        title: 'modified: output edited, inputs unchanged',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      };
      const profile: Profile = {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { spoken: inputHash },
            output: { path: 'dist/out.bin', hash: recordedOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'out');

      expect(node.state).toBe('modified');
      expect(node.cause.code).toBe('output-edited');
      expect(node.state).not.toBe('fresh');
    }
  );

  it(
    'Case 14: a TERMINAL output (nothing downstream) is detected too — before FR-017a a ' +
      'hand-edited terminal artifact had unchanged inputs, reported fresh, and would have shipped',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const narrationHash = await writeAndHash(episodeDir, 'narration.wav', 'narration bytes');
      const voiceoverOutputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover.wav',
        'mastered bytes'
      );
      const recordedPodcastOutputHash = await writeAndHash(
        episodeDir,
        'dist/podcast.mp3',
        'podcast machine bytes'
      );
      // `podcast` is terminal: nothing in this graph declares it as an input to anything else.
      // A human patches it directly (e.g. a de-esser click, fixed by hand) after it was built.
      await overwrite(episodeDir, 'dist/podcast.mp3', 'podcast HAND-EDITED bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'modified-terminal',
        title: 'modified: terminal output',
        profile: 'test-profile',
        authored: { narration: { path: 'narration.wav' } },
        targets: ['voiceover', 'podcast'],
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
        },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { narration: narrationHash },
            output: { path: 'dist/voiceover.wav', hash: voiceoverOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
          podcast: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            // Unchanged relative to reality — voiceover's output has not moved.
            inputs: { voiceover: voiceoverOutputHash },
            output: { path: 'dist/podcast.mp3', hash: recordedPodcastOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const podcastNode = getNode(status, 'podcast');

      expect(podcastNode.state).toBe('modified');
      expect(podcastNode.cause.code).toBe('output-edited');
    }
  );

  it(
    'Case 15: stale WINS when the inputs ALSO moved — if the inputs changed, the output was ' +
      'going to be replaced anyway, so the divergence is not news',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const recordedInputHash = await writeAndHash(episodeDir, 'script.md', 'script v1');
      const recordedOutputHash = await writeAndHash(episodeDir, 'dist/out.bin', 'machine bytes v1');
      // Both moved: the input was revised AND the output was hand-edited.
      await overwrite(episodeDir, 'script.md', 'script v2 — revised');
      await overwrite(episodeDir, 'dist/out.bin', 'hand-edited bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'stale-wins',
        title: 'stale wins over modified',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      };
      const profile: Profile = {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { spoken: recordedInputHash },
            output: { path: 'dist/out.bin', hash: recordedOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'out');

      expect(node.state).toBe('stale');
      expect(node.state).not.toBe('modified');
      expect(node.cause.code).toBe('input-changed');
    }
  );

  it('Case 16: modified and stale are distinct states with OPPOSITE remedies — never conflated', async () => {
    async function buildModifiedOnlyScenario(): Promise<EpisodeStatus> {
      const episodeDir = await makeTempEpisodeDir();
      const inputHash = await writeAndHash(episodeDir, 'script.md', 'unchanged content');
      const recordedOutputHash = await writeAndHash(episodeDir, 'dist/out.bin', 'machine bytes');
      await overwrite(episodeDir, 'dist/out.bin', 'hand-edited bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'distinct-modified',
        title: 'distinct: modified only',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      };
      const profile: Profile = {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { spoken: inputHash },
            output: { path: 'dist/out.bin', hash: recordedOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };
      return resolveStatus({ episodeDir, manifest, profile, ledger });
    }

    async function buildStaleOnlyScenario(): Promise<EpisodeStatus> {
      const episodeDir = await makeTempEpisodeDir();
      const recordedInputHash = await writeAndHash(episodeDir, 'script.md', 'script v1');
      const recordedOutputHash = await writeAndHash(episodeDir, 'dist/out.bin', 'machine bytes v1');
      await overwrite(episodeDir, 'script.md', 'script v2 — revised, input moved only');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'distinct-stale',
        title: 'distinct: stale only',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      };
      const profile: Profile = {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { spoken: recordedInputHash },
            output: { path: 'dist/out.bin', hash: recordedOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };
      return resolveStatus({ episodeDir, manifest, profile, ledger });
    }

    const modifiedStatus = await buildModifiedOnlyScenario();
    const staleStatus = await buildStaleOnlyScenario();

    const modifiedNode = getNode(modifiedStatus, 'out');
    const staleNode = getNode(staleStatus, 'out');

    expect(modifiedNode.state).toBe('modified');
    expect(staleNode.state).toBe('stale');
    expect(modifiedNode.state).not.toBe(staleNode.state);

    // The two are distinct members of DerivedState — proven at the type level too.
    const modifiedState: DerivedState = 'modified';
    const staleState: DerivedState = 'stale';
    expect(modifiedState).not.toBe(staleState);
  });
});

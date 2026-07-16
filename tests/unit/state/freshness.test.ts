import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import { resolveStatus } from '@/state/resolve.js';
import {
  makeTempEpisodeDir,
  cleanupTempDirs,
  writeAndHash,
  provider,
  FIXED_TIMESTAMP,
  getNode,
} from './support.js';

/**
 * T022 — Freshness, driven through `resolveStatus` (data-model.md § Freshness, FR-008, FR-009).
 *
 * The freshness check is a declarative CONTENT comparison, never a computation over time:
 *
 *   for each declared input:
 *     current  = hash(resolve(input))
 *     recorded = ledger.artifacts[node].inputs[input]
 *     if current != recorded -> stale
 *
 * Every scenario below writes real bytes to a real temp dir and hashes them with `hashFile` —
 * never a fabricated hash — so a passing assertion actually proves something.
 */
describe('state/resolve — freshness (T022)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it('Case 1: ledger records inputs matching reality -> derived node is fresh, cause ok', async () => {
    const episodeDir = await makeTempEpisodeDir();
    const inputHash = await writeAndHash(episodeDir, 'script.md', 'the script, take one');
    const outputHash = await writeAndHash(episodeDir, 'dist/voiceover.wav', 'mastered audio bytes');

    const manifest: EpisodeManifest = {
      version: 1,
      id: 'freshness-fresh',
      title: 'Freshness: fresh',
      profile: 'test-profile',
      authored: { spoken: { path: 'script.md' } },
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
    const ledger: Ledger = {
      version: 1,
      artifacts: {
        voiceover: {
          producer: { tool: 'audio-tooling', version: '1.0.0' },
          inputs: { spoken: inputHash },
          output: { path: 'dist/voiceover.wav', hash: outputHash },
          built_at: FIXED_TIMESTAMP,
        },
      },
      reviews: {},
    };

    const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
    const node = getNode(status, 'voiceover');

    expect(node.state).toBe('fresh');
    expect(node.cause.code).toBe('ok');
  });

  it("Case 2: an input's CONTENT differs from the recorded hash -> stale, naming the changed input", async () => {
    const episodeDir = await makeTempEpisodeDir();
    const recordedInputHash = await writeAndHash(episodeDir, 'script.md', 'the script, take one');
    const outputHash = await writeAndHash(episodeDir, 'dist/voiceover.wav', 'mastered audio bytes');
    // The author revises the script AFTER the build recorded the old hash.
    await fs.writeFile(
      path.join(episodeDir, 'script.md'),
      'the script, take two — revised',
      'utf8'
    );

    const manifest: EpisodeManifest = {
      version: 1,
      id: 'freshness-stale',
      title: 'Freshness: stale',
      profile: 'test-profile',
      authored: { spoken: { path: 'script.md' } },
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
    const ledger: Ledger = {
      version: 1,
      artifacts: {
        voiceover: {
          producer: { tool: 'audio-tooling', version: '1.0.0' },
          inputs: { spoken: recordedInputHash },
          output: { path: 'dist/voiceover.wav', hash: outputHash },
          built_at: FIXED_TIMESTAMP,
        },
      },
      reviews: {},
    };

    const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
    const node = getNode(status, 'voiceover');

    expect(node.state).toBe('stale');
    expect(node.cause.code).toBe('input-changed');
    expect(node.cause.identity).toBe('spoken');
  });

  it('Case 3: never built (no ledger entry) -> missing, cause never-built', async () => {
    const episodeDir = await makeTempEpisodeDir();
    await writeAndHash(episodeDir, 'script.md', 'the script, never yet built from');

    const manifest: EpisodeManifest = {
      version: 1,
      id: 'freshness-missing',
      title: 'Freshness: missing',
      profile: 'test-profile',
      authored: { spoken: { path: 'script.md' } },
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
    const ledger: Ledger = { version: 1, artifacts: {}, reviews: {} };

    const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
    const node = getNode(status, 'voiceover');

    expect(node.state).toBe('missing');
    expect(node.cause.code).toBe('never-built');
  });

  it(
    'Case 4 (FR-008 regression — the most important case in this file): ' +
      'touch alone NEVER causes staleness',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const inputHash = await writeAndHash(episodeDir, 'script.md', 'the script, unedited');
      const outputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover.wav',
        'mastered audio bytes'
      );

      // Touch the input: move its mtime forward WITHOUT changing a single byte.
      const scriptPath = path.join(episodeDir, 'script.md');
      const originalStat = await fs.stat(scriptPath);
      const futureTime = new Date(originalStat.mtime.getTime() + 60 * 60 * 1000);
      await fs.utimes(scriptPath, futureTime, futureTime);

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'freshness-touch',
        title: 'Freshness: touch never stales',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
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
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { spoken: inputHash },
            output: { path: 'dist/voiceover.wav', hash: outputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'voiceover');

      expect(node.state).toBe('fresh');
      expect(node.cause.code).toBe('ok');
    }
  );

  it(
    "Case 5: an input that is another target — when the upstream's recorded output hash " +
      'no longer matches, the downstream is stale, naming the upstream',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const narrationHash = await writeAndHash(
        episodeDir,
        'assets/narration.wav',
        'narration take one'
      );
      // voiceover's ACTUAL current output — what resolving the identity `voiceover` means for
      // a downstream consumer: the bytes voiceover's own ledger record currently points at.
      const currentVoiceoverOutputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover.wav',
        'mastered take two'
      );
      // podcast's ledger recorded a DIFFERENT (older) hash for voiceover, from before voiceover
      // was rebuilt. Real bytes, real hash — just not the CURRENT ones.
      const stalePodcastInputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover-OLD.wav',
        'mastered take one'
      );
      const podcastOutputHash = await writeAndHash(episodeDir, 'dist/podcast.mp3', 'podcast bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'freshness-chain',
        title: 'Freshness: transitive via recorded output hash',
        profile: 'test-profile',
        authored: { narration: { path: 'assets/narration.wav' } },
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
            output: { path: 'dist/voiceover.wav', hash: currentVoiceoverOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
          podcast: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            // Recorded BEFORE voiceover was rebuilt — this is now stale relative to reality.
            inputs: { voiceover: stalePodcastInputHash },
            output: { path: 'dist/podcast.mp3', hash: podcastOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const podcastNode = getNode(status, 'podcast');

      expect(podcastNode.state).toBe('stale');
      expect(podcastNode.cause.code).toBe('input-changed');
      expect(podcastNode.cause.identity).toBe('voiceover');
    }
  );

  it(
    'Case 6 (AUDIT-20260716-03): an input REMOVED from the manifest -> stale, naming the removed ' +
      'input — the mirror of the added-input case, not a false-clean fresh',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      // The surviving declared input still matches the ledger exactly...
      const spokenHash = await writeAndHash(episodeDir, 'script.md', 'the surviving script');
      // ...and `coverart` is a real input the node WAS recorded as built from, whose bytes are
      // unchanged — the only thing that changed is that the manifest no longer declares it.
      const removedHash = await writeAndHash(episodeDir, 'coverart.png', 'cover art bytes');
      // ...and the output on disk still matches its recorded hash. Every content check passes;
      // only the input SET shrank.
      const outputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover.wav',
        'mastered audio bytes'
      );

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'freshness-input-removed',
        title: 'Freshness: input removed',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' }, coverart: { path: 'coverart.png' } },
        // `voiceover` no longer declares `coverart` as an input, though it was built from it.
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
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            // Recorded as built from BOTH — the manifest now declares only `spoken`.
            inputs: { spoken: spokenHash, coverart: removedHash },
            output: { path: 'dist/voiceover.wav', hash: outputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'voiceover');

      // Before the fix this reported `fresh`/`ok`: every surviving input and the output matched.
      expect(node.state).toBe('stale');
      expect(node.cause.code).toBe('input-removed');
      expect(node.cause.identity).toBe('coverart');
    }
  );

  it(
    'Case 7 (AUDIT-20260716-03 red-team): an ABSENT declared input still OUTRANKS a removed input ' +
      '(FR-006a) — blocked, not stale, even when the input set also shrank',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const spokenHash = await writeAndHash(episodeDir, 'script.md', 'the surviving script');
      // A newly declared input whose file does NOT exist -> absent -> blocked.
      // (`missing.md` is never written.)
      // A recorded input that is no longer declared -> would be `input-removed` on its own.
      const removedHash = await writeAndHash(episodeDir, 'coverart.png', 'cover art bytes');
      const outputHash = await writeAndHash(
        episodeDir,
        'dist/voiceover.wav',
        'mastered audio bytes'
      );

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'freshness-absent-outranks-removed',
        title: 'Freshness: absent outranks removed',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          missing: { path: 'missing.md' },
          coverart: { path: 'coverart.png' },
        },
        targets: ['voiceover'],
      };
      const profile: Profile = {
        version: 1,
        targets: {
          voiceover: {
            // `missing` is declared but absent; `coverart` was recorded but is no longer declared.
            inputs: ['spoken', 'missing'],
            provider: provider(['npx', 'audio-tooling', 'master']),
          },
        },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { spoken: spokenHash, coverart: removedHash },
            output: { path: 'dist/voiceover.wav', hash: outputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'voiceover');

      // The absent input is reported first, before any set-difference is examined.
      expect(node.state).toBe('blocked');
      expect(node.cause.code).toBe('input-absent');
      expect(node.cause.identity).toBe('missing');
    }
  );
});

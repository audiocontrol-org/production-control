import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import type { Hash } from '@/hash/content.js';
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

  /**
   * Case 5 (AUDIT-20260716-04) — the load-bearing invariant SC-004 / commit ff0d45e settles:
   * a derived input resolves to the hash the upstream's own ledger record CLAIMS
   * (`artifacts[voiceover].output.hash`), NOT to a re-hash of the bytes sitting at `output.path`
   * on disk. `dist/` is not committed, so the two readings genuinely diverge on a fresh clone /
   * after `rm -rf dist` / after a hand-edit, and only one of them is correct.
   *
   * To make this testable at all, the fixture must BREAK THE TIE the old Case 5 accidentally
   * hid: it writes voiceover's on-disk `dist/voiceover.wav` with bytes that hash to
   * `voiceoverDiskHash`, while voiceover's ledger records a DIFFERENT `voiceoverRecordHash` as
   * its `output.hash`. Every scenario below asserts podcast's state follows the RECORD, so a
   * refactor that re-hashed the file on disk (the naive, arguably more obvious implementation)
   * would flip the answer and fail here — which is exactly what the old fixture (disk hash ==
   * recorded hash) could not detect.
   */
  async function buildTiebreakerFixture(): Promise<{
    episodeDir: string;
    narrationHash: Hash;
    voiceoverRecordHash: Hash;
    voiceoverDiskHash: Hash;
    podcastOutputHash: Hash;
  }> {
    const episodeDir = await makeTempEpisodeDir();
    const narrationHash = await writeAndHash(
      episodeDir,
      'assets/narration.wav',
      'narration take one'
    );
    // The hash voiceover's ledger record claims for its output. Written to an AUXILIARY path
    // (never the manifest's `output.path`) purely to obtain a real, non-fabricated hash — the
    // bytes at this path are otherwise unused.
    const voiceoverRecordHash = await writeAndHash(
      episodeDir,
      'aux/voiceover-as-recorded.wav',
      'voiceover output — the bytes voiceover LEDGER RECORD claims it produced'
    );
    // The bytes ACTUALLY on disk at voiceover's `output.path` — deliberately DIFFERENT, so
    // record-resolution and disk-resolution cannot agree by accident.
    const voiceoverDiskHash = await writeAndHash(
      episodeDir,
      'dist/voiceover.wav',
      'voiceover output — the DIFFERENT bytes now sitting on disk'
    );
    const podcastOutputHash = await writeAndHash(episodeDir, 'dist/podcast.mp3', 'podcast bytes');

    // The whole test is only meaningful if the two candidate resolutions really differ.
    expect(voiceoverRecordHash).not.toBe(voiceoverDiskHash);

    return { episodeDir, narrationHash, voiceoverRecordHash, voiceoverDiskHash, podcastOutputHash };
  }

  function chainManifest(): EpisodeManifest {
    return {
      version: 1,
      id: 'freshness-chain',
      title: 'Freshness: transitive via recorded output hash',
      profile: 'test-profile',
      authored: { narration: { path: 'assets/narration.wav' } },
      targets: ['voiceover', 'podcast'],
    };
  }

  function chainProfile(): Profile {
    return {
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
  }

  it(
    'Case 5 (AUDIT-20260716-04): record-resolution says STALE while disk-resolution would say ' +
      "FRESH — podcast follows voiceover's RECORDED output hash, so it is stale, naming voiceover",
    async () => {
      const f = await buildTiebreakerFixture();

      // podcast was built from the bytes that now sit on DISK (`voiceoverDiskHash`). Voiceover's
      // RECORD, however, claims `voiceoverRecordHash`. Record-resolution: podcast's input
      // (diskHash) != resolve(voiceover) (recordHash) -> STALE. Disk-resolution would re-hash
      // dist/voiceover.wav to diskHash, which EQUALS podcast's input -> a false `fresh`.
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { narration: f.narrationHash },
            output: { path: 'dist/voiceover.wav', hash: f.voiceoverRecordHash },
            built_at: FIXED_TIMESTAMP,
          },
          podcast: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { voiceover: f.voiceoverDiskHash },
            output: { path: 'dist/podcast.mp3', hash: f.podcastOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({
        episodeDir: f.episodeDir,
        manifest: chainManifest(),
        profile: chainProfile(),
        ledger,
      });
      const podcastNode = getNode(status, 'podcast');

      // Passes ONLY under record-based resolution. A disk-based resolver reports `fresh` here.
      expect(podcastNode.state).toBe('stale');
      expect(podcastNode.cause.code).toBe('input-changed');
      expect(podcastNode.cause.identity).toBe('voiceover');
    }
  );

  it(
    'Case 5b (AUDIT-20260716-04, mirror): record-resolution says FRESH while disk-resolution ' +
      "would say STALE — podcast follows voiceover's RECORDED output hash, so it is fresh",
    async () => {
      const f = await buildTiebreakerFixture();

      // podcast was built from what voiceover's RECORD claims (`voiceoverRecordHash`). The bytes
      // on disk have since drifted to `voiceoverDiskHash`. Record-resolution: podcast's input
      // (recordHash) == resolve(voiceover) (recordHash) -> FRESH. Disk-resolution would re-hash
      // dist/voiceover.wav to diskHash != podcast's input -> a false `stale`.
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          voiceover: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { narration: f.narrationHash },
            output: { path: 'dist/voiceover.wav', hash: f.voiceoverRecordHash },
            built_at: FIXED_TIMESTAMP,
          },
          podcast: {
            producer: { tool: 'audio-tooling', version: '1.0.0' },
            inputs: { voiceover: f.voiceoverRecordHash },
            output: { path: 'dist/podcast.mp3', hash: f.podcastOutputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({
        episodeDir: f.episodeDir,
        manifest: chainManifest(),
        profile: chainProfile(),
        ledger,
      });
      const podcastNode = getNode(status, 'podcast');

      // Passes ONLY under record-based resolution. A disk-based resolver reports `stale` here.
      expect(podcastNode.state).toBe('fresh');
      expect(podcastNode.cause.code).toBe('ok');
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

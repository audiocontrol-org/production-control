import { describe, it, expect, afterEach } from 'vitest';
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
 * T061 — **producer version drift is REPORTED, and never auto-stales** (FR-016).
 *
 * FR-016 has two halves, and the second is the one with teeth: *report* that the producing tool
 * moved, and do **not** treat that alone as making the output stale. The failure this file
 * exists to catch is the natural-looking implementation of the first half that quietly delivers
 * the opposite of the second — comparing version strings and calling the artifact stale. Do that
 * and bumping a tool restales every episode ever built with it: hundreds of rebuilds producing
 * byte-identical artifacts, because a string changed. Staleness is a fact about CONTENT (FR-008,
 * FR-009), and a version is not content.
 *
 * The comparison basis is the ledger itself — see `producerDriftFor`. `src/state/` cannot invoke
 * a tool to ask its version (FR-010 makes reporting state execution-free, and
 * `tests/unit/architecture.test.ts` enforces it), but the ledger already knows every version each
 * tool has been recorded at. Two versions of one tool across a ledger IS the drift.
 */

/** Two targets, both produced by `audio-tooling`, both built from one authored input. */
function manifest(): EpisodeManifest {
  return {
    version: 1,
    id: 'drift',
    title: 'Drift',
    profile: 'test-profile',
    authored: { narration: { path: 'take.wav' } },
    targets: ['voiceover', 'podcast'],
  };
}

function profile(): Profile {
  return {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: provider(['audio-tooling', 'master']) },
      podcast: { inputs: ['narration'], provider: provider(['audio-tooling', 'publish']) },
    },
  };
}

/** A ledger recording both targets as consistently built, at the versions given. */
function ledgerAt(
  narrationHash: string,
  voiceoverHash: string,
  podcastHash: string,
  versions: { readonly voiceover: string; readonly podcast: string }
): Ledger {
  return {
    version: 1,
    artifacts: {
      voiceover: {
        producer: { tool: 'audio-tooling', version: versions.voiceover },
        inputs: { narration: narrationHash },
        output: { path: 'dist/voiceover.wav', hash: voiceoverHash },
        built_at: FIXED_TIMESTAMP,
        validation: { state: 'passed', at: FIXED_TIMESTAMP },
      },
      podcast: {
        producer: { tool: 'audio-tooling', version: versions.podcast },
        inputs: { narration: narrationHash },
        output: { path: 'dist/podcast.mp3', hash: podcastHash },
        built_at: FIXED_TIMESTAMP,
        validation: { state: 'passed', at: FIXED_TIMESTAMP },
      },
    },
    reviews: {},
  };
}

/** An episode whose two artifacts are genuinely consistent — real bytes, real hashes. */
async function episode(versions: { readonly voiceover: string; readonly podcast: string }) {
  const episodeDir = await makeTempEpisodeDir();
  const narration = await writeAndHash(episodeDir, 'take.wav', 'audio bytes');
  const voiceover = await writeAndHash(episodeDir, 'dist/voiceover.wav', 'mastered bytes');
  const podcast = await writeAndHash(episodeDir, 'dist/podcast.mp3', 'published bytes');

  return {
    episodeDir,
    manifest: manifest(),
    profile: profile(),
    ledger: ledgerAt(narration, voiceover, podcast, versions),
  };
}

describe('state/resolve — producer version drift (T061, FR-016)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it('one tool at one version -> no drift reported', async () => {
    // Non-vacuity for everything below: with the ledger agreeing with itself, the field is
    // absent. If it were always populated, the assertions in the next test would prove nothing.
    const status = await resolveStatus(await episode({ voiceover: '1.0.0', podcast: '1.0.0' }));

    expect(getNode(status, 'voiceover').producerDrift).toBeUndefined();
    expect(getNode(status, 'podcast').producerDrift).toBeUndefined();
  });

  it('**one tool recorded at two versions -> both artifacts REPORT the drift**', async () => {
    const status = await resolveStatus(await episode({ voiceover: '1.0.0', podcast: '1.2.0' }));

    // Each names its OWN recorded version, and the other version the same tool is recorded at.
    // A reader can act on this: two artifacts here were made by different versions of one tool.
    expect(getNode(status, 'voiceover').producerDrift).toEqual({
      tool: 'audio-tooling',
      recorded: '1.0.0',
      others: ['1.2.0'],
    });
    expect(getNode(status, 'podcast').producerDrift).toEqual({
      tool: 'audio-tooling',
      recorded: '1.2.0',
      others: ['1.0.0'],
    });
  });

  it('**drift NEVER makes anything stale** — the state is exactly what it was (FR-016)', async () => {
    const same = await resolveStatus(await episode({ voiceover: '1.0.0', podcast: '1.0.0' }));
    const drifted = await resolveStatus(await episode({ voiceover: '1.0.0', podcast: '9.9.9' }));

    // ** THE ASSERTION THIS FILE EXISTS FOR. ** Every input hash still matches, every output is
    // the bytes that were recorded, so every node is fresh — and a version string moving does
    // not change that. If this ever fails, upgrading a tool just restaled every episode in the
    // repository, and every one of those rebuilds would produce identical bytes.
    expect(getNode(drifted, 'voiceover').state).toBe('fresh');
    expect(getNode(drifted, 'podcast').state).toBe('fresh');
    expect(getNode(drifted, 'podcast').cause.code).toBe('ok');

    // Not "still fresh by luck": state-for-state identical to the undrifted episode.
    expect(drifted.nodes.map((node) => [node.id, node.state])).toEqual(
      same.nodes.map((node) => [node.id, node.state])
    );

    // And the recorded verdict is untouched too — drift is not a reason to distrust a validation.
    expect(getNode(drifted, 'podcast').validated).toBe('passed');
  });

  it('drift is scoped to ONE tool — a different tool at a different version is not drift', async () => {
    const base = await episode({ voiceover: '1.0.0', podcast: '1.0.0' });
    const podcast = base.ledger.artifacts.podcast;
    if (podcast === undefined) {
      throw new Error('fixture ledger has no podcast record');
    }

    // `podcast` is now made by an entirely different tool. Two tools each at one version is not
    // a tool that moved — reporting it would be noise on every episode with a mixed toolchain,
    // which is every real one.
    const status = await resolveStatus({
      ...base,
      ledger: {
        ...base.ledger,
        artifacts: {
          ...base.ledger.artifacts,
          podcast: { ...podcast, producer: { tool: 'other-tooling', version: '4.0.0' } },
        },
      },
    });

    expect(getNode(status, 'voiceover').producerDrift).toBeUndefined();
    expect(getNode(status, 'podcast').producerDrift).toBeUndefined();
  });

  it('an AUTHORED node never reports drift — nothing produces it (FR-006)', async () => {
    const status = await resolveStatus(await episode({ voiceover: '1.0.0', podcast: '1.2.0' }));

    expect(getNode(status, 'narration').kind).toBe('authored');
    expect(getNode(status, 'narration').producerDrift).toBeUndefined();
  });

  it('a never-built node reports no drift — there is no recorded producer to compare', async () => {
    const base = await episode({ voiceover: '1.0.0', podcast: '1.2.0' });
    const voiceover = base.ledger.artifacts.voiceover;
    if (voiceover === undefined) {
      throw new Error('fixture ledger has no voiceover record');
    }

    const status = await resolveStatus({
      ...base,
      ledger: { ...base.ledger, artifacts: { voiceover } },
    });

    expect(getNode(status, 'podcast').state).toBe('missing');
    expect(getNode(status, 'podcast').producerDrift).toBeUndefined();
  });
});

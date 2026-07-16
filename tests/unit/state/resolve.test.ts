import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import { resolveStatus, type AuthoredState, type EpisodeStatus } from '@/state/resolve.js';
import { assessRelease } from '@/state/release.js';
import {
  makeTempEpisodeDir,
  cleanupTempDirs,
  writeAndHash,
  overwrite,
  provider,
  emptyLedger,
  FIXED_TIMESTAMP,
  getNode,
} from './support.js';

/**
 * T023 + T024 — the state model itself (data-model.md § Node state, § Two kinds of
 * relationship; FR-006, FR-006a, FR-006b, FR-007, FR-020, FR-022c).
 *
 * A note on Cases 8 and 11 (`follows`/`needs-review`): the ledger schema's ONLY stored
 * anchor for "has a human already looked at this drift" is `Ledger.reviews[id].waived_hash`
 * (data-model.md § Waiver — "applies only to the change it was recorded against"). These
 * tests therefore treat a `reviews` entry as the accepted BASELINE — the hash of the followed
 * node at the moment a human last confirmed the tracker was in sync — and assert
 * `needs-review` fires when the followed node's CURRENT content diverges from that baseline.
 * This is the most literal reading of "needs-review is raised when the tracked node's current
 * hash differs from waived_hash" (data-model.md line ~129) and is the only reading the schema
 * supports without inventing an undocumented field.
 */
describe('state/resolve — state model (T023 + T024)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it(
    'Case 6: an AUTHORED node never reports stale — it has no producer, so staleness is not ' +
      'a question that can be asked of it. Its state is one of present/absent/needs-review only',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      await writeAndHash(episodeDir, 'article.mdx', 'hello world');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'authored-only',
        title: 'Authored only',
        profile: 'test-profile',
        authored: { longform: { path: 'article.mdx' } },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger = emptyLedger();

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'longform');

      expect(node.kind).toBe('authored');
      const allowedAuthoredStates: readonly AuthoredState[] = ['present', 'absent', 'needs-review'];
      expect(allowedAuthoredStates).toContain(node.state);
      expect(node.state).not.toBe('stale');
    }
  );

  it(
    'Case 7: blocked OUTRANKS stale (FR-006a) — one absent input AND one changed input ' +
      'reports blocked, not stale, naming the absent one',
    async () => {
      const episodeDir = await makeTempEpisodeDir();

      // `a` was recorded, then revised — it WOULD be stale on its own.
      const recordedAHash = await writeAndHash(episodeDir, 'a.md', 'a original');
      await overwrite(episodeDir, 'a.md', 'a revised');

      // `b` was recorded too, but is now gone entirely — absent.
      const recordedBHash = await writeAndHash(episodeDir, 'b.md', 'b original');
      await fs.rm(path.join(episodeDir, 'b.md'));

      const outputHash = await writeAndHash(episodeDir, 'dist/out.bin', 'built output bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'precedence-blocked-over-stale',
        title: 'blocked outranks stale',
        profile: 'test-profile',
        authored: { a: { path: 'a.md' }, b: { path: 'b.md' } },
        targets: ['out'],
      };
      const profile: Profile = {
        version: 1,
        targets: {
          out: { inputs: ['a', 'b'], provider: provider(['npx', 'tooling', 'build']) },
        },
      };
      const ledger: Ledger = {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { a: recordedAHash, b: recordedBHash },
            output: { path: 'dist/out.bin', hash: outputHash },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'out');

      expect(node.state).toBe('blocked');
      expect(node.cause.code).toBe('input-absent');
      expect(node.cause.identity).toBe('b');
    }
  );

  it(
    'Case 8: absent OUTRANKS needs-review (FR-022c) — an authored node whose OWN path is ' +
      'missing reports absent, not needs-review, even though its followed node also changed',
    async () => {
      const episodeDir = await makeTempEpisodeDir();

      // Baseline: a human previously confirmed `tracker` matched `spoken` at this hash.
      const baselineSpokenHash = await writeAndHash(episodeDir, 'script.md', 'script v1');
      // `spoken` then changes — this alone WOULD raise needs-review on `tracker`.
      await overwrite(episodeDir, 'script.md', 'script v2 — revised');
      // But `tracker`'s own declared path never exists on disk at all.

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'precedence-absent-over-needs-review',
        title: 'absent outranks needs-review',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          tracker: { path: 'tracker.md', follows: 'spoken' },
        },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger: Ledger = {
        version: 1,
        artifacts: {},
        reviews: {
          tracker: {
            waived_hash: baselineSpokenHash,
            reason: 'initial baseline: tracker recorded against script v1',
            at: FIXED_TIMESTAMP,
          },
        },
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'tracker');

      expect(node.state).toBe('absent');
      expect(node.cause.code).toBe('path-absent');
      expect(node.state).not.toBe('needs-review');
    }
  );

  it(
    'Case 8b (AUDIT-20260716-30): an authored node whose OWN path is present but whose FOLLOWED ' +
      'node is missing reports needs-review about ITSELF, not absent about the followed file',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      // `tracker`'s own declared file IS present and readable...
      await writeAndHash(episodeDir, 'tracker.md', 'the tracking part, present and readable');
      // ...but the node it follows, `spoken`, has NO file on disk (`script.md` never written).

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'followed-absent-is-not-my-absence',
        title: 'followed absent is not my absence',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          tracker: { path: 'tracker.md', follows: 'spoken' },
        },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger = emptyLedger();

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const tracker = getNode(status, 'tracker');

      // The followed node itself is genuinely absent (its own file is missing) — that is correct
      // and separate.
      expect(getNode(status, 'spoken').state).toBe('absent');

      // Before the fix `tracker` reported `absent`/`path-absent` — a claim about `spoken`'s file
      // carried on `tracker`, whose own bytes are present and readable. The truthful state
      // describes `tracker`'s situation: it cannot be reviewed until the followed node returns.
      expect(tracker.state).toBe('needs-review');
      expect(tracker.state).not.toBe('absent');
      expect(tracker.cause.code).toBe('followed-absent');
      expect(tracker.cause.code).not.toBe('path-absent');
      expect(tracker.cause.identity).toBe('spoken');
    }
  );

  it(
    'Case 8c (AUDIT-20260716-29): deleting the FOLLOWED node must NOT turn a blocked release ' +
      'green — an unresolved human question survives the deletion',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      // A human accepted `narration` against `spoken` at v1; `spoken` has since moved to v2, so
      // `narration` is needs-review and the release is blocked.
      const baselineHash = await writeAndHash(episodeDir, 'script.md', 'script v1');
      await writeAndHash(episodeDir, 'narration.wav', 'narration audio bytes');
      await overwrite(episodeDir, 'script.md', 'script v2 — revised');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'release-false-clean-on-delete',
        title: 'release false clean on delete',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          narration: { path: 'narration.wav', follows: 'spoken' },
        },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger: Ledger = {
        version: 1,
        artifacts: {},
        reviews: {
          narration: {
            waived_hash: baselineHash,
            reason: 'initial baseline: recorded against script v1',
            at: FIXED_TIMESTAMP,
          },
        },
      };

      // Non-vacuity: with `spoken` present-but-changed, the release IS blocked on narration.
      const before = await resolveStatus({ episodeDir, manifest, profile, ledger });
      expect(getNode(before, 'narration').state).toBe('needs-review');
      expect(assessRelease(before, []).releasable).toBe(false);

      // The mechanical way to "turn the light green" without a human: delete the followed file.
      await fs.rm(path.join(episodeDir, 'script.md'));

      const after = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const verdict = assessRelease(after, []);

      // Before the fix, narration went `absent` here and dropped out of the blocker set, so the
      // release reported clean. The human question has not been answered — it must still block.
      expect(getNode(after, 'narration').state).toBe('needs-review');
      expect(verdict.releasable).toBe(false);
      expect(verdict.blockers.map((b) => b.id)).toContain('narration');
    }
  );

  describe('Case 9: validation is a recorded fact, not a state (FR-006b)', () => {
    async function buildFreshScenario(validation?: {
      readonly state: 'passed' | 'failed';
      readonly at: string;
    }): Promise<EpisodeStatus> {
      const episodeDir = await makeTempEpisodeDir();
      const inputHash = await writeAndHash(episodeDir, 'script.md', 'validated content');
      const outputHash = await writeAndHash(episodeDir, 'dist/out.bin', 'built bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'validation-not-a-state',
        title: 'validation is not a state',
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
            output: { path: 'dist/out.bin', hash: outputHash },
            built_at: FIXED_TIMESTAMP,
            ...(validation !== undefined ? { validation } : {}),
          },
        },
        reviews: {},
      };

      return resolveStatus({ episodeDir, manifest, profile, ledger });
    }

    it('ledger validation ABSENT -> fresh, and validated is undefined', async () => {
      const status = await buildFreshScenario();
      const node = getNode(status, 'out');

      expect(node.state).toBe('fresh');
      expect(node.validated).toBeUndefined();
    });

    it('ledger validation "passed" -> fresh, validated: "passed"', async () => {
      const status = await buildFreshScenario({ state: 'passed', at: FIXED_TIMESTAMP });
      const node = getNode(status, 'out');

      expect(node.state).toBe('fresh');
      expect(node.validated).toBe('passed');
    });

    it('ledger validation "failed" -> state is invalid, validated: "failed"', async () => {
      const status = await buildFreshScenario({ state: 'failed', at: FIXED_TIMESTAMP });
      const node = getNode(status, 'out');

      expect(node.state).toBe('invalid');
      expect(node.validated).toBe('failed');
      expect(node.cause.code).toBe('validation-failed');
    });

    it('fresh-and-unvalidated is distinguishable from fresh-and-passed', async () => {
      const unvalidatedStatus = await buildFreshScenario();
      const passedStatus = await buildFreshScenario({ state: 'passed', at: FIXED_TIMESTAMP });

      const unvalidatedNode = getNode(unvalidatedStatus, 'out');
      const passedNode = getNode(passedStatus, 'out');

      expect(unvalidatedNode.state).toBe('fresh');
      expect(passedNode.state).toBe('fresh');
      expect(unvalidatedNode.validated).toBeUndefined();
      expect(passedNode.validated).toBe('passed');
      expect(unvalidatedNode.validated).not.toBe(passedNode.validated);
    });
  });

  it('Case 10: EVERY node in EVERY scenario carries a cause (FR-007)', async () => {
    // Scenario A: a plain fresh derived node plus its authored input.
    const episodeDirA = await makeTempEpisodeDir();
    const inputHashA = await writeAndHash(episodeDirA, 'script.md', 'content a');
    const outputHashA = await writeAndHash(episodeDirA, 'dist/out.bin', 'output a');
    const statusA = await resolveStatus({
      episodeDir: episodeDirA,
      manifest: {
        version: 1,
        id: 'cause-scenario-fresh',
        title: 'fresh',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      },
      profile: {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      },
      ledger: {
        version: 1,
        artifacts: {
          out: {
            producer: { tool: 'tooling', version: '1.0.0' },
            inputs: { spoken: inputHashA },
            output: { path: 'dist/out.bin', hash: outputHashA },
            built_at: FIXED_TIMESTAMP,
          },
        },
        reviews: {},
      },
    });

    // Scenario B: never built at all.
    const episodeDirB = await makeTempEpisodeDir();
    await writeAndHash(episodeDirB, 'script.md', 'content b');
    const statusB = await resolveStatus({
      episodeDir: episodeDirB,
      manifest: {
        version: 1,
        id: 'cause-scenario-missing',
        title: 'missing',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      },
      profile: {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      },
      ledger: emptyLedger(),
    });

    // Scenario C: a declared input that is absent and never built — whatever precedence
    // applies, the resulting node MUST still carry a cause.
    const episodeDirC = await makeTempEpisodeDir();
    const statusC = await resolveStatus({
      episodeDir: episodeDirC,
      manifest: {
        version: 1,
        id: 'cause-scenario-blocked',
        title: 'blocked',
        profile: 'test-profile',
        authored: { spoken: { path: 'script.md' } },
        targets: ['out'],
      },
      profile: {
        version: 1,
        targets: { out: { inputs: ['spoken'], provider: provider(['npx', 'tooling', 'build']) } },
      },
      ledger: emptyLedger(),
    });

    for (const status of [statusA, statusB, statusC]) {
      for (const node of status.nodes) {
        expect(node.cause).toBeDefined();
        expect(node.cause).not.toBeNull();
        expect(typeof node.cause.code).toBe('string');
        expect(typeof node.cause.message).toBe('string');
        expect(node.cause.message.length).toBeGreaterThan(0);
      }
    }
  });

  it(
    'Case 11: an authored node whose follows target CHANGED -> needs-review, cause ' +
      'followed-changed, naming the followed identity',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      const baselineHash = await writeAndHash(episodeDir, 'script.md', 'script v1');
      await writeAndHash(episodeDir, 'narration.wav', 'narration audio bytes');
      await overwrite(episodeDir, 'script.md', 'script v2 — revised');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'advisory-drift',
        title: 'advisory drift',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          narration: { path: 'narration.wav', follows: 'spoken' },
        },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger: Ledger = {
        version: 1,
        artifacts: {},
        reviews: {
          narration: {
            waived_hash: baselineHash,
            reason: 'initial baseline: recorded against script v1',
            at: FIXED_TIMESTAMP,
          },
        },
      };

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'narration');

      expect(node.state).toBe('needs-review');
      expect(node.cause.code).toBe('followed-changed');
      expect(node.cause.identity).toBe('spoken');
    }
  );

  it('Case 12: an authored node present, nothing tracked -> present', async () => {
    const episodeDir = await makeTempEpisodeDir();
    await writeAndHash(episodeDir, 'article.mdx', 'hello world, nothing tracked');

    const manifest: EpisodeManifest = {
      version: 1,
      id: 'authored-present',
      title: 'present, nothing tracked',
      profile: 'test-profile',
      authored: { longform: { path: 'article.mdx' } },
      targets: [],
    };
    const profile: Profile = { version: 1, targets: {} };
    const ledger = emptyLedger();

    const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
    const node = getNode(status, 'longform');

    expect(node.state).toBe('present');
    expect(node.cause.code).toBe('present');
  });
});

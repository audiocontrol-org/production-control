import { describe, it, expect, afterEach } from 'vitest';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import { resolveStatus, type EpisodeStatus } from '@/state/resolve.js';
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
 * This half covers validation-as-a-recorded-fact, the universal cause invariant, and the
 * advisory `follows`/`needs-review` cases (Cases 9, 10, 11, 11b, 12). A note on the
 * `follows`/`needs-review` cases: the ledger schema's ONLY stored anchor for "has a human
 * already looked at this drift" is `Ledger.reviews[id].waived_hash` (data-model.md § Waiver —
 * "applies only to the change it was recorded against"). These tests therefore treat a `reviews`
 * entry as the accepted BASELINE — the hash of the followed node at the moment a human last
 * confirmed the tracker was in sync — and assert `needs-review` fires when the followed node's
 * CURRENT content diverges from that baseline. This is the most literal reading of "needs-review
 * is raised when the tracked node's current hash differs from waived_hash" (data-model.md line
 * ~129) and is the only reading the schema supports without inventing an undocumented field.
 */
describe('state/resolve — state model (T023 + T024)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

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

  it(
    'Case 11b (AUDIT-20260716-12): the FRESH-INSTALL baseline — `follows` declared, both paths ' +
      'present on disk, `ledger.reviews` EMPTY (a human has NEVER run `pc review`) -> ' +
      'needs-review, cause followed-changed, naming the followed identity',
    async () => {
      const episodeDir = await makeTempEpisodeDir();
      // Both files are present and readable; nothing has drifted since authoring, because there
      // is no recorded baseline to have drifted FROM. `reviews` is `{}` — the day-one state.
      await writeAndHash(episodeDir, 'script.md', 'script v1, freshly authored');
      await writeAndHash(episodeDir, 'narration.wav', 'narration audio bytes');

      const manifest: EpisodeManifest = {
        version: 1,
        id: 'fresh-install-follows',
        title: 'fresh install follows',
        profile: 'test-profile',
        authored: {
          spoken: { path: 'script.md' },
          narration: { path: 'narration.wav', follows: 'spoken' },
        },
        targets: [],
      };
      const profile: Profile = { version: 1, targets: {} };
      const ledger = emptyLedger();

      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const node = getNode(status, 'narration');

      // The intended state, pinned explicitly. `reviewStatus` (src/state/resolve.ts) documents it:
      // "With no waiver recorded at all there is NO accepted baseline... That is `needs-review`,
      // not `present`" (data-model.md § Waiver; the only stored anchor for "a human has looked at
      // this" is `Ledger.reviews[id].waived_hash`, absent here). Reporting `present` on a fresh
      // install would be the exact false-clean the advisory `follows` edge exists to refuse:
      // declare `follows`, never review, and the system reports green while nobody ever confirmed
      // the tracker against the node it follows.
      expect(
        node.state,
        'a `follows` node with no recorded review must ask for one (data-model.md § Waiver)'
      ).toBe('needs-review');
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

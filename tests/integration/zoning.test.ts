import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { stringify } from 'yaml';
import type { InputResolver } from '@/assets/resolve.js';
import { untrackedCheck } from '@/assets/git-tracked.js';
import { buildGraph } from '@/graph/build.js';
import { readLedger } from '@/ledger/store.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import type { ProviderDecl } from '@/manifest/schema.js';
import type { BuildRequest, BuildResponse } from '@/providers/contract.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import { classifyZone } from '@/zoning/classify.js';
import { cleanupFixtureCopies, copyFixture, FIXTURES, REPO_ROOT, pc } from './support.js';

/**
 * Content zone segregation — User Story 1 (T006, T007, T010; specs/003-content-zone-segregation).
 *
 * These tests describe the POST-implementation behavior and are RED until the feature lands:
 *   - T011 renames the impure output root `ai-generated/` -> `.ai/` (build.ts).
 *   - T012/T013 add realpath-resolved containment and the zoning refusal itself.
 * See spec.md FR-007..FR-012 and quickstart.md Scenarios 1/2/5.
 *
 * T006 drives the real, built `pc` binary (mirrors `build.test.ts`'s impure-provider coverage,
 * but asserts the post-rename `.ai/` root). T007 and T010 build a `BuildContext` directly with a
 * fake `ProviderRunner` — the same idiom `path-safety.test.ts` uses to bypass the provider
 * contract's own wire-level schema refusals, which is required here because the scenarios under
 * test (an escaping path, a response the schema would otherwise reject before it ever reaches
 * production-control) cannot be produced by a real, schema-honest subprocess.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');

afterAll(async () => {
  await cleanupFixtureCopies();
});

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// T006 — real build, real binary, `pc build` (quickstart S1, FR-007/FR-008).
// ---------------------------------------------------------------------------

/**
 * The `chain` fixture with `voiceover` pointed at the real fake-provider subprocess.
 *
 * The fixture's `episode.yaml` declares `targets: [voiceover, podcast]` (`podcast ← [voiceover]`,
 * per `build.test.ts`'s `chainEpisode`), so the profile must declare both — a profile missing a
 * declared target is refused before the build under test ever runs. `podcast` is never built
 * here; it only needs to be present to satisfy that check.
 */
async function chainEpisode(): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd: [FAKE_PROVIDER] } },
      podcast: { inputs: ['voiceover'], provider: { cmd: [FAKE_PROVIDER] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

/** `FAKE_PROVIDER_MODE` reaches the provider through `pc`'s own environment, as in `build.test.ts`. */
function withMode(mode: string): { readonly env: NodeJS.ProcessEnv } {
  return { env: { ...process.env, FAKE_PROVIDER_MODE: mode } };
}

async function recordOf(dir: string, target: string): Promise<ArtifactRecord> {
  const ledger = await readLedger(dir);
  const record = ledger.artifacts[target];
  if (record === undefined) {
    const present = Object.keys(ledger.artifacts).join(', ');
    throw new Error(`No ledger record for "${target}". Recorded: ${present || '(none)'}.`);
  }
  return record;
}

describe(
  "T006 [US1]: an impure target's artifact is committed under `.ai/…`, " +
    'not `ai-generated/` or `dist/` (quickstart S1, FR-007/FR-008)',
  () => {
    it('routes the built artifact under the dot-zoned `.ai/` root, and its path classifies ai-permitted', async () => {
      const dir = await chainEpisode();

      const result = await pc(['build', 'voiceover', '--episode', dir], withMode('impure'));
      expect(result.stderr, 'build refused').toBe('');
      expect(result.code).toBe(0);

      const record = await recordOf(dir, 'voiceover');

      // ** THE ASSERTION. ** FR-007 renames the impure root from `ai-generated/` to `.ai/`.
      // This is RED today: the current code still writes `ai-generated/voiceover.out`.
      expect(record.output.path).toBe('.ai/voiceover.out');
      expect(await exists(path.join(dir, '.ai', 'voiceover.out'))).toBe(true);
      expect(await exists(path.join(dir, 'ai-generated', 'voiceover.out'))).toBe(false);

      // The path is human-legible as AI-permitted from the segment alone (INV-2) — the same
      // fact the machine channel (the ledger's `producer_impure`) already records.
      expect(classifyZone(record.output.path)).toBe('ai-permitted');
      expect(record.producer_impure).toBeDefined();
    });
  }
);

// ---------------------------------------------------------------------------
// Shared harness for T007/T010 — a `BuildContext` over a fake `ProviderRunner`, mirroring
// `path-safety.test.ts`'s `contextOver`/`noAssets` idiom.
// ---------------------------------------------------------------------------

/** A resolver that must never be consulted: the `chain` fixture's `narration` is a plain on-disk file. */
function noAssets(): InputResolver {
  return {
    resolveToLocalPath: () => {
      throw new Error('the asset resolver was consulted; this input should resolve from disk');
    },
  };
}

/**
 * A `BuildContext` over a copy of the `chain` fixture, whose `voiceover` target uses `runner`.
 *
 * `podcast` (also declared by the fixture's `episode.yaml`) is included, pointed at the same
 * `decl`, purely to satisfy the "every episode target is present in the profile" check —
 * `podcast` is never built by these tests.
 */
async function contextOver(
  dir: string,
  decl: ProviderDecl,
  runner: ProviderRunner
): Promise<BuildContext> {
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: decl },
      podcast: { inputs: ['voiceover'], provider: decl },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');

  const manifest = await loadEpisode(dir);
  const loaded = await loadProfile(manifest.profile, [dir, path.join(REPO_ROOT, 'profiles')]);
  const ledger = await readLedger(dir);

  return {
    episodeDir: dir,
    graph: buildGraph(manifest, loaded),
    ledger,
    runner,
    assets: noAssets(),
    tracked: untrackedCheck(),
    at: new Date().toISOString(),
  };
}

/**
 * A runner that writes a single real output at `relPath` (relative to the request's
 * `output_dir`, so an on-disk file exists for `invokeProvider` to hash) and declares it,
 * bypassing every wire-level schema check — exactly what `path-safety.test.ts`'s
 * `runnerEmitting` does. `relPath` may escape or point anywhere; that is the point of using a
 * fake runner instead of the real subprocess, whose `BuildResponse` the schema would refuse
 * before production-control ever saw it.
 */
function runnerEmitting(relPath: string, impure?: { readonly reason: string }): ProviderRunner {
  return {
    async run(request: BuildRequest): Promise<BuildResponse> {
      const full = path.resolve(request.output_dir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, 'produced bytes\n', 'utf8');
      return {
        version: 1,
        outputs: [{ path: relPath }],
        tool: { name: 'fake', version: '0.0.0' },
        ...(impure !== undefined ? { impure } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// T007 — a CONTAINED impure output resolving to a human-safe path is refused (quickstart S2,
// FR-011).
// ---------------------------------------------------------------------------

describe(
  'T007 [US1]: a CONTAINED impure output whose resolved destination is dot-free (human-safe) ' +
    'is refused, naming the path (quickstart S2, FR-011)',
  () => {
    /**
     * LIMITATION, read before changing this test: under the post-feature routing (FR-008), an
     * impure target's output root is ALWAYS the dot-zoned `.ai/` — the provider only controls
     * the path BENEATH that root (`output.path`; escape/containment there is T010's concern,
     * not this test's). So a provider cannot, through `output.path` alone, make a CONTAINED
     * impure output land on a human-safe destination: the root itself is dot-zoned by
     * construction, and there is no per-target override of it. The harness genuinely cannot
     * express "an impure build's output.path, unaided, resolves human-safe" as a scenario
     * distinct from T009's (symlinked OUTPUT FILE) or T010's (escaping path).
     *
     * The closest faithful construction of "a CONTAINED output whose *resolved* destination is
     * dot-free" (FR-010: zoning is evaluated on the realpath-resolved destination, not the
     * lexical one) is a pre-existing filesystem symlink AT the assigned root itself: `.ai` is
     * lexically dot-zoned, but is made a symlink to a real, human-safe directory. This is
     * deliberately a ROOT-level symlink, distinct from T009's per-output-FILE symlink, so it
     * does not duplicate that test's scenario. It is a legitimate proof of FR-010/FR-011 —
     * containment (the destination is genuinely inside the resolved root) and zoning (that
     * resolved root is human-safe) both apply, exactly as they would for any other pre-existing
     * dot-zone symlink an operator's filesystem might contain.
     */
    it('is refused even though the output is contained within the assigned (symlinked) root', async () => {
      const dir = await copyFixture('chain');

      // A real, human-safe directory the `.ai` root will secretly resolve into.
      const humanSafeReal = path.join(dir, 'escape');
      await fs.mkdir(humanSafeReal, { recursive: true });
      // The assigned impure root: lexically dot-zoned, but a symlink to a human-safe directory.
      await fs.symlink(humanSafeReal, path.join(dir, '.ai'));

      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('voiceover.out', {
        reason: 'emits a per-run nonce',
      });
      const context = await contextOver(dir, decl, runner);

      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(
        failure,
        'an impure output resolving (via the symlinked `.ai` root) to a human-safe path ' +
          'was accepted rather than refused — the zoning refusal (FR-011) does not exist yet'
      ).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      // The refusal must NAME the offending (resolved, human-safe) path.
      expect(message).toContain('escape');

      expect(await exists(path.join(humanSafeReal, 'voiceover.out'))).toBe(false);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });
  }
);

// ---------------------------------------------------------------------------
// T010 — an output escaping its assigned root is rejected as a containment violation,
// regardless of impurity, independent of zoning (quickstart S5, FR-009).
// ---------------------------------------------------------------------------

describe(
  'T010 [US1]: a provider output escaping its assigned root is rejected as a containment ' +
    'violation regardless of impurity (quickstart S5, FR-009)',
  () => {
    /**
     * This escape/containment check already exists today (`build.ts`'s `stage()`, exercised for
     * a PURE provider by `path-safety.test.ts`) — FR-009 requires it to fire "regardless of
     * impurity" and independent of/before zoning, which is untested for an IMPURE-declared
     * provider. To make this genuinely RED rather than incidentally green, the assertion pins
     * the refusal message to the POST-rename root name FR-007 introduces (`.ai/`, not the
     * current `ai-generated/`) — so this test only passes once T011's rename has landed,
     * proving the escape refusal continues to hold (and to name the right root) under the
     * renamed, dot-zoned routing.
     */
    it('an IMPURE-declared provider that returns an escaping path is refused, naming the escape', async () => {
      const dir = await copyFixture('chain');
      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('../evil.txt', { reason: 'emits a per-run nonce' });
      const context = await contextOver(dir, decl, runner);

      // Where the copy would land if the containment check were absent: a sibling of `.ai/`,
      // i.e. the episode root — outside any zone this feature governs.
      const escapedDestination = path.join(dir, 'evil.txt');

      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(
        failure,
        'an escaping output from an IMPURE provider was ingested rather than refused'
      ).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('escapes');
      expect(message).toContain('evil.txt');

      // ** THE RED ASSERTION. ** the refusal must name the POST-FR-007 dot-zoned root, not the
      // pre-feature `ai-generated/` name.
      expect(message).toContain('.ai/');
      expect(message).not.toContain('ai-generated');

      expect(await exists(escapedDestination)).toBe(false);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });
  }
);

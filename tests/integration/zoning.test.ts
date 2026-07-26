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
      // Declared impure: this fixture is always built with `FAKE_PROVIDER_MODE=impure` (below),
      // so its runtime response reports impure too — corroborating, not introducing, the static
      // declaration (FR-012). A pure declaration here would now be a refused contradiction.
      voiceover: {
        inputs: ['narration'],
        provider: {
          cmd: [FAKE_PROVIDER],
          impure: { reason: 'fake-provider fixture, impure mode' },
        },
      },
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

// ---------------------------------------------------------------------------
// T009 — a per-FILE symlink whose REAL target escapes the assigned `.ai/` root (into a human-safe
// path) is refused by realpath-resolved containment; distinct from T007's ROOT-level symlink
// (quickstart S2, FR-009/FR-010/FR-011).
// ---------------------------------------------------------------------------

describe(
  'T009 [US1]: an impure output whose lexical path is dot-zoned (`.ai/…`) but which resolves ' +
    'through a per-file symlink to a human-safe REAL target is refused (FR-009/FR-010/FR-011)',
  () => {
    /**
     * Distinct from T007: there the ASSIGNED ROOT (`.ai`) is itself the symlink, so the resolved
     * destination stays contained within the resolved (human-safe) root and ZONING (FR-011) is
     * what refuses it. HERE `.ai` is a real directory and a symlink BENEATH it (`.ai/link`) points
     * at a human-safe real directory OUTSIDE `.ai`. A lexically dot-zoned declared path
     * (`link/out.bin` → `.ai/link/out.bin`) therefore resolves, through the symlink, to
     * `<episode>/human/out.bin` — which ESCAPES the assigned `.ai/` root (FR-009 containment) and
     * is human-safe. The lexical guard cannot see this; only realpath-resolved containment can.
     *
     * RED before T012: the pre-realpath pipeline resolves `link/out.bin` lexically to
     * `.ai/link/out.bin`, judges it contained, writes the record, and RENAMEs onto it — following
     * the `.ai/link` symlink and depositing an AI artifact in the human-safe `human/` directory.
     */
    it('is refused: the resolved real destination escapes `.ai/` into a human-safe directory', async () => {
      const dir = await copyFixture('chain');

      // A real, human-safe directory OUTSIDE `.ai/`, reached only through a symlink beneath `.ai/`.
      const humanSafeReal = path.join(dir, 'human');
      await fs.mkdir(humanSafeReal, { recursive: true });
      // `.ai/` is a REAL directory here (unlike T007) — the escape is a per-file symlink under it.
      await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
      await fs.symlink(humanSafeReal, path.join(dir, '.ai', 'link'));

      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('link/out.bin', { reason: 'emits a per-run nonce' });
      const context = await contextOver(dir, decl, runner);

      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(
        failure,
        'an impure output resolving (via a per-file symlink) outside `.ai/` to a human-safe ' +
          'path was accepted rather than refused — realpath containment (FR-009) does not exist yet'
      ).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      // The refusal names the resolved, escaping human-safe path.
      expect(message).toContain('human');

      // The AI artifact was NOT deposited in the human-safe directory, and nothing was recorded.
      expect(await exists(path.join(humanSafeReal, 'out.bin'))).toBe(false);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });

    /**
     * Non-vacuity / channel (symlink to another dot-zone = allowed): a symlink BENEATH `.ai/` that
     * points to another location STILL WITHIN `.ai/` is legitimate — the resolved destination stays
     * contained and dot-zoned — so the build SUCCEEDS. This proves the new realpath checks refuse
     * ESCAPES, not symlinks as such.
     */
    it('allows a symlink beneath `.ai/` whose real target is also within `.ai/`', async () => {
      const dir = await copyFixture('chain');

      await fs.mkdir(path.join(dir, '.ai', 'nested'), { recursive: true });
      // `.ai/link` -> `.ai/nested`: resolves to a location still inside the dot-zoned root.
      await fs.symlink(path.join(dir, '.ai', 'nested'), path.join(dir, '.ai', 'link'));

      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('link/out.bin', { reason: 'emits a per-run nonce' });
      const context = await contextOver(dir, decl, runner);

      const record = await buildTarget(context, 'voiceover');

      // Recorded under the lexical dot-zoned path; the bytes land through the symlink inside `.ai/`.
      expect(record.output.path).toBe('.ai/link/out.bin');
      expect(classifyZone(record.output.path)).toBe('ai-permitted');
      expect(await exists(path.join(dir, '.ai', 'nested', 'out.bin'))).toBe(true);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeDefined();
    });

    /**
     * Channel (broken symlink): a symlink beneath `.ai/` whose target does not exist cannot yield a
     * valid artifact — it is refused and nothing is recorded. The guarantee under test is "refused,
     * no artifact", not the exact wording of the underlying resolution failure.
     */
    it('refuses a broken symlink beneath `.ai/`, recording nothing', async () => {
      const dir = await copyFixture('chain');

      await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
      await fs.symlink(path.join(dir, 'does-not-exist'), path.join(dir, '.ai', 'link'));

      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('link/out.bin', { reason: 'emits a per-run nonce' });
      const context = await contextOver(dir, decl, runner);

      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(failure, 'a broken symlink beneath `.ai/` was not refused').toBeInstanceOf(Error);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });

    /**
     * Channel + security property (final-component symlink): containment realpath-resolves the
     * destination's PARENT and appends the basename — it deliberately does NOT resolve the final
     * component, because the atomic `rename` in step 6 REPLACES a symlink at the destination path
     * rather than following it. So a pre-planted symlink AT the destination (`.ai/voiceover.out` ->
     * a human-safe file) is overwritten in place with a real file under `.ai/`; the AI bytes are
     * NEVER written through the link to its human-safe target. This locks that behavior against a
     * future refactor that naively realpaths the whole destination (which would either misclassify
     * or write through the link).
     */
    it('replaces a final-component symlink in place rather than writing through it', async () => {
      const dir = await copyFixture('chain');

      await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
      // A human-safe authored file the destination symlink points at; it must remain UNTOUCHED.
      const authored = path.join(dir, 'human-file.txt');
      await fs.writeFile(authored, 'AUTHORED\n', 'utf8');
      // `.ai/voiceover.out` is itself a symlink to the authored human-safe file.
      await fs.symlink(authored, path.join(dir, '.ai', 'voiceover.out'));

      const decl: ProviderDecl = {
        cmd: ['unused'],
        impure: { reason: 'declared impure for this test' },
      };
      const runner = runnerEmitting('voiceover.out', { reason: 'emits a per-run nonce' });
      const context = await contextOver(dir, decl, runner);

      const record = await buildTarget(context, 'voiceover');

      // Recorded under `.ai/`, and the destination is now a REAL file (the link was replaced).
      expect(record.output.path).toBe('.ai/voiceover.out');
      const destLstat = await fs.lstat(path.join(dir, '.ai', 'voiceover.out'));
      expect(destLstat.isSymbolicLink(), 'the destination symlink was followed, not replaced').toBe(
        false
      );
      // The human-safe target was NEVER written through: its authored bytes are intact.
      expect(await fs.readFile(authored, 'utf8')).toBe('AUTHORED\n');
    });
  }
);

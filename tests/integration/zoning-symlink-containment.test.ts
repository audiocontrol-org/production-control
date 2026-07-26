import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify } from 'yaml';
import type { InputResolver } from '@/assets/resolve.js';
import { untrackedCheck } from '@/assets/git-tracked.js';
import { buildGraph } from '@/graph/build.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import type { ProviderDecl } from '@/manifest/schema.js';
import type { BuildRequest, BuildResponse } from '@/providers/contract.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import { copyFixture, REPO_ROOT } from './support.js';

/**
 * Content zone segregation — symlinked-output-ROOT and pre-mkdir symlink escapes
 * (AUDIT-03 / AUDIT-05; specs/003-content-zone-segregation FR-009/FR-010, quickstart S4/S5).
 *
 * These extend `zoning.test.ts`'s T007/T009/T010 symlink coverage with two escapes those tests
 * do NOT reach:
 *
 *   AUDIT-03 — the OUTPUT ROOT ITSELF is a symlink (`.ai`/`dist` -> elsewhere). The pre-fix
 *   realpath containment resolved the root and then measured containment RELATIVE TO WHERE THE
 *   ROOT POINTS, so a symlinked root passed and bytes landed outside the episode. For PURE output
 *   there is no zoning guard (d) at all, so a symlinked `dist/` was unchecked write-anywhere.
 *
 *   AUDIT-05 — a nested output path (`.ai/link/deep/out.bin`) traverses a symlinked directory
 *   (`.ai/link -> ../human`). The pre-fix `fs.mkdir(dirname(destination), {recursive})` ran BEFORE
 *   realpath containment, so the recursive mkdir FOLLOWED the symlink and created directories in a
 *   human-safe / outside-root area before the refusal fired.
 *
 * The harness mirrors `zoning.test.ts`: a `BuildContext` over a copy of the `chain` fixture, with a
 * fake `ProviderRunner` (`runnerEmitting`) that bypasses the wire-level schema — the only way to
 * express a response a schema-honest subprocess could never emit.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

/** A resolver that must never be consulted: the `chain` fixture's `narration` is a plain on-disk file. */
function noAssets(): InputResolver {
  return {
    resolveToLocalPath: () => {
      throw new Error('the asset resolver was consulted; this input should resolve from disk');
    },
  };
}

/**
 * A runner that writes a single real output at `relPath` (relative to the request's `output_dir`)
 * and declares it, bypassing every wire-level schema check — exactly `zoning.test.ts`'s
 * `runnerEmitting`. Omit `impure` to declare the provider PURE (routes under `dist/`).
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

/** A `BuildContext` over a copy of the `chain` fixture whose `voiceover` target uses `runner`. */
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

/** A directory OUTSIDE any episode, tracked for cleanup, the escaped roots point at. */
async function outsideEpisodeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-outside-'));
  tempDirs.push(dir);
  return dir;
}

const IMPURE: ProviderDecl = {
  cmd: ['unused'],
  impure: { reason: 'declared impure for this test' },
};
const PURE: ProviderDecl = { cmd: ['unused'] };

// ---------------------------------------------------------------------------
// AUDIT-03 — a symlinked OUTPUT ROOT relocates the whole zone; refuse naming the root.
// ---------------------------------------------------------------------------

describe(
  'AUDIT-03 [US1]: an output ROOT that is a symlink to a directory OUTSIDE the episode is ' +
    'refused, naming the root, with no bytes written outside and nothing recorded (FR-009)',
  () => {
    /**
     * Channel: IMPURE root (`.ai`) symlinked outside. Pre-fix, `realOutputRoot` resolved to the
     * outside dir, the destination sat under it, containment PASSED, and impure bytes landed
     * outside the episode while the ledger recorded `.ai/voiceover.out`.
     */
    it('refuses a `.ai/` root symlinked outside the episode (impure target)', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);
      const outside = await outsideEpisodeDir();
      await fs.symlink(outside, path.join(dir, '.ai'));

      const context = await contextOver(
        dir,
        IMPURE,
        runnerEmitting('voiceover.out', IMPURE.impure)
      );
      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(failure, 'a `.ai/` root symlinked outside the episode was accepted').toBeInstanceOf(
        Error
      );
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('.ai/');
      // No bytes escaped AT ALL (not just under this one name — AUDIT-10), and the ledger
      // recorded nothing. A directory-emptiness assertion holds under every reading of where
      // provider scratch lives, so a residual escape under any name still trips it.
      expect(await fs.readdir(outside)).toEqual([]);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });

    /**
     * Channel: PURE root (`dist`) symlinked outside — the dangerous one, because zoning (d) is
     * impure-only, so BEFORE this fix there was NO remaining guard at all: a symlinked `dist/`
     * was unchecked write-anywhere. The root-containment assertion (c0) is the only thing that
     * refuses it.
     */
    it('refuses a `dist/` root symlinked outside the episode (PURE target — no zoning guard)', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);
      const outside = await outsideEpisodeDir();
      // `dist/` is created by the build's scratch step; plant the symlink up front so the real
      // `dist/` is never a plain directory.
      await fs.symlink(outside, path.join(dir, 'dist'));

      const context = await contextOver(dir, PURE, runnerEmitting('voiceover.out'));
      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(failure, 'a `dist/` root symlinked outside the episode was accepted').toBeInstanceOf(
        Error
      );
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('dist/');
      expect(await exists(path.join(outside, 'voiceover.out'))).toBe(false);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });

    /**
     * Channel: root symlinked to an IN-EPISODE but human-safe directory. Still refused — the
     * output root must be the episode's OWN `.ai/`, not a per-target-relocatable alias. (This is
     * the escape `zoning.test.ts`'s T007 constructs; here it is asserted to be caught by root
     * containment, naming the root, independent of the zoning classifier.)
     */
    it('refuses a `.ai/` root symlinked to an in-episode human-safe directory', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);
      const humanSafe = path.join(dir, 'escape');
      await fs.mkdir(humanSafe, { recursive: true });
      await fs.symlink(humanSafe, path.join(dir, '.ai'));

      const context = await contextOver(
        dir,
        IMPURE,
        runnerEmitting('voiceover.out', IMPURE.impure)
      );
      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('escape');
      // Nothing landed in the in-episode human-safe target dir (AUDIT-10: emptiness, not a probe).
      expect(await fs.readdir(humanSafe)).toEqual([]);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });
  }
);

// ---------------------------------------------------------------------------
// AUDIT-05 — a nested output path through a symlinked directory must not materialize any
// directory outside the real output root before the refusal fires.
// ---------------------------------------------------------------------------

describe(
  'AUDIT-05 [US1]: a nested output path traversing a symlinked directory is refused with NO ' +
    'directory created in the human-safe / outside-root area (FR-009)',
  () => {
    /**
     * `.ai/link -> ../human` (a human-safe directory beside `.ai/`), output `link/deep/out.bin`.
     * Pre-fix, `fs.mkdir(dirname(destination), {recursive})` ran BEFORE containment and FOLLOWED
     * `.ai/link`, creating `<episode>/human/deep` before the refusal. The escaped directory must
     * NOT exist after the refusal.
     */
    it('does not create `human/deep` when `.ai/link -> ../human` and output is `link/deep/out.bin`', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);
      const humanSafe = path.join(dir, 'human');
      await fs.mkdir(humanSafe, { recursive: true });
      await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
      // A relative symlink escaping `.ai/` back up into the human-safe sibling.
      await fs.symlink(path.join('..', 'human'), path.join(dir, '.ai', 'link'));

      const context = await contextOver(
        dir,
        IMPURE,
        runnerEmitting('link/deep/out.bin', IMPURE.impure)
      );
      const failure = await buildTarget(context, 'voiceover').then(
        () => null,
        (error: unknown) => error
      );

      expect(failure, 'a nested output through a symlinked dir was accepted').toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('human');

      // ** THE ASSERTION. ** the escaped directory was NEVER materialized outside the real root.
      expect(await exists(path.join(humanSafe, 'deep')), 'a directory escaped into human/').toBe(
        false
      );
      expect(await exists(path.join(humanSafe, 'deep', 'out.bin'))).toBe(false);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
    });

    /**
     * Non-vacuity / channel (symlink to a location still WITHIN the root = allowed): a symlinked
     * directory beneath `.ai/` whose real target stays inside `.ai/` is legitimate — the resolved
     * destination is contained and dot-zoned — so a nested build through it SUCCEEDS. This proves
     * the fix refuses ESCAPES, not symlinks as such, and does not over-refuse an in-root symlink.
     */
    it('allows a nested output through a symlink beneath `.ai/` whose target stays within `.ai/`', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);
      await fs.mkdir(path.join(dir, '.ai', 'nested'), { recursive: true });
      await fs.symlink(path.join(dir, '.ai', 'nested'), path.join(dir, '.ai', 'link'));

      const context = await contextOver(
        dir,
        IMPURE,
        runnerEmitting('link/deep/out.bin', IMPURE.impure)
      );
      const record = await buildTarget(context, 'voiceover');

      expect(record.output.path).toBe('.ai/link/deep/out.bin');
      // The bytes landed through the symlink, still inside `.ai/`.
      expect(await exists(path.join(dir, '.ai', 'nested', 'deep', 'out.bin'))).toBe(true);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeDefined();
    });

    /**
     * Non-vacuity / channel (real `dist/`): the root-containment assertion does not over-refuse an
     * ordinary PURE build whose `dist/` is a real directory — it still lands and records.
     */
    it('allows an ordinary PURE build whose `dist/` root is a real directory', async () => {
      const dir = await copyFixture('chain');
      tempDirs.push(dir);

      const context = await contextOver(dir, PURE, runnerEmitting('nested/out.bin'));
      const record = await buildTarget(context, 'voiceover');

      expect(record.output.path).toBe('dist/nested/out.bin');
      expect(await exists(path.join(dir, 'dist', 'nested', 'out.bin'))).toBe(true);
      expect((await readLedger(dir)).artifacts['voiceover']).toBeDefined();
    });
  }
);

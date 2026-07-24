import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { untrackedCheck } from '@/assets/git-tracked.js';
import type { InputResolver } from '@/assets/resolve.js';
import { buildGraph } from '@/graph/build.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import { hashFile } from '@/hash/content.js';
import type { BuildResponse, BuildRequest } from '@/providers/contract.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import { copyFixture, REPO_ROOT } from './support.js';

/**
 * **An ingest is atomic: a failed record write never leaves `dist/` disagreeing with the ledger**
 * (AUDIT-20260716-14, FR-017).
 *
 * The prior `ingest` `copyFile`d the new bytes over the FINAL `dist/` path before the record was
 * written, so a `record` that threw (readLedger failing, writeLedger hitting ENOSPC/EPERM, an
 * interrupt) left the previous record naming `H_old` while `dist/<path>` already held `H_new` — the
 * ledger asserting an origin for bytes that are not the bytes on disk, the exact state this system
 * exists to make impossible.
 *
 * These tests drive `buildTarget` directly with a fake runner (the path-safety suite's shape), so
 * the record-write failure can be forced deterministically: after a first successful build, the
 * ledger file is made read-only, so the second build's `writeLedger` throws while `readLedger` still
 * succeeds. The assertion is that the bytes on disk and the recorded `output.hash` still AGREE — the
 * two are never split, whichever way an interruption falls.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A resolver that must never be consulted: `chain`'s `narration` is a plain on-disk file. */
function noAssets(): InputResolver {
  return {
    resolveToLocalPath: () => {
      throw new Error('the asset resolver was consulted; this input should resolve from disk');
    },
  };
}

/** A runner that writes exactly `contents` as the single declared output `voiceover.out`. */
function runnerEmitting(contents: string): ProviderRunner {
  return {
    async run(request: BuildRequest): Promise<BuildResponse> {
      const full = path.resolve(request.output_dir, 'voiceover.out');
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, contents, 'utf8');
      return {
        version: 1,
        outputs: [{ path: 'voiceover.out' }],
        tool: { name: 'fake', version: '0.0.0' },
      };
    },
  };
}

/** A `BuildContext` over a copy of the `chain` fixture whose `voiceover` target uses `runner`. */
async function contextOver(dir: string, runner: ProviderRunner): Promise<BuildContext> {
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

async function chainDir(): Promise<string> {
  const dir = await copyFixture('chain');
  tempDirs.push(dir);
  const profile = {
    version: 1,
    targets: { voiceover: { inputs: ['narration'], provider: { cmd: ['unused'] } } },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

async function recordedHash(dir: string): Promise<string> {
  const record = (await readLedger(dir)).artifacts['voiceover'];
  if (record === undefined) {
    throw new Error('no voiceover record');
  }
  return record.output.hash;
}

describe('a failed record write leaves dist/ and the ledger in agreement (AUDIT-20260716-14)', () => {
  it('**the bytes on disk and the recorded hash never split when `record` throws mid-ingest**', async () => {
    const dir = await chainDir();
    const distPath = path.join(dir, 'dist', 'voiceover.out');

    // Build once, for real. Now the ledger records H_old and dist/voiceover.out holds H_old bytes.
    await buildTarget(await contextOver(dir, runnerEmitting('OLD BYTES\n')), 'voiceover');
    const oldHash = await recordedHash(dir);
    expect(await hashFile(distPath)).toBe(oldHash); // consistent after a clean build

    // Force the SECOND build's record write to fail: make the ledger read-only. `readLedger` (inside
    // `record`) still succeeds; `writeLedger` hits EACCES on the read-only file and throws — exactly
    // the "record throws after the bytes were produced" case the finding is about.
    const ledgerFile = path.join(dir, '.production', 'ledger.yaml');
    await fs.chmod(ledgerFile, 0o444);

    // The second build produces DIFFERENT bytes (H_new) and its record write fails.
    const failure = await buildTarget(
      await contextOver(dir, runnerEmitting('NEW BYTES, DIFFERENT\n')),
      'voiceover'
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure, 'the record write did not fail as the test requires').toBeInstanceOf(Error);

    // Restore permissions so the assertions can read the ledger back.
    await fs.chmod(ledgerFile, 0o644);

    // THE ASSERTION. The ledger's recorded hash and the bytes actually on disk STILL AGREE — the
    // record write failed before the bytes were made visible, so both remain H_old. Never a split
    // where the ledger asserts an origin for bytes that are not the bytes on disk.
    const recorded = await recordedHash(dir);
    const onDisk = await hashFile(distPath);
    expect(
      onDisk,
      'dist/ bytes and the ledger hash diverged — the split this fix exists to stop'
    ).toBe(recorded);
    expect(recorded, 'the previous record was overwritten by a failed build').toBe(oldHash);
    expect(onDisk, 'dist/ bytes were replaced despite the record failing').toBe(oldHash);

    // No orphan staged temp files left under dist/ (the failed build cleaned up after itself).
    const stray = (await fs.readdir(path.join(dir, 'dist'))).filter((name) =>
      name.startsWith('.pc-ingest-')
    );
    expect(stray, `staged temp files were orphaned: ${stray.join(', ')}`).toEqual([]);
  });

  it('a clean build still commits the new bytes and records their hash (the fix is not blanket)', async () => {
    // Non-vacuity: with nothing forcing a failure, the rename lands and disk matches the record.
    const dir = await chainDir();
    const distPath = path.join(dir, 'dist', 'voiceover.out');

    await buildTarget(await contextOver(dir, runnerEmitting('FIRST\n')), 'voiceover');
    await buildTarget(await contextOver(dir, runnerEmitting('SECOND, revised\n')), 'voiceover');

    const recorded = await recordedHash(dir);
    expect(await hashFile(distPath)).toBe(recorded);
    expect(await fs.readFile(distPath, 'utf8')).toBe('SECOND, revised\n');
  });
});

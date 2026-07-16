import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'yaml';
import { AssetPointerSchema, type AssetPointer } from '@/assets/pointer.js';
import { storeBackedResolver } from '@/assets/resolve.js';
import { buildGraph } from '@/graph/build.js';
import { hashBytes } from '@/hash/content.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import { MemoryAssetStore } from '../fixtures/memory-store.js';
import { copyFixture, node, parseJsonText, pc, REPO_ROOT, StatusJsonSchema } from './support.js';

/**
 * **Absence in the store is unknowable without contacting it — so status must not try, and the
 * build must** (T065, FR-025, FR-036, spec § Edge Cases).
 *
 * This is the sharpest edge in the asset design, and the one most likely to be "helpfully" broken.
 * The `asset` fixture's bytes are in no store; its stand-in carries the content address and
 * nothing else. Two operations meet that same stand-in and must do opposite things:
 *
 *   - `pc status` ANSWERS. The address is already in the file, so reporting state needs nothing
 *     from the store, and it must never make a HEAD request to find out (FR-025). If it did, the
 *     oracle would stop working offline and an unreachable bucket would make an entire production
 *     unreportable — the failure mode content addressing exists to prevent.
 *   - `pc build` REFUSES, naming the asset and its address (FR-036). It needs the actual bytes,
 *     and there is no honest way to proceed without them.
 *
 * **The contrast is asserted explicitly, in one test, over one fixture and one store state.** That
 * is what makes it a regression test rather than two unrelated facts: someone adding a
 * reachability probe to status would still pass a test that only checked the build's refusal.
 */

const ASSET_SEED = 'fixture asset content';
const NARRATION_PATH = 'assets/narration/take-01.wav';

const tempDirs: string[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pc-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function readStandin(episodeDir: string): Promise<AssetPointer> {
  const text = await fs.readFile(path.join(episodeDir, `${NARRATION_PATH}.asset`), 'utf8');
  return AssetPointerSchema.parse(parse(text));
}

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

/**
 * A runner that FAILS if it is ever called.
 *
 * Every build below must refuse while resolving inputs — before anything is spawned (FR-030). A
 * provider started against a world missing one of its inputs is the thing input resolution exists
 * to prevent, so "no provider ran" is part of what is under test, not an implementation detail.
 */
function neverRuns(): ProviderRunner {
  return {
    run: () => {
      throw new Error(
        'A provider was spawned. The build was supposed to refuse while resolving inputs, before ' +
          'anything ran (FR-030).'
      );
    },
  };
}

/**
 * A `BuildContext` over a COPY of the `asset` fixture, with `store` behind the input resolver.
 *
 * The fixture is copied because it is committed and shared — and because `assets/narration/
 * take-01.wav` deliberately does not exist in it, which a test that fetched into the original
 * would quietly destroy for every other test that depends on the absence.
 */
async function contextOver(episodeDir: string, store: MemoryAssetStore): Promise<BuildContext> {
  const manifest = await loadEpisode(episodeDir);
  const profile = await loadProfile(manifest.profile, [
    episodeDir,
    path.join(REPO_ROOT, 'profiles'),
  ]);
  const ledger = await readLedger(episodeDir);

  return {
    episodeDir,
    graph: buildGraph(manifest, profile),
    ledger,
    runner: neverRuns(),
    assets: storeBackedResolver(store, await tempDir('asset-cache')),
    at: new Date().toISOString(),
  };
}

describe('the fixture is what it claims to be (non-vacuity)', () => {
  it('its bytes are absent from disk, and its stand-in addresses the recorded seed', async () => {
    const episodeDir = await copyFixture('asset');

    // If this file existed, every refusal below would be about something else entirely.
    expect(await exists(path.join(episodeDir, NARRATION_PATH))).toBe(false);

    const pointer = await readStandin(episodeDir);
    expect(pointer.asset).toBe(hashBytes(Buffer.from(ASSET_SEED, 'utf8')));
    expect(pointer.bytes).toBe(Buffer.byteLength(ASSET_SEED, 'utf8'));
  });
});

describe('an operation that NEEDS the bytes fails loud, naming the asset and its address (FR-036)', () => {
  it('refuses when the store is unreachable', async () => {
    const episodeDir = await copyFixture('asset');
    const pointer = await readStandin(episodeDir);

    // Seeded, THEN severed. The bytes really are in there — this is a real store behind a severed
    // network, not an empty one, which is the situation FR-025 and this refusal are about.
    const store = new MemoryAssetStore();
    await store.put(Buffer.from(ASSET_SEED, 'utf8'));
    store.setUnreachable(true);

    const context = await contextOver(episodeDir, store);
    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    expect(failure, 'the build SUCCEEDED with its input in an unreachable store').toBeInstanceOf(
      Error
    );
    const message = failure instanceof Error ? failure.message : '';

    // Names the asset — the input's identity and its declared path — AND its content address.
    // The address is the only handle anyone has on bytes that are not in the repo: it is what an
    // operator greps the bucket for, and what distinguishes "the store is down" from "this was
    // never uploaded".
    expect(message).toContain('narration');
    expect(message).toContain(NARRATION_PATH);
    expect(message).toContain(pointer.asset);
    // The underlying cause survives rather than being flattened into a generic failure.
    expect(message).toMatch(/unreachable/i);

    // Refused, recorded nothing. A failed build never writes a record claiming success (FR-017).
    expect((await readLedger(episodeDir)).artifacts['voiceover']).toBeUndefined();
  });

  it('refuses when the store is REACHABLE but does not hold the address', async () => {
    const episodeDir = await copyFixture('asset');
    const pointer = await readStandin(episodeDir);

    // Reachable and answering — it simply never received these bytes. The stand-in was committed;
    // the upload never happened. Status could not possibly have detected this.
    const store = new MemoryAssetStore();
    await store.put(Buffer.from('some other asset entirely', 'utf8'));
    expect(await store.has(pointer.asset)).toBe(false);

    const context = await contextOver(episodeDir, store);
    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    expect(failure, 'the build SUCCEEDED with its input absent from the store').toBeInstanceOf(
      Error
    );
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('narration');
    expect(message).toContain(pointer.asset);
    expect(message).toMatch(/not found/i);

    expect((await readLedger(episodeDir)).artifacts['voiceover']).toBeUndefined();
  });

  it('resolves the input to a LOCAL path when the store DOES hold it — the refusals are not blanket', async () => {
    // Non-vacuity for both refusals above. If a build of this fixture could never get past input
    // resolution, "it refused" would prove nothing about the store having been consulted.
    const episodeDir = await copyFixture('asset');
    const pointer = await readStandin(episodeDir);

    const store = new MemoryAssetStore();
    await store.put(Buffer.from(ASSET_SEED, 'utf8'));

    const context = await contextOver(episodeDir, store);
    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    // It still fails — `neverRuns()` sees to that — but now it fails at the SPAWN, having got the
    // bytes. That is the seam moving forward, which is the whole proof.
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('A provider was spawned');
    expect(message).not.toContain(pointer.asset);

    // And the bytes landed locally, verified, under their own content address (FR-030): the
    // provider would have been handed an ordinary local path and never a credential. The file
    // keeps the declared basename (a TYPE-BEARING name) under the content-addressed digest
    // directory, so a fresh clone's fetch hands the provider the same `.wav` a local machine would
    // (AUDIT-20260716-27).
    const digest = pointer.asset.split(':')[1]!;
    const fetched = path.join(
      episodeDir,
      '.production',
      'assets',
      digest,
      path.basename(NARRATION_PATH)
    );
    expect(await exists(fetched)).toBe(true);
    expect(await fs.readFile(fetched)).toEqual(Buffer.from(ASSET_SEED, 'utf8'));
    expect(hashBytes(await fs.readFile(fetched))).toBe(pointer.asset);

    // The fetch did not resurrect the declared path. The bytes stay out of the source tree, where
    // committing them would defeat the stand-in entirely (FR-023).
    expect(await exists(path.join(episodeDir, NARRATION_PATH))).toBe(false);
  });
});

describe('THE CONTRAST: status answers, build refuses — same fixture, same store state', () => {
  it('`pc status` succeeds with the store unreachable while a build of the same input fails loud', async () => {
    const episodeDir = await copyFixture('asset');
    const pointer = await readStandin(episodeDir);

    // ONE store, ONE state, for both halves of this test: seeded so it is a real store, then
    // severed so nothing can reach it.
    const store = new MemoryAssetStore();
    await store.put(Buffer.from(ASSET_SEED, 'utf8'));
    store.setUnreachable(true);

    // ---- Half one: reporting state ANSWERS (FR-025) ----------------------------------------
    //
    // The real binary, in its own process, with no store wired into it at all — because there is
    // no seam to wire one into. The stand-in carries the address; that is the entire input.
    const status = await pc(['status', '--episode', episodeDir, '--json']);

    expect(status.stderr).toBe('');
    expect(status.code).toBe(0);
    const answer = StatusJsonSchema.parse(parseJsonText(status.stdout));
    expect(node(answer, 'narration').state).toBe('present');

    // It never mentions the store, because it never had one to mention. A status that reported
    // "store unreachable" here would have contacted it — the exact thing FR-025 forbids.
    expect(status.stdout).not.toMatch(/store|network|unreachable|fetch/i);

    // ---- Half two: an operation that needs the BYTES refuses (FR-036) ------------------------
    const context = await contextOver(episodeDir, store);
    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    expect(failure, 'the build SUCCEEDED against an unreachable store').toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('narration');
    expect(message).toContain(pointer.asset);

    // ---- The contrast itself ----------------------------------------------------------------
    //
    // Same fixture. Same unreachable store. Status answered 0; the build refused naming the asset
    // and its address. THIS is the spec's edge case, and it is what someone breaks by adding a
    // "helpful" reachability probe to status — which would turn the first half red while leaving
    // the second half green. Do not resolve such a failure by relaxing the first half.
    expect(status.code).toBe(0);
    expect(failure).toBeInstanceOf(Error);
  });
});

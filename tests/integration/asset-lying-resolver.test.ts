import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'yaml';
import { AssetPointerSchema, type AssetPointer } from '@/assets/pointer.js';
import type { InputResolver } from '@/assets/resolve.js';
import { buildGraph } from '@/graph/build.js';
import { hashBytes } from '@/hash/content.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import { copyFixture, REPO_ROOT } from './support.js';

/**
 * **A fetched asset is handed over under an OBSERVED hash, never a CLAIMED one (AUDIT-20260716-19).**
 *
 * `InputResolver` is an injected interface; its contract cannot compel every implementation to
 * verify what it returns. The provider-boundary is where the guarantee actually lives: after a
 * fetch, `resolveInputs` re-hashes the bytes on disk and refuses when they do not match the
 * address the stand-in claimed. A resolver that returned the wrong bytes — a truncated download, a
 * partial cache entry, a store that indexes by key rather than content — must not have `pc build`
 * record an input hash nothing on disk matches.
 *
 * This is the fetch (fresh-clone) counterpart to the beside-the-stand-in branch, which already
 * hashes the file on disk and refuses on mismatch. No network: the lying resolver is injected.
 */

const NARRATION_PATH = 'assets/narration/take-01.wav';

async function readStandin(episodeDir: string): Promise<AssetPointer> {
  const text = await fs.readFile(path.join(episodeDir, `${NARRATION_PATH}.asset`), 'utf8');
  return AssetPointerSchema.parse(parse(text));
}

/** A runner that FAILS if it is ever called — the build must refuse while resolving inputs. */
function neverRuns(): ProviderRunner {
  return {
    run: () => {
      throw new Error('A provider was spawned; the build was supposed to refuse first (FR-030).');
    },
  };
}

/**
 * An `InputResolver` that LIES: it writes bytes that do NOT hash to the requested address and
 * returns a path to them. It even honors the type-bearing filename — the point is that the bytes,
 * not the name, are wrong. No store, no network.
 */
function lyingResolver(wrongBytes: Buffer): InputResolver {
  return {
    async resolveToLocalPath(_pointer, destDir, filename): Promise<string> {
      const dir = path.join(destDir, 'lie');
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, wrongBytes);
      return filePath;
    },
  };
}

async function contextOver(episodeDir: string, assets: InputResolver): Promise<BuildContext> {
  const manifest = await loadEpisode(episodeDir);
  const profile = await loadProfile(manifest.profile, [
    episodeDir,
    path.join(REPO_ROOT, 'profiles'),
  ]);
  return {
    episodeDir,
    graph: buildGraph(manifest, profile),
    ledger: await readLedger(episodeDir),
    runner: neverRuns(),
    assets,
    at: '2026-07-16T00:00:00.000Z',
  };
}

describe('a lying resolver is REFUSED, naming the mismatch (AUDIT-20260716-19)', () => {
  it('refuses bytes that do not hash to the address the stand-in requested', async () => {
    const episodeDir = await copyFixture('asset');
    const pointer = await readStandin(episodeDir);

    const wrongBytes = Buffer.from('these bytes are NOT the asset', 'utf8');
    const wrongHash = hashBytes(wrongBytes);
    expect(wrongHash).not.toBe(pointer.asset);

    const context = await contextOver(episodeDir, lyingResolver(wrongBytes));
    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    expect(failure, 'the build ACCEPTED bytes under a claimed hash').toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';

    // Names BOTH the requested address and what the store actually produced.
    expect(message).toContain(pointer.asset);
    expect(message).toContain(wrongHash);
    expect(message).toMatch(/not the asset/i);
    expect(message).toContain('narration');

    // Refused, recorded nothing: no ledger record claiming a build from content nobody has.
    expect((await readLedger(episodeDir)).artifacts['voiceover']).toBeUndefined();
  });
});

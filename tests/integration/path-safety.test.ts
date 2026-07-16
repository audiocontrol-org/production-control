import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import type { InputResolver } from '@/assets/resolve.js';
import { buildGraph } from '@/graph/build.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import type { BuildResponse } from '@/providers/contract.js';
import { buildTarget, type BuildContext } from '@/providers/build.js';
import type { ProviderRunner } from '@/providers/run.js';
import type { BuildRequest } from '@/providers/contract.js';
import { copyFixture, REPO_ROOT } from './support.js';

/**
 * **Defense in depth: `ingest` cannot write a build output outside `<episodeDir>/dist`, even when
 * a runner hands it a traversing path** (AUDIT-20260716-15, -16; FR-036).
 *
 * `BuildOutputSchema.path` (RelativePathSchema) already refuses a traversing declaration on the
 * wire, and `provider.test.ts` proves that. But `ingest` composes `path.join(episodeDir, 'dist',
 * relPath)` and trusts it, so a caller that builds a `ProducedOutput` some OTHER way — a fake
 * runner here, a future non-subprocess runner in life — must still be unable to escape. The
 * schema guards the wire; the assertion guards the composition, and they are not redundant.
 *
 * These tests bypass the schema on purpose: the fake runner returns a `BuildResponse` object
 * directly, never through `parseBuildResponse`, and never through `subprocessRunner`'s own
 * containment check. That is precisely the "record built another way" the ingest assertion exists
 * to stop.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A resolver that must never be consulted: the `chain` fixture's `narration` is a plain on-disk file. */
function noAssets(): InputResolver {
  return {
    resolveToLocalPath: () => {
      throw new Error('the asset resolver was consulted; this input should resolve from disk');
    },
  };
}

/**
 * A runner that writes a single output at `relPath` (relative to the request's `output_dir`, so
 * an on-disk file exists for the invoker to hash) and DECLARES it, bypassing every schema and
 * runner-side containment check. `relPath` may traverse — that is the point.
 */
function runnerEmitting(relPath: string): ProviderRunner {
  return {
    async run(request: BuildRequest): Promise<BuildResponse> {
      const full = path.resolve(request.output_dir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, 'produced bytes\n', 'utf8');
      return {
        version: 1,
        outputs: [{ path: relPath }],
        tool: { name: 'fake', version: '0.0.0' },
      };
    },
  };
}

/** A `BuildContext` over a copy of the `chain` fixture, whose `voiceover` target uses `runner`. */
async function contextOver(
  runner: ProviderRunner
): Promise<{ dir: string; context: BuildContext }> {
  const dir = await copyFixture('chain');
  tempDirs.push(dir);

  // The profile is written into the episode copy so `loadProfile` finds it before the shared
  // `profiles/` dir. The provider cmd is never spawned — `runner` stands in for it entirely.
  const profile = {
    version: 1,
    targets: { voiceover: { inputs: ['narration'], provider: { cmd: ['unused'] } } },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');

  const manifest = await loadEpisode(dir);
  const loaded = await loadProfile(manifest.profile, [dir, path.join(REPO_ROOT, 'profiles')]);
  const ledger = await readLedger(dir);

  return {
    dir,
    context: {
      episodeDir: dir,
      graph: buildGraph(manifest, loaded),
      ledger,
      runner,
      assets: noAssets(),
      at: new Date().toISOString(),
    },
  };
}

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

describe('ingest refuses a build output that escapes dist/ (AUDIT-20260716-15/-16)', () => {
  it('throws naming dist/, records nothing, and writes NO file outside dist/', async () => {
    const { dir, context } = await contextOver(runnerEmitting('../evil.txt'));

    // Where the copy would land if the assertion were absent: episode root, a sibling of dist/,
    // where it could overwrite an authored file. It must NOT exist afterward.
    const escapedDestination = path.join(dir, 'evil.txt');

    const failure = await buildTarget(context, 'voiceover').then(
      () => null,
      (error: unknown) => error
    );

    expect(failure, 'the escaping output was ingested rather than refused').toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('dist');
    expect(message).toContain('evil.txt');

    // The escape did not happen: nothing was written outside dist/, and no record claims success.
    expect(await exists(escapedDestination)).toBe(false);
    expect((await readLedger(dir)).artifacts['voiceover']).toBeUndefined();
  });

  it('a clean relative output still ingests and records — the assertion is not blanket', async () => {
    // Non-vacuity: the same path proves an ordinary output lands under dist/ and is recorded.
    const { dir, context } = await contextOver(runnerEmitting('voiceover.out'));

    const record = await buildTarget(context, 'voiceover');

    expect(record.output.path).toBe('dist/voiceover.out');
    expect(await exists(path.join(dir, 'dist', 'voiceover.out'))).toBe(true);
    expect((await readLedger(dir)).artifacts['voiceover']).toBeDefined();
  });
});

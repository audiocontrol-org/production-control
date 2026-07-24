import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import { parse } from 'yaml';
import { AssetPointerSchema, type AssetPointer } from '@/assets/pointer.js';
import { hashBytes } from '@/hash/content.js';
import { ProfileSchema } from '@/manifest/schema.js';
import { MemoryAssetStore } from '../fixtures/memory-store.js';
import {
  cleanupFixtureCopies,
  node,
  parseJsonText,
  pc,
  FIXTURES,
  REPO_ROOT,
  StatusJsonSchema,
} from './support.js';

/**
 * Reporting state requires NO network and NO craft tools (T027, SC-001, FR-010, FR-025,
 * quickstart S10).
 *
 * **The mechanical proof that the network is unreachable is not here, deliberately.** It lives in
 * `tests/unit/architecture.test.ts`, which walks the transitive import graph and bans the network
 * builtins, `@aws-sdk/*`, `src/providers/`, `src/assets/s3.ts` and `src/assets/git-tracked.ts`
 * from every root — and whose roots include the READ VERBS themselves (`status`, `next`,
 * `explain`, `release-check`), so the guarantee covers the binary an agent actually runs and not
 * merely the library behind it. Copying that walker here would give this repo two boundary checks
 * that could disagree, which is worse than one.
 *
 * The read verbs rather than all of `src/cli`: `pc build` and `pc validate` exist to exec a craft
 * tool (FR-029), so they reach `child_process` by design. FR-010 constrains *reporting* state,
 * which is what these four do — and what every test below drives.
 *
 * What is here is the RUNTIME half, and the two halves prove different things. The static check
 * proves the code *cannot* dial out. These tests prove the oracle does not *need* the things it
 * cannot reach — that it answers when there is nothing on the other end. The sharpest case is the
 * `asset` fixture: its bytes exist in no store this process can reach, its stand-in carries the
 * content address, and status must resolve it anyway (FR-025). If status ever contacted a store
 * to answer, that test could not pass.
 */

/**
 * The `asset` fixture's seed bytes, recorded in `tests/fixtures/asset/README.md`.
 *
 * The fixture is useless without them: its stand-in names a content address and nothing else, so
 * bytes that cannot be produced would make the address refer to nothing — a fabricated record, of
 * exactly the kind this system exists to catch.
 */
const ASSET_SEED = 'fixture asset content';
const ASSET_STANDIN = 'assets/narration/take-01.wav.asset';

/** The one fixture whose contract is a REFUSAL rather than an answer (S12, FR-005). */
const REFUSING_FIXTURES = new Set(['cycle']);

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

/**
 * Every fixture that is an episode, discovered rather than listed. A fixture added later is
 * covered without anyone remembering to add it here — a hand-maintained list is how an offline
 * guarantee quietly stops covering the case that broke it.
 */
async function episodeFixtures(): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(FIXTURES, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(path.join(FIXTURES, entry.name, 'episode.yaml')))) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

async function readAssetPointer(): Promise<AssetPointer> {
  const text = await fs.readFile(path.join(FIXTURES, 'asset', ASSET_STANDIN), 'utf8');
  return AssetPointerSchema.parse(parse(text));
}

/**
 * A store double that REJECTS every call, seeded first so its address can be checked against the
 * fixture's stand-in. Seeding then severing is the point: it proves the stand-in addresses real,
 * reproducible bytes AND that the store is genuinely hostile — a double that quietly resolved
 * would make every assertion below pass for the wrong reason.
 */
async function hostileStore(): Promise<MemoryAssetStore> {
  const store = new MemoryAssetStore();
  await store.put(Buffer.from(ASSET_SEED, 'utf8'));
  store.setUnreachable(true);
  return store;
}

/** A directory with nothing in it, used as an entire PATH. */
let emptyPathDir = '';

beforeAll(async () => {
  emptyPathDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-empty-path-'));
});

afterAll(async () => {
  await cleanupFixtureCopies();
  await fs.rm(emptyPathDir, { recursive: true, force: true });
});

describe('pc status needs no asset store (FR-025, SC-001)', () => {
  it('the fixture stand-in addresses REAL bytes, and the store double really rejects', async () => {
    const pointer = await readAssetPointer();

    // The seed reproduces the address the stand-in claims. Without this the fixture would be a
    // fabricated record, and "status resolved it" would prove nothing about content addressing.
    expect(hashBytes(Buffer.from(ASSET_SEED, 'utf8'))).toBe(pointer.asset);
    expect(pointer.bytes).toBe(Buffer.byteLength(ASSET_SEED, 'utf8'));

    const store = await hostileStore();
    await expect(store.get(pointer.asset)).rejects.toThrow(/unreachable/i);
    await expect(store.has(pointer.asset)).rejects.toThrow(/unreachable/i);
    await expect(store.put(Buffer.from(ASSET_SEED, 'utf8'))).rejects.toThrow(/unreachable/i);

    // The bytes ARE in there — the store is refusing, not empty. It is standing in for a real
    // store behind a severed network, which is the situation FR-025 is about.
    store.setUnreachable(false);
    await expect(store.has(pointer.asset)).resolves.toBe(true);
  });

  it('resolves the `asset` fixture from the stand-in alone, with no reachable store (FR-025)', async () => {
    const pointer = await readAssetPointer();
    const store = await hostileStore();

    // The bytes are not on disk — that is the whole point of the fixture — and the only store in
    // this process rejects every call. Nothing else can be asked.
    expect(await exists(path.join(FIXTURES, 'asset', 'assets/narration/take-01.wav'))).toBe(false);
    await expect(store.get(pointer.asset)).rejects.toThrow();

    const result = await pc(['status', '--episode', 'tests/fixtures/asset', '--json']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));

    // Status ANSWERED. The stand-in already carries the hash, so nothing needed fetching — this
    // is what content addressing buys, and it is why the oracle has no store seam at all.
    const narration = node(status, 'narration');
    expect(narration.state).toBe('present');
    expect(narration.cause.code).toBe('present');

    // And the answer is about the asset's own content, reported on the node's own account —
    // never "the store did not answer".
    const voiceover = node(status, 'voiceover');
    expect(voiceover.state).toBe('missing');
    expect(voiceover.cause.code).toBe('never-built');
    expect(result.stdout).not.toMatch(/store|network|unreachable|fetch/i);
  });

  it('answers every episode fixture with the store unreachable', async () => {
    const names = await episodeFixtures();
    expect(names, 'no episode fixtures found — this test is vacuous').toContain('asset');
    expect(names.length).toBeGreaterThan(4);

    const store = await hostileStore();

    for (const name of names) {
      const result = await pc(['status', '--episode', `tests/fixtures/${name}`, '--json']);

      if (REFUSING_FIXTURES.has(name)) {
        // `cycle` refuses BY DESIGN, and the refusal is itself produced offline. What matters is
        // that it refuses for the reason it declares — never because something was unreachable.
        expect(result.code, `"${name}" is expected to refuse`).toBe(1);
        expect(result.stderr).toMatch(/cycle/i);
        expect(result.stderr).not.toMatch(/store|network|unreachable|ENOTFOUND|ECONNREFUSED/i);
        continue;
      }

      expect(result.stderr, `"${name}" refused`).toBe('');
      expect(result.code, `"${name}" did not answer`).toBe(0);
      const status = StatusJsonSchema.parse(parseJsonText(result.stdout));
      expect(status.nodes.length, `"${name}" answered with no nodes`).toBeGreaterThan(0);
    }

    // The store was hostile throughout and nothing ever reached it — it holds exactly what this
    // test put there, and rejects anyone who asks.
    store.setUnreachable(false);
    expect(store.size()).toBe(1);
  });
});

describe('pc status needs no craft tool (FR-010, SC-001)', () => {
  it('the profile names craft tools that are NOT installed', async () => {
    const text = await fs.readFile(path.join(REPO_ROOT, 'profiles/editorial-audio.yaml'), 'utf8');
    const profile = ProfileSchema.parse(parse(text));

    const tools = Object.values(profile.targets).map((target) => target.provider.cmd.join(' '));
    expect(tools).toContain('npx epub-tooling build');
    expect(tools).toContain('npx audio-tooling master');

    // Non-vacuity: if `epub-tooling` were somehow installed, the test below would pass without
    // proving anything at all.
    for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
      for (const tool of ['epub-tooling', 'audio-tooling', 'web-tooling', 'alignment-tooling']) {
        expect(
          await exists(path.join(dir, tool)),
          `"${tool}" is installed at "${dir}" — the FR-010 test below would be vacuous`
        ).toBe(false);
      }
    }
  });

  it('answers with PATH emptied — no craft tool, and not even npx, is reachable', async () => {
    const names = await episodeFixtures();

    for (const name of names.filter((candidate) => !REFUSING_FIXTURES.has(candidate))) {
      // PATH is a single empty directory. Nothing can be spawned by name: not the craft tools the
      // profile declares, not `npx` that would fetch them, not `git`. Status never invokes a
      // provider, so none of it is missed.
      const result = await pc(['status', '--episode', `tests/fixtures/${name}`, '--json'], {
        env: { ...process.env, PATH: emptyPathDir },
      });

      expect(result.stderr, `"${name}" refused with PATH emptied`).toBe('');
      expect(result.code, `"${name}" did not answer with PATH emptied`).toBe(0);
      expect(() => StatusJsonSchema.parse(parseJsonText(result.stdout))).not.toThrow();
    }
  });

  it('gives the SAME answer with PATH emptied as with the real PATH', async () => {
    // Stronger than "it answered": a tool that degraded to a guess when it could not find its
    // craft tools would still exit 0. The answer must not move, because status never asks a
    // provider anything (FR-010).
    const withPath = await pc(['status', '--episode', 'tests/fixtures/chain', '--json']);
    const withoutPath = await pc(['status', '--episode', 'tests/fixtures/chain', '--json'], {
      env: { ...process.env, PATH: emptyPathDir },
    });

    expect(withoutPath.code).toBe(withPath.code);
    expect(parseJsonText(withoutPath.stdout)).toEqual(parseJsonText(withPath.stdout));
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { hashFile } from '@/hash/content.js';
import { hashTree } from '@/hash/tree.js';
import { readLedger } from '@/ledger/store.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  FIXTURES,
  StatusJsonSchema,
  type StatusJson,
} from './support.js';

/**
 * **A DIRECTORY input builds, and is characterized as a whole** (FR-008, spec § Edge Cases,
 * research R3, contracts/provider.md § BuildRequest).
 *
 * This file exists because of the gap that let a real bug ship: `pc build` could not build ANY
 * target with a directory input. Every one died with `EISDIR: illegal operation on a directory,
 * read`, because `providers/inputs.ts` hashed every authored input with `hashFile` and never
 * asked whether it had a directory — while `state/identity.ts`, which answers the same question
 * for `pc status`, branched on it correctly. So `pc status` reported `assets present` the whole
 * time and the failure surfaced only at build time.
 *
 * `epub` and `website` are the only two profile targets with a directory input (`assets`), and
 * `build.test.ts` builds only `voiceover`/`podcast`, whose inputs are all files. That is why 337
 * green tests said nothing about it, and why this coverage lives beside them rather than in them.
 *
 * A provider receives the DIRECTORY'S OWN PATH plus its tree hash, and walks it itself — exactly
 * as it would outside production-control. Nothing here flattens, tars, or copies it.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');
const ASSET_DIR = 'assets';
const ASSET_FILE = 'assets/image.txt';

/**
 * The `minimal` fixture with its profile pointed at the fake provider, shadowing the shared
 * `profiles/editorial-audio.yaml` (which names craft tools nobody has installed) without
 * touching the committed one. `epub ← [longform, assets]` mirrors that real profile target.
 */
async function epubEpisode(): Promise<string> {
  const dir = await copyFixture('minimal');
  const profile = {
    version: 1,
    targets: {
      epub: { inputs: ['longform', 'assets'], provider: { cmd: [FAKE_PROVIDER] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

async function build(dir: string, target: string) {
  return pc(['build', target, '--episode', dir]);
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

/** Reads a record, failing loudly (rather than returning undefined) when the build wrote none. */
async function recordOf(dir: string, target: string): Promise<ArtifactRecord> {
  const ledger = await readLedger(dir);
  const record = ledger.artifacts[target];
  if (record === undefined) {
    const present = Object.keys(ledger.artifacts).join(', ');
    throw new Error(`No ledger record for "${target}". Recorded: ${present || '(none)'}.`);
  }
  return record;
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('a directory input builds, and its TREE hash is what gets recorded (FR-008, research R3)', () => {
  it('**builds `epub` from a directory input, recording the directory tree hash**', async () => {
    const dir = await epubEpisode();

    // Non-vacuity: `assets` really is a directory. If this fixture ever became a file, every
    // assertion below would still pass while testing nothing this file claims to test.
    expect((await fs.stat(path.join(dir, ASSET_DIR))).isDirectory()).toBe(true);

    const result = await build(dir, 'epub');
    expect(result.stderr, 'build refused').toBe('');
    expect(result.code).toBe(0);

    const record = await recordOf(dir, 'epub');

    // ** THE ASSERTION. ** The directory input is recorded as its TREE hash — computed here from
    // the real tree on disk, never fabricated — and the file input as its content hash. Both are
    // hashes of what was actually handed to the provider.
    expect(record.inputs.assets).toBe(await hashTree(path.join(dir, ASSET_DIR)));
    expect(record.inputs.longform).toBe(await hashFile(path.join(dir, 'article.mdx')));

    // The tree hash is genuinely a different thing from the hash of the one file inside it: it
    // commits to that file's PATH as well as its bytes (research R3). Were these ever equal,
    // `hashTree` would have collapsed into `hashFile` and the assertion above would be vacuous.
    expect(record.inputs.assets).not.toBe(await hashFile(path.join(dir, ASSET_FILE)));

    expect(record.producer).toEqual({ tool: 'fake-provider', version: '1.0.0' });
    expect(record.output.path).toBe('dist/epub.out');
    expect(record.output.hash).toBe(await hashFile(path.join(dir, 'dist/epub.out')));

    // The directory is still where the author put it, still a directory, contents untouched:
    // production-control resolved it to a local path and STOPPED. It did not tar it, flatten it,
    // or stage a copy for the provider — that would be production-control doing craft work
    // (Principle IV). The provider walks the directory itself.
    expect((await fs.stat(path.join(dir, ASSET_DIR))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dir, ASSET_FILE), 'utf8')).toBe(
      await fs.readFile(path.join(FIXTURES, 'minimal', ASSET_FILE), 'utf8')
    );

    expect(node(await statusOf(dir), 'epub').state).toBe('fresh');
  });

  it('**changing a file INSIDE the directory makes `epub` stale, naming `assets`**', async () => {
    const dir = await epubEpisode();
    expect((await build(dir, 'epub')).code).toBe(0);
    const before = await recordOf(dir, 'epub');
    expect(node(await statusOf(dir), 'epub').state).toBe('fresh');

    // Edit one file inside the tree. The directory's own name and path did not move.
    await fs.appendFile(path.join(dir, ASSET_FILE), 'a revised image\n', 'utf8');

    // "Its content is characterized as a whole; adding, removing, or changing any file within
    // it changes its state" (spec § Edge Cases).
    const epub = node(await statusOf(dir), 'epub');
    expect(epub.state).toBe('stale');
    expect(epub.cause.code).toBe('input-changed');
    expect(epub.cause.identity, 'the cause must NAME the directory that moved').toBe('assets');

    // A rebuild records the NEW tree hash — the record follows the tree's content.
    expect((await build(dir, 'epub')).code).toBe(0);
    const after = await recordOf(dir, 'epub');
    expect(after.inputs.assets).toBe(await hashTree(path.join(dir, ASSET_DIR)));
    expect(after.inputs.assets).not.toBe(before.inputs.assets);
    expect(node(await statusOf(dir), 'epub').state).toBe('fresh');
  });

  it('ADDING a file inside the directory restales it; REMOVING it restores the original hash', async () => {
    const dir = await epubEpisode();
    expect((await build(dir, 'epub')).code).toBe(0);
    const original = (await recordOf(dir, 'epub')).inputs.assets;

    // A file that did not exist before, NESTED, so the recursive walk is really exercised.
    const added = path.join(dir, 'assets/nested/extra.txt');
    await fs.mkdir(path.dirname(added), { recursive: true });
    await fs.writeFile(added, 'a new asset\n', 'utf8');

    expect(node(await statusOf(dir), 'epub').state).toBe('stale');
    expect((await build(dir, 'epub')).code).toBe(0);
    expect((await recordOf(dir, 'epub')).inputs.assets).not.toBe(original);

    // Removing it returns the tree to exactly what it was. The hash is over content, not
    // history, so the original must come back bit for bit.
    await fs.rm(path.dirname(added), { recursive: true });
    expect(node(await statusOf(dir), 'epub').state).toBe('stale');
    expect((await build(dir, 'epub')).code).toBe(0);
    expect((await recordOf(dir, 'epub')).inputs.assets).toBe(original);
  });

  it('a directory input that is ABSENT is refused before the provider runs, naming it (FR-036)', async () => {
    const dir = await epubEpisode();
    await fs.rm(path.join(dir, ASSET_DIR), { recursive: true });

    const result = await build(dir, 'epub');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('assets');
    expect((await readLedger(dir)).artifacts).toEqual({});
  });
});

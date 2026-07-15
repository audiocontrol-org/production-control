import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { BUCKET_VAR, envStoreProvider, type StoreProvider } from '@/assets/config.js';
import { AssetPointerSchema } from '@/assets/pointer.js';
import type { AssetStore } from '@/assets/store.js';
import { assetAddCommand, type AssetDeps } from '@/cli/asset.js';
import type { Output } from '@/cli/output.js';
import { hashBytes } from '@/hash/content.js';
import { MemoryAssetStore } from '../fixtures/memory-store.js';
import { parseJsonText } from './support.js';

/**
 * `pc asset add` (T064, FR-023, FR-024, FR-028, FR-036).
 *
 * **These drive the verb function rather than the built binary, and the store is INJECTED.** That
 * is a deliberate departure from the pattern in `support.ts`: the whole point of `AssetStore` being
 * an interface is that a test needs no S3, no MinIO, and no network, and a subprocess cannot be
 * handed an in-memory double. What is lost — the wiring between the verb and the process's exit
 * code — is bought back by the verb returning the same number `index.ts` passes to `setExitCode`,
 * and by `MemoryAssetStore` being the same shape the S3 adapter satisfies (FR-027).
 *
 * **Nothing below trusts what the verb reports.** Every address is recomputed from the bytes with
 * `hashBytes` and compared; a verb that echoed a plausible-looking hash it never derived would
 * pass a test that merely read its own output back. The store's object count is likewise asked of
 * the store, not inferred from what the verb said it did.
 */

/**
 * The `--json` wire shape, as a schema. Parsing the verb's output through it IS the shape
 * assertion (contracts/cli.md): `--json` is the primary interface, so a field going missing or
 * changing type is a breaking change to the thing an agent depends on.
 *
 * It deliberately overlaps `AssetPointerSchema` on `asset`/`media`/`bytes` — the report and the
 * stand-in state the same facts under the same names, and tests below parse one answer through
 * both schemas to hold that so.
 */
const JsonReportSchema = z.object({
  file: z.string(),
  standin: z.string(),
  asset: z.string(),
  media: z.string(),
  bytes: z.number(),
  stored: z.boolean(),
  standin_written: z.boolean(),
});

/** Collects a verb's two streams, so a test can assert which one an outcome went to. */
interface Captured extends Output {
  readonly stdout: string[];
  readonly stderr: string[];
}

function capture(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line: string): void => void stdout.push(line),
    err: (line: string): void => void stderr.push(line),
  };
}

function depsFor(output: Output, store: AssetStore): AssetDeps {
  return { output, store: { store: (): AssetStore => store } };
}

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-asset-add-'));
  tempDirs.push(dir);
  return dir;
}

/** A file with `contents`, in a fresh temp dir. Never a fixture — these tests write beside it. */
async function fileWith(name: string, contents: string): Promise<string> {
  const file = path.join(await tempDir(), name);
  await fs.writeFile(file, contents, 'utf8');
  return file;
}

async function readStandin(file: string): Promise<unknown> {
  return parse(await fs.readFile(`${file}.asset`, 'utf8'));
}

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('pc asset add writes a stand-in carrying the real facts (FR-023)', () => {
  it('writes `<file>.asset` beside the file with the address, media type, and true byte length', async () => {
    const contents = 'take one, with feeling';
    const file = await fileWith('take-01.wav', contents);
    const store = new MemoryAssetStore();
    const output = capture();

    const code = await assetAddCommand(depsFor(output, store), file, {});

    expect(output.stderr).toEqual([]);
    expect(code).toBe(0);

    // The stand-in is a real file beside the real one, and it parses as a real pointer — the same
    // schema `pc status` reads it through, so this is the shape the oracle will actually meet.
    expect(await exists(`${file}.asset`)).toBe(true);
    const pointer = AssetPointerSchema.parse(await readStandin(file));

    // RECOMPUTED, never read back from the verb's own report. This is the assertion that would
    // catch a verb that wrote a well-formed hash of something other than these bytes.
    expect(pointer.asset).toBe(hashBytes(Buffer.from(contents, 'utf8')));
    expect(pointer.bytes).toBe(Buffer.byteLength(contents, 'utf8'));
    expect(pointer.bytes).toBe((await fs.stat(file)).size);
    expect(pointer.media).toBe('audio/wav');

    // And the bytes are genuinely in the store, retrievable at exactly that address.
    expect(await store.get(pointer.asset)).toEqual(Buffer.from(contents, 'utf8'));
  });

  it('the address is the sha256 of the ACTUAL bytes, and the store agrees', async () => {
    const contents = 'a fixture with\0embedded\nbytes';
    const file = await fileWith('sample.flac', contents);
    const store = new MemoryAssetStore();
    const output = capture();

    expect(await assetAddCommand(depsFor(output, store), file, { json: true })).toBe(0);

    const answer = parseJsonText(output.stdout.join('\n'));
    const reported = AssetPointerSchema.parse(answer);
    const expected = hashBytes(await fs.readFile(file));

    expect(reported.asset).toBe(expected);
    expect(expected.startsWith('sha256:')).toBe(true);
    // The store filed it under the recomputed address — not merely under whatever it was told.
    expect(await store.has(expected)).toBe(true);
    expect(hashBytes(await store.get(expected))).toBe(expected);
  });

  it('--json reports what was recorded, and the stand-in on disk says the same thing', async () => {
    const file = await fileWith('cover.png', 'not really a png');
    const output = capture();

    expect(
      await assetAddCommand(depsFor(output, new MemoryAssetStore()), file, { json: true })
    ).toBe(0);

    const answer = parseJsonText(output.stdout.join('\n'));
    const reported = AssetPointerSchema.parse(answer);
    const onDisk = AssetPointerSchema.parse(await readStandin(file));

    // The report and the artifact must not be able to disagree: an agent reads one, a human reads
    // the other, and they are supposed to be the same fact.
    expect(reported).toEqual(onDisk);
  });
});

describe('identical bytes are never stored twice (FR-024)', () => {
  it('adding the same bytes twice stores ONE object at ONE address, and says it was a no-op', async () => {
    const contents = 'identical every time';
    const file = await fileWith('take-01.wav', contents);
    const store = new MemoryAssetStore();

    const first = capture();
    expect(await assetAddCommand(depsFor(first, store), file, { json: true })).toBe(0);
    const firstAnswer = parseJsonText(first.stdout.join('\n'));

    const second = capture();
    expect(await assetAddCommand(depsFor(second, store), file, { json: true })).toBe(0);
    const secondAnswer = parseJsonText(second.stdout.join('\n'));

    // The store PROVES the dedupe — not the verb's word for it (FR-024).
    expect(store.size()).toBe(1);

    const before = AssetPointerSchema.parse(firstAnswer);
    const after = AssetPointerSchema.parse(secondAnswer);
    expect(after.asset).toBe(before.asset);

    // Both exited 0, and the second SAID it changed nothing. A no-op a caller cannot distinguish
    // from an upload is not a no-op they can rely on.
    const report = JsonReportSchema.parse(secondAnswer);
    expect(report.stored).toBe(false);
    expect(report.standin_written).toBe(false);

    const firstReport = JsonReportSchema.parse(firstAnswer);
    expect(firstReport.stored).toBe(true);
    expect(firstReport.standin_written).toBe(true);
  });

  it('a file that already has a MATCHING stand-in is a no-op that leaves it byte-identical', async () => {
    const file = await fileWith('take-01.wav', 'settled content');
    const store = new MemoryAssetStore();

    expect(await assetAddCommand(depsFor(capture(), store), file, {})).toBe(0);
    const standinBefore = await fs.readFile(`${file}.asset`, 'utf8');

    const output = capture();
    expect(await assetAddCommand(depsFor(output, store), file, { json: true })).toBe(0);

    // Not rewritten — a byte-identical rewrite would dirty the working tree and make a no-op look
    // like a change to every tool a person actually watches.
    expect(await fs.readFile(`${file}.asset`, 'utf8')).toBe(standinBefore);
    expect(JsonReportSchema.parse(parseJsonText(output.stdout.join('\n'))).standin_written).toBe(
      false
    );
    expect(store.size()).toBe(1);
  });

  it('re-adds bytes the store has LOST, rather than trusting the stand-in beside the file', async () => {
    // A stand-in is committed; the bytes were never uploaded, or the bucket was replaced. The
    // stand-in matching is not evidence the store holds anything, so `add` must not skip on it.
    const contents = 'bytes the store never got';
    const file = await fileWith('take-01.wav', contents);
    const address = hashBytes(Buffer.from(contents, 'utf8'));
    await fs.writeFile(
      `${file}.asset`,
      `asset: ${address}\nmedia: audio/wav\nbytes: ${String(Buffer.byteLength(contents, 'utf8'))}\n`
    );

    const store = new MemoryAssetStore();
    expect(await store.has(address)).toBe(false);

    const output = capture();
    expect(await assetAddCommand(depsFor(output, store), file, { json: true })).toBe(0);

    expect(await store.has(address)).toBe(true);
    expect(JsonReportSchema.parse(parseJsonText(output.stdout.join('\n'))).stored).toBe(true);
  });
});

describe('changed bytes are a NEW asset, never an overwrite (FR-028)', () => {
  it('re-adding changed bytes yields a new address, and the prior asset stays retrievable', async () => {
    const original = 'take one';
    const revised = 'take two, better';
    const file = await fileWith('take-01.wav', original);
    const store = new MemoryAssetStore();

    expect(await assetAddCommand(depsFor(capture(), store), file, {})).toBe(0);
    const before = AssetPointerSchema.parse(await readStandin(file));

    // The author re-records. Same path, same name — different bytes.
    await fs.writeFile(file, revised, 'utf8');
    const output = capture();
    expect(await assetAddCommand(depsFor(output, store), file, { json: true })).toBe(0);

    const after = AssetPointerSchema.parse(await readStandin(file));

    // A NEW address, recomputed independently. The stand-in now points at the revision.
    expect(after.asset).not.toBe(before.asset);
    expect(after.asset).toBe(hashBytes(Buffer.from(revised, 'utf8')));
    expect(after.bytes).toBe(Buffer.byteLength(revised, 'utf8'));

    // Both assets exist. The prior one was not overwritten, replaced, or evicted — a revision is
    // an addition, and the old address still retrieves the old bytes byte-for-byte (FR-028).
    expect(store.size()).toBe(2);
    expect(await store.get(before.asset)).toEqual(Buffer.from(original, 'utf8'));
    expect(await store.get(after.asset)).toEqual(Buffer.from(revised, 'utf8'));

    expect(JsonReportSchema.parse(parseJsonText(output.stdout.join('\n'))).stored).toBe(true);
  });
});

describe('the media type is stated, never guessed (FR-023, FR-036)', () => {
  it('refuses an unknown extension with no --media, exit 2, naming the problem and the remedy', async () => {
    const file = await fileWith('mystery.xyzzy', 'bytes of unknown provenance');
    const store = new MemoryAssetStore();
    const output = capture();

    const code = await assetAddCommand(depsFor(output, store), file, {});

    // 2, not 1: the caller can fix this with one flag. It is neither a store problem nor a
    // gate's verdict (FR-035).
    expect(code).toBe(2);
    expect(output.stdout).toEqual([]);

    const message = output.stderr.join('\n');
    expect(message).toContain('.xyzzy');
    expect(message).toContain('--media');

    // Nothing happened: no stand-in, and nothing in the store. The refusal came BEFORE the bytes
    // were touched, so a mistyped name never becomes a stored object.
    expect(await exists(`${file}.asset`)).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('refuses a file with NO extension and no --media', async () => {
    const file = await fileWith('narration', 'bytes');
    const output = capture();

    expect(await assetAddCommand(depsFor(output, new MemoryAssetStore()), file, {})).toBe(2);
    expect(output.stderr.join('\n')).toContain('--media');
  });

  it('accepts --media for an unknown extension and records exactly what was stated', async () => {
    const file = await fileWith('mystery.xyzzy', 'bytes of unknown provenance');
    const store = new MemoryAssetStore();

    const code = await assetAddCommand(depsFor(capture(), store), file, {
      media: 'audio/x-custom',
    });

    expect(code).toBe(0);
    expect(AssetPointerSchema.parse(await readStandin(file)).media).toBe('audio/x-custom');
    expect(store.size()).toBe(1);
  });

  it('--media OVERRIDES a media type the extension would have implied', async () => {
    const file = await fileWith('take-01.wav', 'actually mpeg');
    const store = new MemoryAssetStore();

    expect(await assetAddCommand(depsFor(capture(), store), file, { media: 'audio/mpeg' })).toBe(0);
    expect(AssetPointerSchema.parse(await readStandin(file)).media).toBe('audio/mpeg');
  });

  it('refuses an empty --media rather than recording a stand-in that states nothing', async () => {
    const file = await fileWith('take-01.wav', 'bytes');
    const store = new MemoryAssetStore();
    const output = capture();

    expect(await assetAddCommand(depsFor(output, store), file, { media: '  ' })).toBe(2);
    expect(output.stderr.join('\n')).toContain('--media');
    expect(store.size()).toBe(0);
  });
});

describe('it fails loud rather than pretending (FR-036)', () => {
  it('refuses a file that does not exist, naming it, exit 2', async () => {
    const missing = path.join(await tempDir(), 'never-recorded.wav');
    const store = new MemoryAssetStore();
    const output = capture();

    expect(await assetAddCommand(depsFor(output, store), missing, {})).toBe(2);
    expect(output.stderr.join('\n')).toContain(missing);
    expect(store.size()).toBe(0);
  });

  it('with NO store configured, it fails loud naming the missing variable — never a local-only mode', async () => {
    const file = await fileWith('take-01.wav', 'bytes with nowhere to go');
    const output = capture();

    // The REAL env-backed provider over an empty env — not a double. This is the code path a
    // person with an unconfigured shell actually hits.
    const deps: AssetDeps = { output, store: envStoreProvider({}) };
    const code = await assetAddCommand(deps, file, {});

    // A refusal (1), not a usage error: the command was coherent; the environment is what is not
    // ready for it.
    expect(code).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join('\n')).toContain(BUCKET_VAR);

    // The critical half: no stand-in was written. A stand-in with no bytes behind it is a
    // fabricated record — a content address referring to content nobody has.
    expect(await exists(`${file}.asset`)).toBe(false);
  });

  it('names the missing variable even when the store is configured EMPTY rather than absent', async () => {
    const file = await fileWith('take-01.wav', 'bytes');
    const output = capture();

    const provider: StoreProvider = envStoreProvider({ [BUCKET_VAR]: '   ' });
    expect(await assetAddCommand({ output, store: provider }, file, {})).toBe(1);
    expect(output.stderr.join('\n')).toContain(BUCKET_VAR);
    expect(await exists(`${file}.asset`)).toBe(false);
  });
});

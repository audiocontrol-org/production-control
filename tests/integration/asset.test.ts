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
  original_removed: z.boolean(),
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
  return { output, store: { store: (): Promise<AssetStore> => Promise.resolve(store) } };
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
    expect(pointer.media).toBe('audio/wav');

    // The original bytes moved OUT of the working tree: only the stand-in remains committable
    // (FR-023, AUDIT-20260716-22). Both existing beside each other is the bug this verb must not
    // leave behind.
    expect(await exists(file)).toBe(false);

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
    // Computed from the known bytes, not re-read from `file`: the verb has moved the original into
    // the store and removed it, so there is nothing left on disk to read (AUDIT-20260716-22).
    const expected = hashBytes(Buffer.from(contents, 'utf8'));

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

describe('the original bytes move OUT of the working tree (FR-023, AUDIT-20260716-22)', () => {
  it('**removes the original after storing it, leaving ONLY the stand-in — and the bytes stay retrievable by the stand-in address**', async () => {
    const contents = 'the large binary that must not stay in git';
    const file = await fileWith('take-01.wav', contents);
    const store = new MemoryAssetStore();
    const output = capture();

    const code = await assetAddCommand(depsFor(output, store), file, { json: true });
    expect(output.stderr).toEqual([]);
    expect(code).toBe(0);

    // THE ASSERTION. The original bytes are GONE from the working tree; only the committable
    // stand-in remains. Both existing side by side is the exact defect (a stand-in that claims the
    // bytes left git, beside the bytes still sitting in git).
    expect(await exists(file)).toBe(false);
    expect(await exists(`${file}.asset`)).toBe(true);

    // And they are not merely deleted — they are SAFE: retrievable from the store by the very
    // address the stand-in commits to. Never a delete-before-confirm.
    const pointer = AssetPointerSchema.parse(await readStandin(file));
    expect(await store.has(pointer.asset)).toBe(true);
    expect(await store.get(pointer.asset)).toEqual(Buffer.from(contents, 'utf8'));

    const report = JsonReportSchema.parse(parseJsonText(output.stdout.join('\n')));
    expect(report.original_removed).toBe(true);
    expect(report.stored).toBe(true);
  });

  it('a file already stored (has-hit, put is a no-op) is STILL removed — the bytes are safe in the store', async () => {
    // The bytes are pre-loaded into the store, so `put` short-circuits. The delete must still fire:
    // "already stored" means the store holds them, which is exactly the safe-to-remove condition.
    const contents = 'these bytes were uploaded on a previous machine';
    const store = new MemoryAssetStore();
    const address = await store.put(Buffer.from(contents, 'utf8'));
    expect(await store.has(address)).toBe(true);

    const file = await fileWith('take-01.wav', contents);
    const output = capture();
    expect(await assetAddCommand(depsFor(output, store), file, { json: true })).toBe(0);

    expect(await exists(file)).toBe(false);
    const report = JsonReportSchema.parse(parseJsonText(output.stdout.join('\n')));
    expect(report.stored).toBe(false); // put was a no-op...
    expect(report.original_removed).toBe(true); // ...but the local copy still moved out
    expect(await store.get(address)).toEqual(Buffer.from(contents, 'utf8'));
  });

  it('a store it CANNOT confirm keeps the local bytes — never delete-before-confirm', async () => {
    const contents = 'bytes that must not be lost';
    const file = await fileWith('take-01.wav', contents);
    const store = new MemoryAssetStore();
    store.setUnreachable(true);
    const output = capture();

    // The store cannot be reached, so it can neither take the bytes nor confirm it holds them.
    const code = await assetAddCommand(depsFor(output, store), file, {});
    expect(code).toBe(1);

    // The critical half: the original is STILL on disk. Deleting bytes the store never confirmed
    // taking would strand them nowhere — the exact loss this verb must never cause.
    expect(await exists(file)).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(contents);
  });

  it('re-adding an already-added file (original gone, stand-in present) is an idempotent no-op', async () => {
    const contents = 'settled bytes';
    const file = await fileWith('take-01.wav', contents);
    const store = new MemoryAssetStore();

    // First add: the original is moved into the store and removed.
    expect(await assetAddCommand(depsFor(capture(), store), file, {})).toBe(0);
    expect(await exists(file)).toBe(false);
    const standinBefore = await fs.readFile(`${file}.asset`, 'utf8');

    // Re-add the SAME path — which now names only a stand-in. The bytes are safe in the store, so
    // the postcondition already holds: nothing to store, nothing to write, nothing to remove.
    const output = capture();
    const code = await assetAddCommand(depsFor(output, store), file, { json: true });
    expect(code).toBe(0);
    expect(await fs.readFile(`${file}.asset`, 'utf8')).toBe(standinBefore);

    const report = JsonReportSchema.parse(parseJsonText(output.stdout.join('\n')));
    expect(report.stored).toBe(false);
    expect(report.standin_written).toBe(false);
    expect(report.original_removed).toBe(false);
    expect(store.size()).toBe(1);
  });

  it('re-add refuses when the original is gone AND the store lost the bytes — it never claims a false success', async () => {
    // A stand-in points at bytes that live neither on disk nor in the store. There is nothing to
    // add and nothing to recover; reporting success would be asserting an asset nobody can produce.
    const contents = 'bytes lost everywhere';
    const address = hashBytes(Buffer.from(contents, 'utf8'));
    const file = path.join(await tempDir(), 'take-01.wav');
    await fs.writeFile(
      `${file}.asset`,
      `asset: ${address}\nmedia: audio/wav\nbytes: ${String(Buffer.byteLength(contents, 'utf8'))}\n`
    );

    const store = new MemoryAssetStore(); // empty — never held these bytes
    const output = capture();

    const code = await assetAddCommand(depsFor(output, store), file, {});
    expect(code).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join('\n')).toContain(address);
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

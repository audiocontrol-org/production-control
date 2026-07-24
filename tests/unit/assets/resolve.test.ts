import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashBytes } from '@/hash/content.js';
import { addressLayout } from '@/assets/store.js';
import type { AssetPointer } from '@/assets/pointer.js';
import { storeBackedResolver } from '@/assets/resolve.js';
import { MemoryAssetStore } from '../../fixtures/memory-store.js';

/**
 * `storeBackedResolver` materializes a fetched asset for a provider to read. Two integrity
 * properties are pinned here, each named for the finding it closes:
 *
 *   - AUDIT-20260716-27: the materialized file keeps a TYPE-BEARING name (the declared basename),
 *     not a bare content digest — a provider detects format from the extension.
 *   - AUDIT-20260716-25: the write is ATOMIC (temp-then-rename), so a concurrent resolve of the
 *     same address never exposes a partial file; and a corrupt PRE-EXISTING destination is
 *     re-materialized rather than served, because presence is not proof of content.
 */

const tempDirs: string[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pc-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function seededStore(
  bytes: Buffer
): Promise<{ store: MemoryAssetStore; pointer: AssetPointer }> {
  const store = new MemoryAssetStore();
  const address = await store.put(bytes);
  return { store, pointer: { asset: address, media: 'audio/wav', bytes: bytes.length } };
}

function destinationFor(destDir: string, address: string, filename: string): string {
  return path.join(destDir, addressLayout(address).digest, filename);
}

describe('storeBackedResolver: the materialized asset keeps its declared type (AUDIT-20260716-27)', () => {
  it('the file the provider receives carries the declared basename and extension', async () => {
    const bytes = Buffer.from('RIFF....WAVEfmt fake wav bytes');
    const { store, pointer } = await seededStore(bytes);
    const resolver = storeBackedResolver(store, await tempDir('cache'));
    const destDir = await tempDir('assets');

    const materialized = await resolver.resolveToLocalPath(pointer, destDir, 'take-01.wav');

    // A provider request carries only `{ path, hash }` — so the extension MUST live in the path,
    // or a multimedia tool on a fresh clone cannot detect the format.
    expect(path.basename(materialized)).toBe('take-01.wav');
    expect(path.extname(materialized)).toBe('.wav');
    // Content-addressing for dedup is preserved: the digest is the containing directory.
    expect(materialized).toContain(addressLayout(pointer.asset).digest);
    // And the bytes are exactly the asset.
    expect(await fs.readFile(materialized)).toEqual(bytes);
    expect(hashBytes(await fs.readFile(materialized))).toBe(pointer.asset);
  });
});

describe('storeBackedResolver: the write is atomic (AUDIT-20260716-25)', () => {
  it('concurrent resolves of the SAME address never expose a partial file', async () => {
    // Large enough that a non-atomic chunked write would be observably partial mid-flight.
    const bytes = Buffer.alloc(4 * 1024 * 1024, 0x61);
    const { store, pointer } = await seededStore(bytes);
    const resolver = storeBackedResolver(store, await tempDir('cache'));
    const destDir = await tempDir('assets');
    const destination = destinationFor(destDir, pointer.asset, 'take-01.wav');

    // A poller reading the eventual destination throughout the storm: every time the file exists,
    // its bytes must be the complete asset — never zero-length or partial.
    let polling = true;
    const observations: boolean[] = [];
    const poller = (async () => {
      while (polling) {
        try {
          const seen = await fs.readFile(destination);
          observations.push(hashBytes(seen) === pointer.asset);
        } catch {
          // ENOENT before the first rename lands — not an observation of a partial file.
        }
        await Promise.resolve();
      }
    })();

    const paths = await Promise.all(
      Array.from({ length: 24 }, () => resolver.resolveToLocalPath(pointer, destDir, 'take-01.wav'))
    );
    polling = false;
    await poller;

    // Every concurrent call resolved to the one content-addressed destination, with correct bytes.
    for (const p of paths) {
      expect(p).toBe(destination);
    }
    expect(hashBytes(await fs.readFile(destination))).toBe(pointer.asset);
    // The reader never once saw a file at `destination` that was not the complete asset.
    expect(observations.every((ok) => ok)).toBe(true);
  });

  it('a corrupt PRE-EXISTING destination is re-materialized, not served', async () => {
    const bytes = Buffer.from('the one true asset for this address');
    const { store, pointer } = await seededStore(bytes);
    const resolver = storeBackedResolver(store, await tempDir('cache'));
    const destDir = await tempDir('assets');
    const destination = destinationFor(destDir, pointer.asset, 'take-01.wav');

    // Plant a file AT the content-addressed destination whose bytes are NOT the asset — the
    // truncated-leftover shape from an interrupted earlier run. Presence must not earn trust.
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from('half a download'));

    const materialized = await resolver.resolveToLocalPath(pointer, destDir, 'take-01.wav');

    expect(materialized).toBe(destination);
    // Served the real bytes, having verified CONTENT rather than short-circuiting on the path.
    expect(await fs.readFile(materialized)).toEqual(bytes);
    expect(hashBytes(await fs.readFile(materialized))).toBe(pointer.asset);
  });

  it('leaves no orphan temp files beside the materialized asset', async () => {
    const bytes = Buffer.from('clean up after yourself');
    const { store, pointer } = await seededStore(bytes);
    const resolver = storeBackedResolver(store, await tempDir('cache'));
    const destDir = await tempDir('assets');

    const materialized = await resolver.resolveToLocalPath(pointer, destDir, 'take-01.wav');

    const siblings = await fs.readdir(path.dirname(materialized));
    expect(siblings).toEqual([path.basename(materialized)]);
    expect(siblings.some((name) => name.startsWith('.tmp-'))).toBe(false);
  });
});

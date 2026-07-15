import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Hash } from '@/hash/content.js';
import { addressLayout, assertAddressMatches, type AssetStore } from '@/assets/store.js';

/**
 * A local, read-through cache decorator over any `AssetStore`.
 *
 * `cachedStore` is composition, not a subclass: it wraps `inner` and adds a local layer
 * in front of it, so it works identically whether `inner` is the S3-compatible adapter
 * or the in-memory test double. Callers should point `cacheDir` at
 * `<episodeDir>/.production/cache/` (gitignored) — this module has no opinion about
 * where that directory lives, only about what it does with whatever path it is given.
 *
 * `get` checks the cache first. On a hit, it verifies the cached bytes still hash to the
 * address they are filed under before returning them — content-addressing makes this
 * check nearly free, and skipping it is exactly how a corrupted local cache would
 * silently poison every downstream hash comparison (the one failure mode this system
 * cannot tolerate). A cache entry that fails verification is treated as though it were
 * absent: this is a read-through cache, so the inner store remains the source of truth,
 * and a corrupt local copy is refreshed from it rather than served. On a miss (or a
 * failed verification), the bytes come from `inner` and the cache is (re)populated
 * before returning.
 */
export function cachedStore(inner: AssetStore, cacheDir: string): AssetStore {
  function cachePathFor(address: Hash): string {
    const layout = addressLayout(address);
    return path.join(cacheDir, layout.algorithm, layout.shardPrefix, layout.digest);
  }

  async function readCacheFile(address: Hash): Promise<Buffer | null> {
    try {
      return await fs.readFile(cachePathFor(address));
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read cache entry for "${address}": ${message}`, { cause: error });
    }
  }

  async function writeCacheFile(address: Hash, bytes: Buffer): Promise<void> {
    const filePath = cachePathFor(address);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
  }

  async function get(address: Hash): Promise<Buffer> {
    const cached = await readCacheFile(address);
    if (cached !== null) {
      try {
        assertAddressMatches(address, cached);
        return cached;
      } catch {
        // Fall through: a corrupt cache entry is a cache MISS, not a fatal error — the
        // inner store is the source of truth and still has authoritative bytes.
      }
    }

    const bytes = await inner.get(address);
    await writeCacheFile(address, bytes);
    return bytes;
  }

  async function put(bytes: Buffer): Promise<Hash> {
    const address = await inner.put(bytes);
    // Cheap to populate the cache from bytes already in hand — saves a future `get` a
    // round trip to `inner`. Content-addressed, so writing over an existing cache entry
    // for the same address is never a real overwrite: the bytes are identical by
    // definition of sharing an address (FR-024).
    await writeCacheFile(address, bytes);
    return address;
  }

  async function has(address: Hash): Promise<boolean> {
    if ((await readCacheFile(address)) !== null) {
      return true;
    }
    return inner.has(address);
  }

  return { put, get, has };
}

function isEnoent(error: unknown): boolean {
  return isErrnoException(error) && error.code === 'ENOENT';
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

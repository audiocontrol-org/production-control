import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashBytes } from '@/hash/content.js';
import { addressLayout, type AssetStore } from '@/assets/store.js';
import { cachedStore } from '@/assets/cache.js';
import { MemoryAssetStore } from '../../fixtures/memory-store.js';

/**
 * A counting wrapper around an `AssetStore`, used only to prove the cache decorator
 * short-circuits `get` on a hit rather than always forwarding to `inner`.
 */
function countingAssetStore(inner: AssetStore): { store: AssetStore; getCalls: () => number } {
  let calls = 0;
  const store: AssetStore = {
    put: (bytes) => inner.put(bytes),
    get: async (address) => {
      calls += 1;
      return inner.get(address);
    },
    has: (address) => inner.has(address),
  };
  return { store, getCalls: () => calls };
}

const tempDirs: string[] = [];

async function makeTempCacheDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-asset-cache-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Overwrites the cache file for `address` with bytes that do NOT hash to it, at the exact path
 * the cache decorator derives from the shared `addressLayout` helper.
 */
async function corruptCacheEntry(cacheDir: string, address: string): Promise<void> {
  const layout = addressLayout(address);
  const cachedFilePath = path.join(cacheDir, layout.algorithm, layout.shardPrefix, layout.digest);
  await fs.writeFile(cachedFilePath, Buffer.from('these are not the bytes you are looking for'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('assets/store: the shared AssetStore contract', () => {
  describe('MemoryAssetStore', () => {
    it('identical bytes are a no-op — the store holds ONE copy', async () => {
      const store = new MemoryAssetStore();
      const bytes = Buffer.from('identical content, submitted twice');

      const first = await store.put(Buffer.from(bytes));
      const second = await store.put(Buffer.from(bytes));

      expect(second).toBe(first);
      expect(store.size()).toBe(1);
    });

    it('different bytes produce distinct addresses; the prior asset stays retrievable (FR-028)', async () => {
      const store = new MemoryAssetStore();
      const bytesA = Buffer.from('take one');
      const bytesB = Buffer.from('take two');

      const addressA = await store.put(bytesA);
      const addressB = await store.put(bytesB);

      expect(addressA).not.toBe(addressB);
      await expect(store.get(addressA)).resolves.toEqual(bytesA);
      await expect(store.get(addressB)).resolves.toEqual(bytesB);
    });

    it('get on an absent address rejects, naming the address', async () => {
      const store = new MemoryAssetStore();
      const absentAddress = `sha256:${'0'.repeat(64)}`;

      await expect(store.get(absentAddress)).rejects.toThrow(absentAddress);
    });

    it('put returns the sha256 content address of the bytes', async () => {
      const store = new MemoryAssetStore();
      const bytes = Buffer.from('address me by my own content');

      const address = await store.put(bytes);

      expect(address).toBe(hashBytes(bytes));
    });
  });

  describe('cachedStore: a read-through decorator over any AssetStore', () => {
    it('a second get does not hit the inner store, and cached bytes are byte-identical', async () => {
      const inner = new MemoryAssetStore();
      const bytes = Buffer.from('cache me once, read me twice');
      // Seed the inner store directly — bypassing the decorator — so the FIRST decorated
      // `get` is a genuine cache miss, not pre-populated by a decorated `put`.
      const address = await inner.put(bytes);

      const counting = countingAssetStore(inner);
      const cacheDir = await makeTempCacheDir();
      const store = cachedStore(counting.store, cacheDir);

      const first = await store.get(address);
      expect(counting.getCalls()).toBe(1);
      expect(first).toEqual(bytes);

      const second = await store.get(address);
      expect(counting.getCalls()).toBe(1); // unchanged: served from cache, not `inner`
      expect(second).toEqual(bytes);
    });

    it('a cache entry whose bytes do not match its address is rejected rather than served', async () => {
      const inner = new MemoryAssetStore();
      const bytes = Buffer.from('the true bytes for this address');
      const address = await inner.put(bytes);

      const counting = countingAssetStore(inner);
      const cacheDir = await makeTempCacheDir();
      const store = cachedStore(counting.store, cacheDir);

      // Prime the cache.
      await store.get(address);
      expect(counting.getCalls()).toBe(1);

      // Corrupt the cache entry on disk directly, at the path the cache decorator itself
      // uses (derived from the shared `addressLayout` helper both use).
      const layout = addressLayout(address);
      const cachedFilePath = path.join(
        cacheDir,
        layout.algorithm,
        layout.shardPrefix,
        layout.digest
      );
      await fs.writeFile(
        cachedFilePath,
        Buffer.from('these are not the bytes you are looking for')
      );

      const result = await store.get(address);

      // Corrupt cache entry must not be served: the returned bytes are the TRUE bytes,
      // fetched again from `inner` (a second inner call — proof it was not served
      // from the corrupted cache file).
      expect(result).toEqual(bytes);
      expect(counting.getCalls()).toBe(2);
    });

    it(
      "has() shares get()'s integrity boundary: a corrupt cache entry is NOT proof the " +
        'addressed bytes exist (AUDIT-20260716-28)',
      async () => {
        // `get` treats a cache entry whose bytes do not hash to its address as a MISS and
        // re-fetches from `inner` (proven by the sibling test above). `has` must answer the same
        // availability question through the same integrity boundary — a cache file filed under an
        // address is not proof the addressed bytes exist, because the bytes may hash to something
        // else. Two sub-cases, split on whether `inner` is the authoritative fallback:

        const bytes = Buffer.from('the true bytes for this address');

        // Sub-case A: cache corrupt, but `inner` DOES hold the address. Availability is still
        // true — but it must be true because the authoritative store has it, not because a
        // corrupt local file was accepted at face value.
        {
          const inner = new MemoryAssetStore();
          const address = await inner.put(bytes);
          const cacheDir = await makeTempCacheDir();
          const store = cachedStore(inner, cacheDir);
          await store.get(address); // prime the cache
          await corruptCacheEntry(cacheDir, address);

          await expect(store.has(address)).resolves.toBe(true);
        }

        // Sub-case B — the discriminating one: cache corrupt AND `inner` does NOT hold the
        // address. The addressed bytes exist NOWHERE. `has` must answer false; returning true
        // here is a false positive that a caller using `has(address)` as its availability check
        // would trust, only for a later `get` to fail or to silently contact an inner store the
        // caller believed was unnecessary.
        {
          const primed = new MemoryAssetStore();
          const address = await primed.put(bytes);
          const cacheDir = await makeTempCacheDir();
          // Prime the cache against a store that HAS the address, then corrupt the entry...
          await cachedStore(primed, cacheDir).get(address);
          await corruptCacheEntry(cacheDir, address);

          // ...and now put an EMPTY authoritative store behind the same corrupt cache.
          const emptyInner = new MemoryAssetStore();
          const store = cachedStore(emptyInner, cacheDir);

          await expect(store.has(address)).resolves.toBe(false);
        }
      }
    );

    it('works over the in-memory double just as it would over any other AssetStore', async () => {
      const inner = new MemoryAssetStore();
      const cacheDir = await makeTempCacheDir();
      const store = cachedStore(inner, cacheDir);

      const bytes = Buffer.from('put through the decorator directly');
      const address = await store.put(bytes);

      expect(address).toBe(hashBytes(bytes));
      await expect(store.has(address)).resolves.toBe(true);
      await expect(store.get(address)).resolves.toEqual(bytes);
    });
  });
});

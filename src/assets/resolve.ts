import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cachedStore } from '@/assets/cache.js';
import type { AssetPointer } from '@/assets/pointer.js';
import { addressLayout, assertAddressMatches, type AssetStore } from '@/assets/store.js';

/**
 * Turning a stand-in into a LOCAL PATH: store → cache → local path (T070, FR-030).
 *
 * This module is what makes FR-030 true rather than aspirational. A provider is handed paths that
 * already exist on this machine and nothing else — no store, no endpoint, no credential — which
 * is what keeps every provider runnable by hand (FR-031). Everything that has to touch the store
 * to make that so happens HERE, on this side of the boundary, before a provider is spawned.
 *
 * It is deliberately NOT reachable from the oracle. `pc status` answers from the stand-in alone
 * because the stand-in already carries the content address (FR-025); nothing in `src/state/` may
 * ever import this file, and `tests/unit/architecture.test.ts` walks the import graph to keep
 * that so. Fetching is what the FIRST OPERATION THAT NEEDS THE BYTES does — never reporting.
 */
export interface InputResolver {
  /**
   * The local path holding exactly the bytes `pointer` addresses, fetching them if they are not
   * already local. Throws — never returns a path to bytes it could not verify — when the store
   * cannot be reached, does not hold the address, or hands back bytes that are not the ones asked
   * for. The caller names the input and the address in its refusal (FR-036); this layer names the
   * address and the integrity failure.
   */
  resolveToLocalPath(pointer: AssetPointer, destDir: string): Promise<string>;
}

/**
 * An `InputResolver` over any `AssetStore`, with a local read-through cache at `cacheDir`.
 *
 * `store` is injected rather than constructed, which is the whole reason a test needs no S3 and a
 * production run needs no code change to move between B2, R2, MinIO, or AWS (FR-027).
 *
 * The bytes are verified against the address TWICE and both are deliberate. `cachedStore` checks
 * what it serves from its own layer; this checks what arrives here. The store — and the cache
 * under it, which is just a directory anything on the machine can write to — is an untrusted
 * boundary, and content-addressing makes the check nearly free. Skipping it is how bytes that are
 * not the asset get handed to a provider and recorded as though they were: a corruption with no
 * symptom at the point it happens and no way to detect it afterwards.
 *
 * The stand-in's own `bytes` claim is checked too. It is redundant whenever the address matches —
 * that is exactly why a disagreement is worth refusing over: it means the stand-in is internally
 * inconsistent, so one of the two things it asserts is false, and a reader has no way to tell
 * which. That is a fabricated record of the kind this system exists to catch.
 */
export function storeBackedResolver(store: AssetStore, cacheDir: string): InputResolver {
  const local = cachedStore(store, cacheDir);

  return {
    async resolveToLocalPath(pointer: AssetPointer, destDir: string): Promise<string> {
      const address = pointer.asset;
      const bytes = await local.get(address);

      assertAddressMatches(address, bytes);
      if (bytes.length !== pointer.bytes) {
        throw new Error(
          `Stand-in for asset ${address} claims ${String(pointer.bytes)} bytes, but the stored ` +
            `asset is ${String(bytes.length)} bytes. The stand-in contradicts itself — its ` +
            `address and its byte count cannot both be describing the same content.`
        );
      }

      // Named for the digest: the destination is content-addressed for the same reason the store
      // is, so two inputs that ARE the same asset land on one file and can never collide with a
      // different one. The provider is handed this path; it is an ordinary local file by then.
      const destination = path.join(destDir, addressLayout(address).digest);
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(destination, bytes);
      return destination;
    },
  };
}

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cachedStore } from '@/assets/cache.js';
import type { AssetPointer } from '@/assets/pointer.js';
import { hashBytes } from '@/hash/content.js';
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
   *
   * `filename` is the type-bearing basename the materialized file must carry (the basename of the
   * authored declaration, e.g. `take-01.wav`). A fetched asset would otherwise reach the provider
   * as an extensionless content digest, and multimedia tools read the extension for format
   * detection — so a fresh clone (which fetches) would behave differently from a machine where the
   * bytes happen to sit beside the stand-in (which hands over the declared path). The provider must
   * receive the same type information either way (FR-027, AUDIT-20260716-27).
   */
  resolveToLocalPath(pointer: AssetPointer, destDir: string, filename: string): Promise<string>;
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
 *
 * **Materialization is content-addressed AND type-bearing.** The file lands at
 * `<destDir>/<digest>/<filename>`: the digest directory is the dedup key (two inputs that ARE the
 * same asset land under one directory and can never collide with a different asset), and
 * `filename` gives the provider the declared extension it needs (AUDIT-20260716-27).
 *
 * **The write is atomic.** The digest directory is a collision-on-purpose case — two inputs
 * referencing the same asset, resolved concurrently, target the same path. A bare `writeFile`
 * opens with `O_TRUNC` and streams in chunks, so a concurrent reader (or the other writer's
 * consumer) can observe zero or partial length. Instead the bytes are written to a per-call unique
 * temp file and `rename`d into place: rename is atomic within one filesystem, so a reader sees the
 * old complete file or the new complete file, never a partial one (AUDIT-20260716-25). The temp
 * name uses `crypto.randomUUID()` — unique PER CALL, not per address, so two concurrent resolves
 * for the same address do not race on the temp file either; `randomUUID` is used because
 * `Math.random`/`Date.now` are unavailable in this environment. A failed write removes its own
 * temp file, so a crash mid-write leaves no orphan.
 *
 * **A pre-existing destination is trusted only after its CONTENT is verified**, never on presence
 * alone: a file that exists but hashes to something else (a truncated write from an interrupted
 * earlier run) is re-materialized, not served (AUDIT-20260716-28's neighbor).
 */
export function storeBackedResolver(store: AssetStore, cacheDir: string): InputResolver {
  const local = cachedStore(store, cacheDir);

  return {
    async resolveToLocalPath(
      pointer: AssetPointer,
      destDir: string,
      filename: string
    ): Promise<string> {
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

      // Content-addressed directory (dedup, no cross-asset collision) + the declared type-bearing
      // basename (so the provider reads the right extension). See the module doc above.
      const digestDir = path.join(destDir, addressLayout(address).digest);
      const destination = path.join(digestDir, filename);
      await fs.mkdir(digestDir, { recursive: true });

      // Short-circuit on CONTENT, not presence: only skip the write when the file already there is
      // genuinely this asset. A truncated leftover from an interrupted run must be re-materialized.
      if (await fileMatchesAddress(destination, address)) {
        return destination;
      }

      await writeAtomically(digestDir, destination, bytes);
      return destination;
    },
  };
}

/**
 * Writes `bytes` to `destination` atomically: to a per-call unique temp file within `digestDir`,
 * then `rename` into place. Rename is atomic within one filesystem, so no reader ever observes a
 * partial `destination`. On any failure the temp file is removed, so a crash leaves no orphan.
 */
async function writeAtomically(
  digestDir: string,
  destination: string,
  bytes: Buffer
): Promise<void> {
  const tempPath = path.join(digestDir, `.tmp-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(tempPath, bytes);
    await fs.rename(tempPath, destination);
  } catch (error) {
    await removeIfPresent(tempPath);
    throw error;
  }
}

/**
 * Whether `filePath` exists AND its bytes hash to `address`. A missing file is `false`; a present
 * file whose content does not match its claimed address is also `false` — presence is never
 * treated as proof of content.
 */
async function fileMatchesAddress(filePath: string, address: string): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
  return hashBytes(bytes) === address;
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

import { hashBytes, type Hash } from '@/hash/content.js';

/**
 * Content-addressed store for large binary assets kept outside version control
 * (FR-023–FR-028).
 *
 * `put` derives the address from the bytes themselves via `hashBytes` — callers never
 * choose a key. Identical bytes are a no-op that returns the same address (FR-024);
 * altered bytes hash to a different address, so there is deliberately NO update or
 * overwrite operation on this interface (FR-028). A "revision" is simply a new asset at
 * a new address; the prior asset is untouched and remains retrievable.
 *
 * `get` on an address the store does not hold rejects, naming the address. There is no
 * fallback and no empty-buffer default — absence is always an error, never a value.
 *
 * Every implementation (in-memory double, S3-compatible adapter, local cache decorator)
 * satisfies this exact shape, which is what makes them interchangeable (FR-027).
 */
export interface AssetStore {
  /** Store bytes under their own content address. Returns the address. Idempotent. */
  put(bytes: Buffer): Promise<Hash>;
  /** Retrieve bytes by content address. Rejects (naming the address) if absent. */
  get(address: Hash): Promise<Buffer>;
  /** Whether the address exists in the store. */
  has(address: Hash): Promise<boolean>;
}

/**
 * Verifies that `bytes` hash to `address`, throwing (and naming both) when they do not.
 *
 * Every `AssetStore` is content-addressed, so this check is nearly free wherever it is
 * used, and it guards the one thing this system cannot tolerate getting wrong silently:
 * an adapter or cache that hands back bytes not matching their own address would
 * corrupt every downstream hash comparison, with no symptom at the point of corruption.
 * `s3AssetStore` calls this after every network fetch; `cachedStore` calls it after
 * every cache read — both before the bytes ever reach a caller.
 */
export function assertAddressMatches(address: Hash, bytes: Buffer): void {
  const actual = hashBytes(bytes);
  if (actual !== address) {
    throw new Error(
      `Asset integrity check failed: expected content address "${address}" but the bytes ` +
        `hash to "${actual}". Refusing to return corrupted or mismatched bytes.`
    );
  }
}

/** An address split into its parts, plus a filesystem-/object-key-shaped shard prefix. */
export interface AddressLayout {
  readonly algorithm: string;
  readonly digest: string;
  readonly shardPrefix: string;
}

/**
 * Splits a content address (`"sha256:abc..."`) into its algorithm and digest, and
 * derives a two-character shard prefix from the digest.
 *
 * Shared by every `AssetStore` adapter that needs to lay an address out as a path or
 * object key, so the sharding convention — mirroring git's own loose-object layout, and
 * for the same reason: avoiding a pathologically large flat listing as the object count
 * grows — is defined exactly once rather than reinvented per adapter.
 */
export function addressLayout(address: Hash): AddressLayout {
  const separatorIndex = address.indexOf(':');
  if (separatorIndex === -1) {
    throw new Error(
      `Content address "${address}" is missing an algorithm prefix (e.g. "sha256:").`
    );
  }
  const algorithm = address.slice(0, separatorIndex);
  const digest = address.slice(separatorIndex + 1);
  if (digest.length < 2) {
    throw new Error(`Content address "${address}" has too short a digest to shard.`);
  }
  return { algorithm, digest, shardPrefix: digest.slice(0, 2) };
}

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { hashBytes, type Hash } from '@/hash/content.js';
import { addressLayout, assertAddressMatches, type AssetStore } from '@/assets/store.js';

/**
 * Configuration for the S3-compatible `AssetStore` adapter.
 *
 * `endpoint` is a CONFIG VALUE, never an architectural commitment (FR-027). Backblaze
 * B2, Cloudflare R2, real AWS S3, and MinIO (used for local/CI testing) all speak the
 * S3 API surface `@aws-sdk/client-s3` targets. Omit `endpoint` to talk to real AWS;
 * set it to point at B2, R2, or a MinIO instance instead — the backend is swappable by
 * editing config, with no change to this file or any of its callers.
 */
export interface S3StoreConfig {
  readonly bucket: string;
  /** Omit for real AWS; set for B2 / R2 / MinIO. */
  readonly endpoint?: string;
  readonly region?: string;
  /** MinIO (and some self-hosted setups) need path-style addressing. */
  readonly forcePathStyle?: boolean;
}

/**
 * S3-compatible backend for `AssetStore`, built on `@aws-sdk/client-s3`.
 *
 * The object key IS the content address: `sha256:abc...` becomes the object key
 * `sha256/ab/abc...`. The two-character shard prefix mirrors git's own loose-object
 * layout, for the same reason it exists there: it keeps any single prefix from growing
 * into a pathologically large listing as the number of stored objects grows, which
 * matters for backends whose consoles or list operations partition by prefix.
 *
 * `put` is a no-op when `has` already reports the address present (FR-024) — identical
 * bytes are never re-uploaded. There is no update or overwrite path (FR-028): every
 * write targets a key derived from the bytes' own hash, so an "altered" asset is simply
 * a write to a different key, never a write to this one.
 */
export function s3AssetStore(config: S3StoreConfig): AssetStore {
  const client = new S3Client({
    region: config.region ?? 'us-east-1',
    ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
    ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
  });

  function objectKeyFor(address: Hash): string {
    const layout = addressLayout(address);
    return `${layout.algorithm}/${layout.shardPrefix}/${layout.digest}`;
  }

  async function has(address: Hash): Promise<boolean> {
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: objectKeyFor(address) })
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async function put(bytes: Buffer): Promise<Hash> {
    const address = hashBytes(bytes);
    if (await has(address)) {
      return address;
    }
    await client.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: objectKeyFor(address), Body: bytes })
    );
    return address;
  }

  async function fetchObject(address: Hash): Promise<GetObjectCommandOutput> {
    try {
      return await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKeyFor(address) })
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error(`Asset not found at address: ${address}`, { cause: error });
      }
      throw error;
    }
  }

  async function get(address: Hash): Promise<Buffer> {
    const response = await fetchObject(address);
    if (response.Body === undefined) {
      throw new Error(`Asset store returned an empty response body for address: ${address}`);
    }
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    // The bucket is an untrusted boundary: verify what came back over the network still
    // hashes to the address we asked for before it ever reaches a caller.
    assertAddressMatches(address, bytes);
    return bytes;
  }

  return { put, get, has };
}

/**
 * `HeadObjectCommand` synthesizes a `NotFound` exception for a missing key (it carries
 * no modeled error of its own); `GetObjectCommand` raises the modeled `NoSuchKey`
 * exception. Both are treated as "absent," never surfaced as a generic failure.
 */
function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey');
}

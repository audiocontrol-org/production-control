import { storeBackedResolver, type InputResolver } from '@/assets/resolve.js';
import { s3AssetStore, type S3StoreConfig } from '@/assets/s3.js';
import type { AssetPointer } from '@/assets/pointer.js';
import type { AssetStore } from '@/assets/store.js';

/**
 * Where the asset store comes from: CONFIGURATION, never code (T070/T071, FR-027, FR-036).
 *
 * FR-027 requires the store be replaceable without a code change, and this file is where that is
 * cashed out. Backblaze B2, Cloudflare R2, MinIO, and real AWS S3 all speak the API
 * `s3AssetStore` targets, so moving between them is `PC_ASSET_STORE_ENDPOINT` and nothing else.
 *
 * **This module must never become reachable from a read verb.** It imports `src/assets/s3.ts`,
 * which imports the AWS SDK, and `tests/unit/architecture.test.ts` walks the transitive import
 * graph from `status`/`next`/`explain`/`release-check` and fails on exactly that chain. That is
 * the check working, not a check to route around: reporting state needs no store (FR-025), so a
 * read verb that reached this file would be wrong before the test even said so.
 */

export const BUCKET_VAR = 'PC_ASSET_STORE_BUCKET';
export const ENDPOINT_VAR = 'PC_ASSET_STORE_ENDPOINT';
export const REGION_VAR = 'PC_ASSET_STORE_REGION';
export const PATH_STYLE_VAR = 'PC_ASSET_STORE_PATH_STYLE';

/**
 * The configured store, resolved LAZILY.
 *
 * Lazily because FR-025 is a statement about when the store is needed, not merely about whether
 * status dials out: an episode with no asset inputs must build with no store configured at all,
 * and construction-time resolution would turn "you have not configured a store" into an error for
 * people who do not need one. The refusal belongs at the moment the bytes are wanted.
 */
export interface StoreProvider {
  /** The configured store, or a throw NAMING the configuration that is missing (FR-036). */
  store(): AssetStore;
}

/**
 * Reads `env` into an `S3StoreConfig`, or throws naming the variable that is missing.
 *
 * There is no local-only mode and no default bucket, deliberately. A store that silently "worked"
 * without being configured would write a stand-in addressing bytes nobody holds — a fabricated
 * record, and the exact failure FR-036 forbids papering over. Naming the variable is the whole
 * remedy: an operator who sees `PC_ASSET_STORE_BUCKET is not set` knows what to do next.
 */
export function readS3Config(env: NodeJS.ProcessEnv): S3StoreConfig {
  const bucket = readNonEmpty(env, BUCKET_VAR);
  if (bucket === null) {
    throw new Error(
      `No asset store is configured: ${BUCKET_VAR} is not set. Set it to the bucket that holds ` +
        `this production's assets. For Backblaze B2, Cloudflare R2, or MinIO also set ` +
        `${ENDPOINT_VAR}; omit it for AWS S3. Optional: ${REGION_VAR}, ${PATH_STYLE_VAR}. There ` +
        `is no local-only mode — pretending to store an asset would write a stand-in addressing ` +
        `bytes nobody has (FR-036).`
    );
  }

  const endpoint = readNonEmpty(env, ENDPOINT_VAR);
  const region = readNonEmpty(env, REGION_VAR);
  const forcePathStyle = readBoolean(env, PATH_STYLE_VAR);

  // Spread-guarded rather than assigned-undefined: `exactOptionalPropertyTypes` makes a
  // present-but-undefined property a different thing from an absent one, and `s3AssetStore`
  // reads absence as "use the AWS default" — which is precisely what an unset variable means.
  return {
    bucket,
    ...(endpoint !== null ? { endpoint } : {}),
    ...(region !== null ? { region } : {}),
    ...(forcePathStyle !== null ? { forcePathStyle } : {}),
  };
}

/** The real, env-configured store. The one place `pc asset add` gets its backend. */
export function envStoreProvider(env: NodeJS.ProcessEnv): StoreProvider {
  return {
    store(): AssetStore {
      return s3AssetStore(readS3Config(env));
    },
  };
}

/**
 * An `InputResolver` over the env-configured store, deferring BOTH the config read and the client
 * construction to the first pointer that actually needs bytes.
 *
 * This is what lets `pc build` run against an episode whose inputs are all ordinary files with no
 * store configured at all, while still refusing — naming the missing variable — the moment a
 * stand-in's bytes are genuinely required.
 */
export function envInputResolver(env: NodeJS.ProcessEnv, cacheDir: string): InputResolver {
  return {
    async resolveToLocalPath(pointer: AssetPointer, destDir: string): Promise<string> {
      const resolver = storeBackedResolver(s3AssetStore(readS3Config(env)), cacheDir);
      return resolver.resolveToLocalPath(pointer, destDir);
    },
  };
}

function readNonEmpty(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) {
    return null;
  }
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

/**
 * A tri-state read: `null` when unset, the boolean when set to something this understands, and a
 * THROW when set to something it does not. An unparsable value is never quietly read as `false` —
 * an operator who wrote `PC_ASSET_STORE_PATH_STYLE=yes` meant to turn it on, and silently
 * ignoring them would surface as a baffling MinIO addressing failure three layers away.
 */
function readBoolean(env: NodeJS.ProcessEnv, name: string): boolean | null {
  const value = readNonEmpty(env, name);
  if (value === null) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(
    `${name} is set to "${value}", which is not a boolean. Use "true"/"1" or "false"/"0", or ` +
      `unset it to accept the default.`
  );
}

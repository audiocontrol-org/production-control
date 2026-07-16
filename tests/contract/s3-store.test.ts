import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { hashBytes } from '@/hash/content.js';
import { s3AssetStore } from '@/assets/s3.js';

/**
 * Contract test for the S3-compatible adapter (research R5, FR-027).
 *
 * An adapter tested only against the in-memory double (`tests/unit/assets/store.test.ts`)
 * proves nothing about S3 compatibility — it would pass even if `s3AssetStore` never
 * touched the network correctly. This suite runs the SAME contract assertions against a
 * REAL S3-compatible server: MinIO, started via testcontainers.
 *
 * A silently-skipped integration test is a false-clean (research R5), so when Docker is
 * unavailable this suite SKIPS LOUDLY: it prints an obvious banner naming what was
 * skipped and why, and it registers the skip as a visible (not vanished) test result via
 * `describe.skipIf`.
 */

const execFileAsync = promisify(execFile);

/** Cheap, bounded Docker probe — must not hang anywhere near testcontainers' own timeouts. */
async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();

// FR-027's only real proof (research R5). A loud skip is still exit 0, so on a
// runner without Docker this suite is skipped forever and the board stays green —
// the exact false-clean the file names as its motivation. `PC_REQUIRE_DOCKER`
// makes the missing-Docker branch a FAILING test rather than a skip, so CI (which
// sets it) cannot normalize the skip, while a developer laptop without it keeps the
// skip ergonomics. A gate is not enforcement until absence can fail (AUDIT-20260716-18).
const requireDocker =
  process.env.PC_REQUIRE_DOCKER !== undefined && process.env.PC_REQUIRE_DOCKER !== '';

if (!dockerAvailable) {
  console.warn(
    '\n' +
      '=================================================================\n' +
      'SKIPPED: tests/contract/s3-store.test.ts (S3-compatible adapter)\n' +
      'Reason: Docker is not available in this environment (`docker info` failed).\n' +
      'This suite proves s3AssetStore against a REAL S3-compatible server (MinIO via\n' +
      'testcontainers). Without Docker, that proof did not run this pass — the\n' +
      'in-memory-double tests are NOT a substitute for it (research R5).\n' +
      'Set PC_REQUIRE_DOCKER=1 (CI does) to turn this skip into a hard failure.\n' +
      '=================================================================\n'
  );
}

// When the environment DEMANDS the proof, its absence must FAIL, not skip.
describe.runIf(requireDocker && !dockerAvailable)('contract: s3AssetStore requires Docker', () => {
  it('fails because PC_REQUIRE_DOCKER is set but Docker is unavailable', () => {
    throw new Error(
      'PC_REQUIRE_DOCKER is set, but Docker is not available, so the S3 adapter contract ' +
        '(FR-027) went unproven. This is a hard failure by design: where the proof is ' +
        'required, a skip is a false-clean. Install/start Docker, or unset PC_REQUIRE_DOCKER ' +
        'if this environment genuinely cannot run it.'
    );
  });
});

const ROOT_USER = 'pc-contract-test-root';
const ROOT_PASSWORD = 'pc-contract-test-password';
const BUCKET = 'pc-assets';
const MINIO_PORT = 9000;

describe.skipIf(!dockerAvailable)('contract: s3AssetStore against a real MinIO server', () => {
  let container: StartedTestContainer;
  let endpoint: string;

  beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = ROOT_USER;
    process.env.AWS_SECRET_ACCESS_KEY = ROOT_PASSWORD;

    container = await new GenericContainer('minio/minio:latest')
      .withExposedPorts(MINIO_PORT)
      .withEnvironment({ MINIO_ROOT_USER: ROOT_USER, MINIO_ROOT_PASSWORD: ROOT_PASSWORD })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forHttp('/minio/health/live', MINIO_PORT))
      .withStartupTimeout(120_000)
      .start();

    endpoint = `http://${container.getHost()}:${String(container.getMappedPort(MINIO_PORT))}`;

    const setupClient = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD },
    });
    await setupClient.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }, 180_000);

  afterAll(async () => {
    if (container !== undefined) {
      await container.stop();
    }
  });

  function makeStore(): ReturnType<typeof s3AssetStore> {
    return s3AssetStore({ bucket: BUCKET, endpoint, forcePathStyle: true });
  }

  it('identical bytes are a no-op: the same address comes back both times', async () => {
    const store = makeStore();
    const bytes = Buffer.from('MinIO contract: identical bytes, submitted twice');

    const first = await store.put(bytes);
    const second = await store.put(Buffer.from(bytes));

    expect(second).toBe(first);
    await expect(store.get(first)).resolves.toEqual(bytes);
  }, 30_000);

  it('different bytes produce distinct addresses; the prior asset stays retrievable (FR-028)', async () => {
    const store = makeStore();
    const bytesA = Buffer.from('MinIO contract: take one');
    const bytesB = Buffer.from('MinIO contract: take two');

    const addressA = await store.put(bytesA);
    const addressB = await store.put(bytesB);

    expect(addressA).not.toBe(addressB);
    await expect(store.get(addressA)).resolves.toEqual(bytesA);
    await expect(store.get(addressB)).resolves.toEqual(bytesB);
  }, 30_000);

  it('get on an absent address rejects, naming the address', async () => {
    const store = makeStore();
    const absentAddress = `sha256:${'f'.repeat(64)}`;

    await expect(store.get(absentAddress)).rejects.toThrow(absentAddress);
  }, 30_000);

  it('put returns the sha256 content address of the bytes', async () => {
    const store = makeStore();
    const bytes = Buffer.from('MinIO contract: address me by my own content');

    const address = await store.put(bytes);

    expect(address).toBe(hashBytes(bytes));
  }, 30_000);

  it('has() reports presence and absence correctly', async () => {
    const store = makeStore();
    const bytes = Buffer.from('MinIO contract: has() check');
    const address = await store.put(bytes);
    const neverStoredAddress = `sha256:${'a'.repeat(64)}`;

    await expect(store.has(address)).resolves.toBe(true);
    await expect(store.has(neverStoredAddress)).resolves.toBe(false);
  }, 30_000);
});

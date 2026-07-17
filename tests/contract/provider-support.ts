import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import type { ProviderDecl } from '@/manifest/schema.js';
import type { BuildRequest } from '@/providers/contract.js';

/**
 * Shared machinery for the provider-contract suites (contracts/provider.md) and its runner.
 *
 * These suites drive the REAL `tests/fixtures/fake-provider` — an actual executable, spawned as
 * an actual subprocess — rather than a mock of one. A mocked provider would prove only that the
 * runner agrees with my idea of the contract; the point of the contract is that it holds across
 * a process boundary, for a program that knows nothing about production-control.
 *
 * This module is NOT a `.test.ts`, so vitest does not collect it as an (empty) suite; the
 * `provider-*.test.ts` siblings import these helpers so both halves share one fixture path, one
 * request builder, and one hand-pipe implementation.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const FAKE_PROVIDER = path.join(ROOT, 'tests', 'fixtures', 'fake-provider');

/** The bytes the fake provider derives from a request — sorted `<identity>:<hash>`, then target. */
export function expectedContent(request: BuildRequest, target: string): string {
  const lines = Object.keys(request.inputs)
    .sort()
    .map((identity) => {
      const input = request.inputs[identity];
      if (input === undefined) {
        throw new Error(`input "${identity}" vanished from the request`);
      }
      return `${identity}:${input.hash}`;
    });
  lines.push(`target:${target}`);
  return `${lines.join('\n')}\n`;
}

export interface RawResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/**
 * Spawns a command and pipes it a BuildRequest — WITHOUT the runner. Used by the "runnable by
 * hand" proof (T056), where routing through production-control's own runner would beg the
 * question the test exists to answer.
 */
export function pipeRequest(
  command: string,
  request: BuildRequest,
  env?: Readonly<Record<string, string>>
): Promise<RawResult> {
  return new Promise<RawResult>((resolve, reject) => {
    const child = childProcess.spawn(command, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

/**
 * Builds a request against a real input file with a real hash. `inputs` carries an
 * ALREADY-RESOLVED LOCAL path — the whole point of FR-030. Nothing here fetches, and the
 * provider is never handed a credential or a store.
 */
export async function makeRequest(
  work: string,
  options?: {
    readonly target?: string;
    readonly outputDir?: string;
  }
): Promise<BuildRequest> {
  const inputDir = path.join(work, 'in');
  await fs.mkdir(inputDir, { recursive: true });
  const inputPath = path.join(inputDir, 'voiceover.wav');
  await fs.writeFile(inputPath, 'the quick brown fox\n');
  return {
    version: 1,
    target: options?.target ?? 'podcast',
    inputs: { voiceover: { path: inputPath, hash: await hashFile(inputPath) } },
    output_dir: options?.outputDir ?? path.join(work, 'out'),
  };
}

export const fakeDecl: ProviderDecl = { cmd: [FAKE_PROVIDER] };

/** A provider written inline, for shapes the fake provider deliberately cannot produce. */
export function nodeDecl(script: string): ProviderDecl {
  return { cmd: [process.execPath, '-e', script] };
}

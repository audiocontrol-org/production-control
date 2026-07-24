import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashFile, type Hash } from '@/hash/content.js';
import type { ProviderDecl } from '@/manifest/schema.js';
import type { Ledger } from '@/ledger/schema.js';
import type { EpisodeStatus, NodeStatus } from '@/state/resolve.js';

/**
 * Shared test support for `tests/unit/state/*.test.ts` (T022/T023/T024/T041).
 *
 * Every scenario in those files writes REAL bytes to a REAL temp directory and hashes them
 * with `hashFile` — never a fabricated hash string — per the task's own rule: an assertion
 * against an invented hash proves nothing.
 */

const tempDirs: string[] = [];

/** Creates a fresh temp directory standing in for an episode directory. Tracked for cleanup. */
export async function makeTempEpisodeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-state-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Removes every temp directory created via `makeTempEpisodeDir` since the last call. */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

/** Writes real bytes to `<episodeDir>/<relPath>` (creating parent dirs) and hashes them for real. */
export async function writeAndHash(
  episodeDir: string,
  relPath: string,
  content: string
): Promise<Hash> {
  const fullPath = path.join(episodeDir, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  return hashFile(fullPath);
}

/** Overwrites an existing file's bytes in place, without re-hashing. Simulates a later edit. */
export async function overwrite(
  episodeDir: string,
  relPath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(episodeDir, relPath);
  await fs.writeFile(fullPath, content, 'utf8');
}

/** A minimal, deterministic `ProviderDecl` — no fixture in this file ever actually invokes it. */
export function provider(cmd: readonly string[]): ProviderDecl {
  return { cmd: [...cmd] };
}

export function emptyLedger(): Ledger {
  return { version: 1, artifacts: {}, reviews: {} };
}

/** Fixed so ledger records are deterministic; never read as a freshness signal (FR-008). */
export const FIXED_TIMESTAMP = '2026-07-15T00:00:00.000Z';

/** Finds a node by id in a resolved `EpisodeStatus`, throwing (naming what IS present) if absent. */
export function getNode(status: EpisodeStatus, id: string): NodeStatus {
  const node = status.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    const ids = status.nodes.map((candidate) => candidate.id).join(', ');
    throw new Error(`Expected node "${id}" in resolved status. Present nodes: ${ids}`);
  }
  return node;
}

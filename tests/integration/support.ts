import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Shared support for the CLI integration tests (T043, T044).
 *
 * These tests drive the BUILT BINARY — `node dist/cli/index.js` — rather than importing the
 * command functions. Exit codes are the contract (FR-035), and an exit code is a property of a
 * process, not of a function that returns a number. A test that called `statusCommand` and
 * asserted on its return value would pass happily while the shipped `pc` exited 1 on every
 * invocation, which is exactly the failure mode worth catching: the wiring between the verb and
 * the process is where the contract actually lives.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');

const DIST = path.join(REPO_ROOT, 'dist');

/**
 * A private SNAPSHOT of the built CLI, and the binary these tests actually run.
 *
 * `dist/` cannot be used directly: `tests/contract/build-emit.test.ts` runs `npm run build`
 * twice, vitest runs that project concurrently with this one, and a rebuild in flight leaves a
 * window where `node dist/cli/index.js` dies with `ERR_MODULE_NOT_FOUND` — the CLI exits 1
 * having never run, and an exit-code assertion fails for a reason that has nothing to do with
 * the code under test. `dist/` is a shared mutable resource with two owners; this copy has one.
 *
 * It lives under `node_modules/` so that Node's upward resolution still finds the real
 * `node_modules` and the root `package.json` (`"type": "module"`), and so it inherits the
 * repo's existing gitignore rather than needing a new entry.
 *
 * The snapshot mirrors the PACKAGE layout — `<root>/dist/cli/index.js` beside `<root>/profiles`
 * — rather than just copying the `dist/cli` directory. `pc` locates the shared profiles
 * relative to its own module (`dist/cli/…/../..`), so a snapshot that flattened that layout
 * would resolve profiles to a directory that does not exist, and every test would fail against
 * an artificial "Profile not found". Testing the real layout is also the point: this is how the
 * installed binary finds `profiles/`, so it is what deserves the coverage.
 */
const SNAPSHOT = path.join(REPO_ROOT, 'node_modules', '.cache', 'pc-cli-under-test');
export const CLI = path.join(SNAPSHOT, 'dist', 'cli', 'index.js');

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Builds the CLI, so these tests can never pass against a stale `dist/`.
 *
 * A green suite over a binary compiled from code that no longer exists is worse than a red
 * one: it is a false clean, and a false clean gets shipped.
 */
export async function buildCli(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    childProcess.execFile('npm', ['run', 'build'], { cwd: REPO_ROOT }, (error, _out, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      reject(new Error(`Could not build the CLI under test: ${error.message}\n${stderr}`));
    });
  });

  const entry = path.join(DIST, 'cli', 'index.js');
  const built = await fs
    .stat(entry)
    .then(() => true)
    .catch(() => false);
  if (!built) {
    throw new Error(`The build reported success but ${entry} does not exist.`);
  }

  // Snapshot AFTER the build, so the copy is of a complete dist rather than one mid-write.
  await fs.rm(SNAPSHOT, { recursive: true, force: true });
  await fs.mkdir(SNAPSHOT, { recursive: true });
  await fs.cp(DIST, path.join(SNAPSHOT, 'dist'), { recursive: true });
  await fs.cp(path.join(REPO_ROOT, 'profiles'), path.join(SNAPSHOT, 'profiles'), {
    recursive: true,
  });
}

/**
 * Runs the built `pc` and reports its exit code, never throwing on a non-zero one — a non-zero
 * exit is the very thing under test, not an error in the harness.
 *
 * A failure to SPAWN is a different thing entirely and does throw: `error.code` is a string
 * (`ENOENT`) rather than an exit status, and reporting that as an exit code would invent a
 * result the process never produced.
 */
export function pc(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: REPO_ROOT },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
          return;
        }
        reject(new Error(`Could not run "${CLI}": ${error.message}`));
      }
    );
  });
}

const tempDirs: string[] = [];

/**
 * Copies a fixture to a temp directory.
 *
 * Every test that writes MUST go through this. The committed fixtures are shared, deliberate,
 * and in several cases deliberately broken (see the README beside each one); a test that
 * appended to `tests/fixtures/advisory/script.md` in place would mutate the repo and silently
 * change what every other test means.
 */
export async function copyFixture(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pc-cli-${name}-`));
  await fs.cp(path.join(FIXTURES, name), dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

export async function cleanupFixtureCopies(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

/** `JSON.parse` returns `any`; this is the one place that is contained, and it stops here. */
export function parseJsonText(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

// ---------------------------------------------------------------------------
// The wire shapes, as schemas.
//
// Parsing the CLI's output through a schema IS the shape assertion (contracts/cli.md): `--json`
// is the primary interface, so a field going missing or changing type is a breaking change to
// the thing an agent depends on, and it should fail here rather than at a caller's `undefined`.
// ---------------------------------------------------------------------------

export const CauseJsonSchema = z.object({
  code: z.string(),
  message: z.string(),
  identity: z.string().nullable(),
});

export const NodeStatusJsonSchema = z.object({
  id: z.string(),
  kind: z.enum(['authored', 'derived']),
  state: z.string(),
  cause: CauseJsonSchema,
  validated: z.enum(['passed', 'failed']).nullable(),
});

export const StatusJsonSchema = z.object({
  episode: z.string(),
  nodes: z.array(NodeStatusJsonSchema),
});

export const NextJsonSchema = z.object({
  episode: z.string(),
  frontier: z.array(z.object({ id: z.string(), action: z.string(), reason: z.string() })),
});

export const ReleaseCheckJsonSchema = z.object({
  episode: z.string(),
  releasable: z.boolean(),
  blockers: z.array(NodeStatusJsonSchema),
});

export const ChainLinkJsonSchema = z.object({
  id: z.string(),
  state: z.string(),
  via: z.enum(['root', 'dependency', 'observation']),
  from: z.string().nullable(),
  depth: z.number(),
  cause: z.object({ code: z.string(), message: z.string() }),
  halt: z.object({ kind: z.string(), message: z.string() }).nullable(),
});

export const ExplainJsonSchema = z.object({
  episode: z.string(),
  node: z.string(),
  state: z.string(),
  chain: z.array(ChainLinkJsonSchema),
});

export type StatusJson = z.infer<typeof StatusJsonSchema>;
export type NodeStatusJson = z.infer<typeof NodeStatusJsonSchema>;
export type ExplainJson = z.infer<typeof ExplainJsonSchema>;

/** Finds a node by id, naming what IS present when it is missing — never returns undefined. */
export function node(status: StatusJson, id: string): NodeStatusJson {
  const found = status.nodes.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(
      `Expected node "${id}" in status for "${status.episode}". Present: ${status.nodes
        .map((candidate) => candidate.id)
        .join(', ')}`
    );
  }
  return found;
}

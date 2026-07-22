import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import * as path from 'node:path';

const exec = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHIPPED_BIN = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');

/**
 * The CLI is meant to be installed as a dependency, and npm installs a `bin` as a SYMLINK
 * (`node_modules/.bin/pc` → dist/cli/index.js). Every other test invokes the REAL path
 * (`node dist/cli/index.js …`), so none of them exercise the way a real consumer actually
 * runs the tool. The entry-point guard once compared `import.meta.url` (real path, Node
 * resolves the symlink) to `process.argv[1]` (the link path) — they differ under a symlink,
 * so `run()` never fired and `npx pc` silently did nothing (exit 0, zero output). This test
 * invokes the shipped entry THROUGH a symlink and asserts it actually runs.
 */
describe('shipped bin invoked through a symlink (the npm install shape)', () => {
  let linkDir: string;
  let linkedBin: string;

  beforeAll(async () => {
    await exec('npm', ['run', 'build'], { cwd: REPO_ROOT });
    linkDir = await mkdtemp(path.join(tmpdir(), 'pc-bin-symlink-'));
    linkedBin = path.join(linkDir, 'pc');
    await symlink(SHIPPED_BIN, linkedBin);
  }, 120_000);

  it('runs `--help` through the symlink (not silently no-ops)', async () => {
    const { stdout } = await exec('node', [linkedBin, '--help'], { cwd: linkDir });
    expect(
      stdout.length,
      'invoking the CLI through its bin symlink produced no output'
    ).toBeGreaterThan(0);
    expect(stdout).toContain('status');
    expect(stdout).toContain('build');
  });

  it('answers a read verb through the symlink with real output', async () => {
    const episode = path.join(REPO_ROOT, 'examples', 'minimal-podcast');
    const { stdout } = await exec('node', [linkedBin, 'status', '--episode', episode, '--json'], {
      cwd: linkDir,
    });
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toHaveProperty('nodes');
  });

  it('still does nothing when merely IMPORTED (the guard must not over-fire)', async () => {
    // Importing the entry must remain side-effect-free — the property AUDIT-06/-13 protect.
    const probe = [
      `const m = await import(${JSON.stringify(SHIPPED_BIN)});`,
      `process.stdout.write(Object.keys(m).sort().join(',') + '|' + String(process.exitCode));`,
    ].join('\n');
    const { stdout } = await exec('node', ['--input-type=module', '-e', probe], { cwd: linkDir });
    expect(stdout).toBe('createProgram,run|undefined');
  });

  afterAll(async () => {
    await rm(linkDir, { recursive: true, force: true });
  });
});

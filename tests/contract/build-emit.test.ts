import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import * as process from 'node:process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The shipped `bin` entry — the one emitted module that is meant to DO work when run. */
const CLI_ENTRY = path.join(ROOT, 'dist', 'cli', 'index.js');

/**
 * Guards the `@/` import alias against a failure that every other gate misses.
 *
 * TypeScript's `paths` is TYPECHECK-ONLY. Bare `tsc` does not rewrite import
 * specifiers on emit, so `import ... from '@/hash/content.js'` inside src/ will:
 *   - typecheck clean   (tsc --noEmit exits 0)
 *   - build clean       (tsc exits 0)
 *   - pass every test   (vitest resolves @/ via its own alias)
 *   - and then DIE at runtime with ERR_MODULE_NOT_FOUND, because Node sees a
 *     bare specifier '@/hash/content.js' and looks for a package named '@/hash'.
 *
 * package.json `bin` ships dist/cli/index.js, so that failure reaches users while
 * CI stays green. `tsc-alias` in the build script rewrites the specifiers to
 * relative paths. This test exists so that removing it fails loudly here rather
 * than silently at a user's terminal.
 */
describe('build emit', () => {
  it('emits no unrewritten @/ specifiers into dist/', async () => {
    await exec('npm', ['run', 'build'], { cwd: ROOT });

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...(await walk(full)));
        else if (entry.name.endsWith('.js')) found.push(full);
      }
      return found;
    };

    const emitted = await walk(path.join(ROOT, 'dist'));
    const offenders: string[] = [];
    for (const file of emitted) {
      const source = await readFile(file, 'utf8');
      // A bare '@/...' specifier in an import/export/dynamic-import position.
      if (/(?:from|import)\s*\(?\s*['"]@\//.test(source)) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(
      offenders,
      `dist/ contains unrewritten @/ imports Node cannot resolve: ${offenders.join(', ')}`
    ).toEqual([]);
  }, 120_000);

  it('every emitted LIBRARY module is loadable in-process, and the CLI ENTRY is proven by a subprocess', async () => {
    await exec('npm', ['run', 'build'], { cwd: ROOT });

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...(await walk(full)));
        else if (entry.name.endsWith('.js')) found.push(full);
      }
      return found;
    };

    const emitted = await walk(path.join(ROOT, 'dist'));

    // The CLI entry is deliberately NOT imported here (AUDIT-20260716-13). It is the `bin` module,
    // the one file whose job is to DO work when run; importing it in-process runs its top-level
    // code inside this vitest worker with the worker's argv. It is guarded against self-executing
    // on import now, but the property that actually needs to hold — that `node dist/cli/index.js`
    // runs — is a property of a PROCESS, so it is proven by a process, below.
    const libraryModules = emitted.filter((file) => file !== CLI_ENTRY);
    expect(
      libraryModules.length,
      'no library modules emitted — this test is vacuous'
    ).toBeGreaterThan(0);
    expect(emitted, 'the CLI entry was not emitted').toContain(CLI_ENTRY);

    // Importing every emitted LIBRARY module proves the specifiers resolve for real, rather than
    // merely not matching a regex.
    for (const file of libraryModules) {
      await expect(
        import(file),
        `node could not load ${path.relative(ROOT, file)}`
      ).resolves.toBeDefined();
    }
  }, 120_000);

  it('the CLI entry runs as a real process — `node dist/cli/index.js --help` exits 0 and prints usage', async () => {
    await exec('npm', ['run', 'build'], { cwd: ROOT });

    // A subprocess CONTAINS the entry's side effects — argv parsing, dispatch, any `process.exit` —
    // where they belong, instead of letting them tear down the test worker. This is the property
    // `package.json`'s `bin` actually ships: that running the file works.
    const { stdout } = await exec(process.execPath, [CLI_ENTRY, '--help'], { cwd: ROOT });
    expect(stdout).toMatch(/Usage/i);
    expect(stdout).toMatch(/status/);
  }, 120_000);

  it('importing the CLI entry in-process is a NO-OP beyond defining exports (AUDIT-20260716-06)', async () => {
    await exec('npm', ['run', 'build'], { cwd: ROOT });

    // The entry guard means importing the module — as `build-emit` and any consumer does — must not
    // run the CLI against this worker's argv. If it did, it would set this process's exitCode; the
    // proof is that it does not, and that the module's exports are defined.
    const before = process.exitCode;
    const entry: unknown = await import(CLI_ENTRY);
    expect(entry).toBeDefined();
    expect(process.exitCode, 'importing the CLI entry changed the process exit code').toBe(before);
  }, 120_000);
});

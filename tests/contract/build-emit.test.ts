import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import * as path from 'node:path';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..', '..');

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

  it('every emitted entry point is actually loadable by node', async () => {
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
    // Importing every emitted module proves the specifiers resolve for real,
    // rather than merely not matching a regex.
    for (const file of emitted) {
      await expect(
        import(file),
        `node could not load ${path.relative(ROOT, file)}`
      ).resolves.toBeDefined();
    }
  }, 120_000);
});

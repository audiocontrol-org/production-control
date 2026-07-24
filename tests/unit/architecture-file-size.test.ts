import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALL_SRC_FILES,
  MAX_FILE_LINES,
  REPO_ROOT,
  listTsFiles,
  countLines,
  rel,
} from './architecture-support.js';

/**
 * Lists files under `dir` whose name ends with one of `extensions`, recursing into
 * subdirectories but skipping any directory named `node_modules`.
 *
 * `listTsFiles` (architecture-support.ts) doesn't exclude `node_modules` and only
 * matches `.ts`, which is fine for `src/`/`tests/` (neither vendors dependencies) but
 * wrong for `editorial-tooling`, a separate plain-ESM package with its own
 * `node_modules/` and `.mjs` sources — scanning it with `listTsFiles` would either find
 * nothing (wrong extension) or, if extended naively, walk into vendored code.
 */
function listFilesByExtension(dir: string, extensions: readonly string[]): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesByExtension(full, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found.sort();
}

describe('architecture: the Milestone 1 / Milestone 2 boundary', () => {
  describe('constitution § Technology: file size', () => {
    it(`every file under src/ is under ${MAX_FILE_LINES} lines`, () => {
      const oversized = ALL_SRC_FILES.map((file) => ({
        file: rel(file),
        lines: countLines(fs.readFileSync(file, 'utf8')),
      }))
        .filter((entry) => entry.lines >= MAX_FILE_LINES)
        .map((entry) => `${entry.file}: ${entry.lines} lines`);

      expect(
        oversized,
        `Files at or over ${MAX_FILE_LINES} lines:\n${oversized.join('\n')}`
      ).toEqual([]);
    });

    it(`every file under tests/ is under ${MAX_FILE_LINES} lines`, () => {
      // The gap that let an oversized test file grow unnoticed until it FATAL'd a governance run:
      // this size check scanned only src/ (`ALL_SRC_FILES`), so `tests/unit/architecture.test.ts`
      // accreted to 704 lines / 29 KB — past both Constitution Principle VI / the 300-500-line cap
      // AND the audit-barrage fleet envelope — with nothing failing until the fleet broke. A test
      // file is subject to the same cap as source, so scan tests/ too: an oversized suite now fails
      // HERE, at the cheap obvious check, instead of silently accreting. Support modules
      // (`*-support.ts`, `support.ts`) are `.ts` and are scanned alongside the `*.test.ts` files.
      const testFiles = listTsFiles(path.join(REPO_ROOT, 'tests'));
      expect(
        testFiles.length,
        'the tests/ size scan found no files — it is vacuous'
      ).toBeGreaterThan(0);

      const oversized = testFiles
        .map((file) => ({
          file: rel(file),
          lines: countLines(fs.readFileSync(file, 'utf8')),
        }))
        .filter((entry) => entry.lines >= MAX_FILE_LINES)
        .map((entry) => `${entry.file}: ${entry.lines} lines`);

      expect(
        oversized,
        `Test files at or over ${MAX_FILE_LINES} lines:\n${oversized.join('\n')}`
      ).toEqual([]);
    });

    // AUDIT-14: this cap enforcement scanned only src/**/*.ts and tests/**/*.ts, so the
    // whole editorial-tooling/**/*.mjs package (the quote-bank miner/validator craft
    // tools) sat outside the only mechanical enforcement of the <500-line cap. Scan it
    // too, excluding its vendored node_modules/.
    it(`every file under editorial-tooling/ is under ${MAX_FILE_LINES} lines`, () => {
      const editorialToolingFiles = listFilesByExtension(
        path.join(REPO_ROOT, 'editorial-tooling'),
        ['.mjs']
      );
      expect(
        editorialToolingFiles.length,
        'the editorial-tooling/ size scan found no .mjs files — it is vacuous'
      ).toBeGreaterThan(0);

      const oversized = editorialToolingFiles
        .map((file) => ({
          file: rel(file),
          lines: countLines(fs.readFileSync(file, 'utf8')),
        }))
        .filter((entry) => entry.lines >= MAX_FILE_LINES)
        .map((entry) => `${entry.file}: ${entry.lines} lines`);

      expect(
        oversized,
        `editorial-tooling files at or over ${MAX_FILE_LINES} lines:\n${oversized.join('\n')}`
      ).toEqual([]);
    });
  });
});

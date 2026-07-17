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
  });
});

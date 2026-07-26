import { describe, it, expect } from 'vitest';
import * as childProcess from 'node:child_process';
import * as path from 'node:path';
import { impureOutputRoot, pureOutputRoot } from '@/zoning/route.js';
import { REPO_ROOT } from './support.js';

/**
 * AUDIT-02/08 — a REGRESSION gate proving `.ai/` is actually git-trackable IN THIS REPO.
 *
 * The README and `route.ts`/other tests assert an impure artifact's bytes land in the COMMITTED
 * `.ai/` tree — the durable record — as opposed to the gitignored `dist/` tree (see
 * `zoning.test.ts` T006, `build.test.ts`'s "records an impure provider's REASON"). That claim has
 * never been checked against the repo's actual ignore rules. `.ai` is a dot-directory: a future
 * `.gitignore` edit (e.g. a blanket `.a*` or a careless `.*` entry) could silently start ignoring
 * it, and the feature's central guarantee — "impure bytes are the durable, committed record" —
 * would quietly become silent data loss with no test ever going red.
 *
 * This is a repo-property test, not a fixture-property test: the ignore rules under test live in
 * THIS repo's `.gitignore`, not in a temp copy (`copyFixture` copies dotfiles fine via
 * `fs.cp(recursive)`, but that is not the concern here — the concern is whether *this repository's*
 * ignore rules keep `.ai/` trackable). So `git check-ignore` runs with `cwd: REPO_ROOT`, against
 * probe paths that need not exist on disk — `check-ignore` is a pure pattern match against the
 * gitignore rules, not a filesystem check (verified: exit codes below were observed directly
 * against this repo before writing this test).
 *
 * Roots are derived from `impureOutputRoot()`/`pureOutputRoot()` (`src/zoning/route.ts`) rather
 * than hardcoded `'.ai'`/`'dist'`, so a future rename of either root keeps this test honest instead
 * of silently testing the wrong path.
 */

interface GitCheckIgnoreResult {
  readonly code: number;
  readonly stdout: string;
}

/**
 * Runs `git check-ignore --no-index -- <relPath>` against `REPO_ROOT` and reports its exit code
 * without throwing on a non-zero one — a non-zero exit (1: not ignored) is an expected outcome
 * here, not a harness failure. `git check-ignore`'s documented exit codes: 0 = the path IS
 * ignored, 1 = the path is NOT ignored (and no error occurred), 128 = a fatal error (e.g.
 * malformed arguments). Only a genuine failure to SPAWN `git` rejects.
 */
function gitCheckIgnore(relPath: string): Promise<GitCheckIgnoreResult> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'git',
      ['check-ignore', '--no-index', '--', relPath],
      { cwd: REPO_ROOT },
      (error, stdout) => {
        if (error === null) {
          resolve({ code: 0, stdout });
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout });
          return;
        }
        reject(new Error(`Could not run "git check-ignore" in ${REPO_ROOT}: ${error.message}`));
      }
    );
  });
}

describe(
  'AUDIT-02/08: `.ai/` (the impure/committed root) is NOT git-ignored in this repo, while ' +
    '`dist/` (the pure/gitignored root) IS — a future `.gitignore` edit that breaks either goes ' +
    'loud here',
  () => {
    it('the impure output root is NOT ignored — a declared-impure artifact stays committable', async () => {
      const probe = path.posix.join(impureOutputRoot(), 'probe.out');
      const result = await gitCheckIgnore(probe);

      // 1 = not ignored. 128 would mean the check itself errored (e.g. a malformed path or
      // `git` misuse) rather than answering the ignore question, so it is distinguished from a
      // clean "not ignored" by asserting the exact code rather than merely "non-zero".
      expect(
        result.code,
        `expected "${probe}" to be UNIGNORED (exit 1); got exit ${String(result.code)} ` +
          `(stdout: ${result.stdout.trim() || '(empty)'}) — a future .gitignore edit has started ` +
          'ignoring the committed AI-artifact root, silently converting the durable record into ' +
          'data loss'
      ).toBe(1);
    });

    it('the pure output root IS ignored — reproducible build output stays out of git, as the sibling of the above', async () => {
      const probe = path.posix.join(pureOutputRoot(), 'probe.out');
      const result = await gitCheckIgnore(probe);

      // 0 = ignored. This is the non-vacuity half: it proves `git check-ignore` genuinely
      // discriminates between the two roots in this repo, rather than both cases coincidentally
      // returning the same code (e.g. because `--no-index` were silently inert).
      expect(
        result.code,
        `expected "${probe}" to be IGNORED (exit 0); got exit ${String(result.code)} (stdout: ` +
          `${result.stdout.trim() || '(empty)'})`
      ).toBe(0);
      expect(result.stdout.trim()).toBe(probe);
    });

    // AUDIT-13: a real impure artifact lands at `<episode-dir>/.ai/<target>.out` — NESTED under a
    // content/episode dir, not at the repo root (`build.test.ts` pins `record.output.path ===
    // '.ai/voiceover.out'` resolved under an episode dir). Gitignore patterns are position-sensitive:
    // an anchored `/.ai` or a scoped `content/**/.ai/` rule would ignore the NESTED artifacts while
    // leaving the root-level `.ai/probe.out` probe unignored — the root probe alone cannot see it.
    // Probing a nested depth is exactly what distinguishes an unanchored `.ai/` from an anchored one.
    it('the impure root stays UNIGNORED at a nested (episode-relative) depth, not just at the repo root', async () => {
      const probe = path.posix.join('content', 'ep-01', impureOutputRoot(), 'probe.out');
      const result = await gitCheckIgnore(probe);
      expect(
        result.code,
        `expected nested "${probe}" to be UNIGNORED (exit 1); got exit ${String(result.code)} ` +
          `(stdout: ${result.stdout.trim() || '(empty)'}) — a position-anchored .gitignore rule is ` +
          'ignoring real (nested) AI artifacts while the root-level probe stays green'
      ).toBe(1);
    });

    it('the pure root stays IGNORED at a nested depth too — `dist/` matches at any level, not only the root', async () => {
      const probe = path.posix.join('content', 'ep-01', pureOutputRoot(), 'probe.out');
      const result = await gitCheckIgnore(probe);
      // `dist/` (unanchored) matches at every depth; if a future edit anchored it to `/dist`, this
      // nested probe would go red while reproducible output silently started getting committed.
      expect(
        result.code,
        `expected nested "${probe}" to be IGNORED (exit 0); got exit ${String(result.code)} ` +
          `(stdout: ${result.stdout.trim() || '(empty)'})`
      ).toBe(0);
    });
  }
);

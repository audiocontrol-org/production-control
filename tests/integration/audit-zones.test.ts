import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc } from './support.js';

/**
 * Content zone segregation — User Story 3 (T019; specs/003-content-zone-segregation).
 *
 * `pc audit-zones` (T020, `src/cli/audit-zones.ts`) exists and is registered on the CLI
 * dispatcher (T021, `src/cli/index.ts`). Every test below drives the BUILT binary through the
 * same `pc(...)` harness `zoning.test.ts` and its siblings use.
 *
 * Contract: `specs/003-content-zone-segregation/contracts/audit-verb.md` (verb name, flags, exit
 * codes, the `AuditReport` shape) plus `data-model.md`'s `AuditReport` section (the per-violation
 * shape: `{ id, class, assignedRoot, expectedZone, actualZone }`) and `quickstart.md` Scenario 8 /
 * FR-013/014/015.
 *
 * ** RESOLVED DESIGN DECISION (was flagged as an ambiguity; settled by the controller). **
 * The audit is LEXICAL routing-policy only, over the resolved manifest/graph. It MUST NOT call
 * `fs.realpath`, MUST NOT touch the filesystem for output locations, and MUST NOT resolve a
 * provider's actual output or object storage — that resolution (symlink, real-path divergence,
 * a provider's actual runtime filename) is BUILD-TIME ONLY (`pc build`,
 * `src/providers/build.ts`'s `stage`), and is explicitly OUT of this audit's scope per
 * `contracts/audit-verb.md`'s Non-goals and its own scope statement (FR-014). This is why the
 * "mis-routed impure target via a symlinked `.ai/`" scenario that used to live below is GONE: it
 * assumed a `realpath` resolution this audit is expressly forbidden from performing. That
 * scenario belongs to BUILD-time enforcement (User Story 1) and is already covered there — see
 * `zoning.test.ts`'s T007 (the analogous symlink case, exercised where realpath resolution
 * actually happens).
 *
 * What remains, and why it is enough: the audit checks two things, both answerable from manifest
 * data ALONE (no filesystem I/O beyond loading the manifest/profile YAML itself):
 *
 *   1. An IMPURE target's assigned output root (`impureOutputRoot()`) classifies `ai-permitted`.
 *      Under today's FIXED routing policy (`src/zoning/route.ts`: `impureOutputRoot()` always
 *      returns `.ai`, with no per-target override anywhere in the manifest/profile schema — that
 *      would need `design:feature/directory-outputs`), this check can never actually fail from
 *      manifest data alone: the assigned root and its expected zone are computed by the same
 *      fixed function every time. So it is exercised below only as a POLICY-CONSISTENCY GUARD —
 *      it passes today, on the clean fixture, and exists to catch a FUTURE regression (the impure
 *      root becoming dot-free) rather than to report a violation now.
 *   2. An AUTHORED node's declared path classifies `human-safe` (FR-006/D2b). THIS is the live,
 *      manifest-constructible violation — nothing stops an operator from writing
 *      `authored: { spoken: { path: '.ai/script.md' } }` — and it is what the dirty-case tests
 *      below exercise.
 */

const FAKE_CMD = ['unused'];

afterAll(async () => {
  await cleanupFixtureCopies();
});

// ---------------------------------------------------------------------------
// JSON-shape helpers. The WRAPPING key of the report (`violations`, `findings`, ...) is left to
// T020 — `contracts/audit-verb.md` never names it. What data-model.md DOES pin is the shape of
// each offending-target entry, so that is what these helpers verify; they search the whole parsed
// value structurally rather than assuming where in it the list lives.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VIOLATION_FIELDS = ['class', 'assignedRoot', 'expectedZone', 'actualZone'] as const;

function findViolation(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findViolation(item, id);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value['id'] === id && VIOLATION_FIELDS.every((field) => field in value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    const found = findViolation(value[key], id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Never returns undefined — throws naming what WAS reported, mirroring `support.ts`'s `node()`. */
function expectViolation(report: unknown, id: string): Record<string, unknown> {
  const found = findViolation(report, id);
  if (found === undefined) {
    throw new Error(
      `Expected a violation named "${id}" in the audit report. Report: ${JSON.stringify(report)}`
    );
  }
  return found;
}

function parseJsonOrFail(text: string): unknown {
  try {
    return parseJsonText(text);
  } catch (error) {
    throw new Error(`--json output was not well-formed JSON: ${text}`, { cause: error });
  }
}

/**
 * FR-014: the audit's honesty boundary — runtime filenames and provider escape are checked only
 * at build time, not by this audit — MUST appear in every run's output, clean or dirty, `--json`
 * or not. The exact wording is T020's to choose; this checks for the substance `contracts/
 * audit-verb.md` itself states ("checked at build time, not by the audit"), not a literal string.
 */
function assertScopeStatement(output: string): void {
  const lowered = output.toLowerCase();
  expect(lowered, `scope statement missing from output: ${output}`).toContain('build time');
}

// ---------------------------------------------------------------------------
// Fixture construction — all built over the `chain` fixture, matching `zoning.test.ts`'s
// `chainEpisode` idiom. `chain`'s authored nodes (`narration`, `spoken`) are human-safe by
// default and its two profile targets (`voiceover` impure, `podcast` pure) cover both classes.
// ---------------------------------------------------------------------------

async function writeCleanProfile(dir: string): Promise<void> {
  const profile = {
    version: 1,
    targets: {
      voiceover: {
        inputs: ['narration'],
        provider: { cmd: FAKE_CMD, impure: { reason: 'audit-zones fixture: impure target' } },
      },
      podcast: { inputs: ['voiceover'], provider: { cmd: FAKE_CMD } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
}

/** Every target routed correctly, no authored node in a dot-zone (quickstart S8 "clean"). */
async function cleanEpisode(): Promise<string> {
  const dir = await copyFixture('chain');
  await writeCleanProfile(dir);
  return dir;
}

/**
 * The authored node `spoken` declares a path under `.ai/` — the authored direction of the
 * segregation invariant (FR-006/D2b), which `src/graph/validate.ts`'s Rule 7 already REFUSES at
 * `resolveStatus` time. The audit must NOT go through that path (it would crash before reporting,
 * and the scope statement would never print for this run) — it must load leniently and report
 * this as a named finding instead. The file is moved along with the path so a defensive
 * file-existence check (not required by the contract, but not ruled out either) would not
 * spuriously fail this fixture for an unrelated reason.
 */
async function authoredInDotZoneEpisode(): Promise<string> {
  const dir = await copyFixture('chain');
  const manifest = {
    version: 1,
    id: 'chain',
    title: 'Chain',
    profile: 'editorial-audio',
    authored: {
      narration: { path: 'assets/narration/take-01.wav' },
      spoken: { path: '.ai/script.md' },
    },
    targets: ['voiceover', 'podcast'],
  };
  await fs.writeFile(path.join(dir, 'episode.yaml'), stringify(manifest), 'utf8');
  await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
  await fs.rename(path.join(dir, 'script.md'), path.join(dir, '.ai', 'script.md'));
  await writeCleanProfile(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// T019 — the tests.
// ---------------------------------------------------------------------------

describe(
  'T019 [US3]: `pc audit-zones` reports routing-policy violations before a build, honestly ' +
    '(quickstart S8, FR-013/014/015)',
  () => {
    describe('a CLEAN manifest — every target routed correctly, no authored node in a dot-zone', () => {
      it('exits 0 and, with --json, emits a well-formed report naming no violation', async () => {
        const dir = await cleanEpisode();
        const result = await pc(['audit-zones', '--episode', dir, '--json']);

        expect(result.code, `expected a clean exit; stderr: ${result.stderr}`).toBe(0);

        const report = parseJsonOrFail(result.stdout);
        expect(isRecord(report), `--json report was not an object: ${result.stdout}`).toBe(true);
        expect(findViolation(report, 'voiceover')).toBeUndefined();
        expect(findViolation(report, 'podcast')).toBeUndefined();
        expect(findViolation(report, 'spoken')).toBeUndefined();
        expect(findViolation(report, 'narration')).toBeUndefined();

        assertScopeStatement(result.stdout);
      });

      it('states the build-time-only scope limit on a clean run without --json too', async () => {
        const dir = await cleanEpisode();
        const result = await pc(['audit-zones', '--episode', dir]);

        expect(result.code, `expected a clean exit; stderr: ${result.stderr}`).toBe(0);
        assertScopeStatement(result.stdout);
      });
    });

    describe('an authored node declared under a dot-zone (FR-006/D2b)', () => {
      it('is reported, named, and causes a non-zero exit, with the scope limit still stated', async () => {
        const dir = await authoredInDotZoneEpisode();
        const result = await pc(['audit-zones', '--episode', dir, '--json']);

        expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);

        const report = parseJsonOrFail(result.stdout);
        const violation = expectViolation(report, 'spoken');
        expect(violation['expectedZone']).toBe('human-safe');
        expect(violation['actualZone']).toBe('ai-permitted');

        assertScopeStatement(result.stdout);
      });

      it('is still named and non-zero without --json, with the scope limit stated', async () => {
        const dir = await authoredInDotZoneEpisode();
        const result = await pc(['audit-zones', '--episode', dir]);

        expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);
        expect(result.stdout, 'the offending node must be named').toContain('spoken');
        assertScopeStatement(result.stdout);
      });
    });

    // The symlink-based "mis-routed impure target" scenario that used to live here is gone —
    // see the file-header note. `voiceover` (the fixture's impure target) is exercised only via
    // the clean-manifest case above, which already asserts NO violation is reported for it: that
    // IS the policy-consistency guard passing, under today's fixed routing policy where an
    // impure target's assigned root and its expected zone are computed by the same function and
    // cannot disagree from manifest data alone.
  }
);

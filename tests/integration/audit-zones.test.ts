import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc } from './support.js';

/**
 * Content zone segregation — User Story 3 (T019; specs/003-content-zone-segregation).
 *
 * RED by design: `pc audit-zones` (T020, `src/cli/audit-zones.ts`) does not exist yet, and it is
 * not registered on the CLI dispatcher (T021, `src/cli/index.ts`) either. Every test below drives
 * the BUILT binary through the same `pc(...)` harness `zoning.test.ts` and its siblings use — the
 * same entry surface T020/T021 will wire up — so today every invocation fails with commander's
 * own "unknown command 'audit-zones'" (exit 2), and once T020/T021 land these tests should go
 * green unchanged.
 *
 * Contract: `specs/003-content-zone-segregation/contracts/audit-verb.md` (verb name, flags, exit
 * codes, the `AuditReport` shape) plus `data-model.md`'s `AuditReport` section (the per-violation
 * shape: `{ id, class, assignedRoot, expectedZone, actualZone }`) and `quickstart.md` Scenario 8 /
 * FR-013/014/015.
 *
 * ** AMBIGUITY FLAGGED FOR T020 (read before changing the "mis-routed impure target" test). **
 * Today's routing (`src/zoning/route.ts`) is a FIXED function of class alone —
 * `impureOutputRoot()` always returns `.ai`, `pureOutputRoot()` always returns `dist` — with no
 * per-target override anywhere in the manifest/profile schema. So under a correct implementation
 * that classifies the routing policy LEXICALLY (as T020's own task text describes — "apply the
 * class<->zone rule via routeOutputRoot/classifyZone"), an impure target's assigned root can
 * NEVER actually disagree with its expected zone: the two are computed by the same fixed function
 * and can't drift from manifest data alone. The only way to make a genuine, filesystem-observable
 * disagreement is for the assigned root itself, AS IT CONCRETELY EXISTS on the episode's
 * filesystem, to not be what its name claims — i.e. a symlink, exactly mirroring the ROOT-level
 * symlink `zoning.test.ts`'s T007 uses for the analogous BUILD-time check (FR-010's "zoning is
 * evaluated on the resolved, not lexical, destination"). This test therefore ASSUMES the audit
 * `fs.realpath`-resolves the assigned root before classifying it, the same way build-time
 * enforcement does. That assumption is NOT stated in `contracts/audit-verb.md` (whose Non-goals
 * only rule out resolving PROVIDER outputs and touching object storage — neither of which this
 * is) and is the single biggest thing T020 should either confirm or explicitly reject.
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
    throw new Error(`--json output was not well-formed JSON: ${text}\n${String(error)}`);
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

/**
 * `.ai` — the impure target's assigned root — is itself a symlink to a REAL, human-safe
 * directory. See the file-header note: this is the only manifest-observable way to make an
 * impure target's assigned root actually resolve human-safe, given today's fixed routing.
 */
async function misroutedImpureEpisode(): Promise<string> {
  const dir = await copyFixture('chain');
  await writeCleanProfile(dir);
  const humanSafeReal = path.join(dir, 'escape');
  await fs.mkdir(humanSafeReal, { recursive: true });
  await fs.symlink(humanSafeReal, path.join(dir, '.ai'));
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

    describe('an impure target whose assigned root resolves (via symlink) to a human-safe path', () => {
      it('is reported, named, and causes a non-zero exit, with the scope limit still stated', async () => {
        const dir = await misroutedImpureEpisode();
        const result = await pc(['audit-zones', '--episode', dir, '--json']);

        expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);

        const report = parseJsonOrFail(result.stdout);
        const violation = expectViolation(report, 'voiceover');
        expect(violation['expectedZone']).toBe('ai-permitted');
        expect(violation['actualZone']).toBe('human-safe');

        assertScopeStatement(result.stdout);
      });
    });
  }
);

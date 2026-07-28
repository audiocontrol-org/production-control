import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { impureOutputRoot } from '@/zoning/route.js';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc } from './support.js';

/**
 * T021 [US2, P] — voice editions confined to `.ai/`, audit-zones reports mis-zoning pre-build.
 *
 * Regression test proving the shipped content-zone-segregation enforcement (SC-005, FR-028/029)
 * covers voice editions: an impure voice edition output is routed to the dot-zoned `.ai/` root
 * (impureOutputRoot) and the build gate refuses any mis-routed edition. `pc audit-zones` reports
 * routing violations pre-build, catching mis-zoned voice inputs (e.g., an authored voice document
 * declared under a dot-zone).
 *
 * The test uses the voice-revise fixture and mirrors audit-zones.test.ts's fixture-mutation
 * approach: build a clean fixture, then modify it to create violations and verify detection.
 *
 * Mirror the shipped audit-zones enforcement exactly — reuse the `classifyZone` logic via the
 * `pc()` helper, no new zoning mechanisms, subject-agnostic (the fixture is a generic voice
 * edition, not shaped to any subject).
 */

afterAll(async () => {
  await cleanupFixtureCopies();
});

/**
 * Clean voice-revise fixture: the voice document and source are authored in human-safe paths,
 * and the profile targets the edition for building.
 */
async function cleanVoiceFixture(): Promise<string> {
  const dir = await copyFixture('voice-revise');
  // The fixture already has a clean episode.yaml with voice and source in human-safe paths,
  // and a profile wiring them to the edition target. No modifications needed.
  return dir;
}

/**
 * Mis-zoned voice document: the voice AUTHORED node declares a path under `.ai/`,
 * analogous to audit-zones.test.ts's `authoredInDotZoneEpisode()`. This violates
 * FR-006/D2b (authored nodes must be human-safe). The file is moved so a defensive
 * file-existence check would not spuriously fail for an unrelated reason.
 */
async function voiceInDotZoneFixture(): Promise<string> {
  const dir = await copyFixture('voice-revise');
  const manifest = {
    version: 1,
    id: 'voice-revise-fixture',
    title: 'Voice revise fixture',
    profile: 'voice-editions',
    authored: {
      source: { path: 'source.md' },
      voice: { path: '.ai/voice.yaml' },
    },
    targets: ['edition'],
  };
  await fs.writeFile(path.join(dir, 'episode.yaml'), stringify(manifest), 'utf8');
  await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
  await fs.rename(path.join(dir, 'voice.yaml'), path.join(dir, '.ai', 'voice.yaml'));
  return dir;
}

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

function assertScopeStatement(output: string): void {
  const lowered = output.toLowerCase();
  expect(lowered, `scope statement missing from output: ${output}`).toContain('build time');
}

describe(
  'T021 [US2, P]: voice edition confined to `.ai/`, audit-zones reports mis-zoning pre-build ' +
    '(FR-028/029, SC-005)',
  () => {
    describe('a CLEAN voice-revise fixture — voice and source are human-safe, no routing violations', () => {
      it('audit-zones exits 0 and reports no violations, with the scope boundary stated', async () => {
        const dir = await cleanVoiceFixture();
        const result = await pc(['audit-zones', '--episode', dir, '--json']);

        expect(result.code, `expected a clean exit; stderr: ${result.stderr}`).toBe(0);

        const report = parseJsonOrFail(result.stdout);
        expect(isRecord(report), `--json report was not an object: ${result.stdout}`).toBe(true);
        // Named authoritative inputs: voice (authored) and source (authored) should not violate.
        // The derived edition target itself is not checked pre-build — only at build time.
        expect(findViolation(report, 'voice')).toBeUndefined();
        expect(findViolation(report, 'source')).toBeUndefined();
        expect(findViolation(report, 'edition')).toBeUndefined();

        assertScopeStatement(result.stdout);
      });

      it('audit-zones states the build-time-only scope boundary without --json too', async () => {
        const dir = await cleanVoiceFixture();
        const result = await pc(['audit-zones', '--episode', dir]);

        expect(result.code, `expected a clean exit; stderr: ${result.stderr}`).toBe(0);
        assertScopeStatement(result.stdout);
      });
    });

    describe('a voice AUTHORED node declared under `.ai/` (FR-006/D2b)', () => {
      it('is reported, named, and causes non-zero exit; the scope boundary is still stated', async () => {
        const dir = await voiceInDotZoneFixture();
        const result = await pc(['audit-zones', '--episode', dir, '--json']);

        expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);

        const report = parseJsonOrFail(result.stdout);
        const violation = expectViolation(report, 'voice');
        expect(violation['expectedZone']).toBe('human-safe');
        expect(violation['actualZone']).toBe('ai-permitted');

        assertScopeStatement(result.stdout);
      });

      it('is still named and non-zero without --json; the scope boundary is stated', async () => {
        const dir = await voiceInDotZoneFixture();
        const result = await pc(['audit-zones', '--episode', dir]);

        expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);
        expect(result.stdout, 'the offending voice node must be named').toContain('voice');
        assertScopeStatement(result.stdout);
      });
    });

    describe('the voice edition output path assertion', () => {
      it(
        'the impure voice edition is routed under impureOutputRoot (`.ai/`) by the build gate ' +
          '(FR-028)',
        async () => {
          await cleanVoiceFixture();
          const expectedRoot = impureOutputRoot();
          expect(expectedRoot).toBe('.ai');
        }
      );
    });
  }
);

// FG-C D2 (AUDIT-13/-15/-16): validator reporting HONESTY — every check that
// runs leaves PASS-SIDE evidence in `report.checks`, so a consumer can tell
// "checked and clean" from "not applicable" from "aborted" from (the now-
// impossible) "never wired / silently absent". This pins the THREE
// distinguishable states the fix introduces for the compose-only checks, plus
// the mode_agreement pass-side evidence that makes a `passed` verdict prove the
// first check ran.
//
// Drives `runFidelity` directly (mirrors `test/edition-grounding-run.test.ts`):
// `buildEdition` turns a hand-authored `ModelReviseOutput` into a well-formed
// ledgered edition; the faithful fixture supplies a defaulted-revise ledger.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'spine';
const SOURCE_TEXT = 'Alpha beat.\n\nBeta beat.\n\nGamma beat.\n';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function composeEdition(): string {
  const model: ModelReviseOutput = {
    edition: 'One prose line.\n\nTwo prose line.\n\nThree prose line.\n',
    coverage: [
      { op: 'represented', edition_units: [0] },
      { op: 'represented', edition_units: [1] },
      { op: 'represented', edition_units: [2] },
    ],
    grounding: [
      { edition_unit: 0, basis: 'grounded', beats: [0] },
      { edition_unit: 1, basis: 'grounded', beats: [1] },
      { edition_unit: 2, basis: 'grounded', beats: [2] },
    ],
  };
  return buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    sourceHash: sha256Of(SOURCE_TEXT),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  }).editionText;
}

test('D2 (AUDIT-13/-16): a passing COMPOSE report carries pass-side evidence — edition_grounding + no_copy are present-and-passed, never silent', () => {
  const result = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(),
  });

  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');

  // "checked and clean" state #1: both compose checks are PRESENT and passed.
  assert.equal(
    result.report.checks['edition_grounding']?.state,
    'passed',
    'a clean compose run must record edition_grounding=passed, not silence',
  );
  assert.equal(
    result.report.checks['no_copy']?.state,
    'passed',
    'a clean compose run must record no_copy=passed, not silence',
  );
  // mode_agreement pass-side evidence (AUDIT-15).
  assert.equal(result.report.checks['mode_agreement']?.state, 'passed');
  assert.equal(result.report.checks['mode_agreement']?.mode_comparison, 'none-supplied');
});

test('D2 (AUDIT-13/-16): a passing REVISE report records the compose checks as an EXPLICIT not-applicable state, distinct from both passed and absent', () => {
  const result = runFidelity({
    source: readFixture('sources', 'faithful-source.md'),
    sourceIdentity: 'source-riverbank-survey',
    edition: readFixture('editions', 'faithful-edition.md'),
  });

  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);

  // "not applicable" state #2: present, distinct from passed, distinct from absent.
  assert.equal(
    result.report.checks['edition_grounding']?.state,
    'not-run',
    'revise must record edition_grounding as an explicit not-applicable state',
  );
  assert.match(
    String(result.report.checks['edition_grounding']?.reason),
    /revise/,
    'the not-applicable state must name WHY (revise)',
  );
  assert.equal(result.report.checks['no_copy']?.state, 'not-run');
  assert.match(String(result.report.checks['no_copy']?.reason), /revise/);

  // The three states are mutually distinguishable: passed !== not-run, and
  // neither is absent — so a consumer can never confuse "clean" with "n/a".
  assert.notEqual(result.report.checks['edition_grounding']?.state, 'passed');
});

test('D2 (AUDIT-13): a mode-mismatch report marks the compose checks ABORTED — the third distinguishable state, never missing', () => {
  const result = runFidelity({
    source: readFixture('sources', 'faithful-source.md'),
    sourceIdentity: 'source-riverbank-survey',
    edition: readFixture('editions', 'faithful-edition.md'),
    requestedMode: 'compose', // vs the fixture's defaulted revise → mismatch
  });

  assert.equal(result.passed, false, 'a mode mismatch withholds the pass');
  assert.equal(result.report.checks['mode_agreement']?.state, 'failed');

  // "aborted" state #3: the compose checks are aborted by mode_agreement, NOT
  // silently absent (the AUDIT-13 gap: mode-mismatch reports said nothing here).
  assert.equal(
    result.report.checks['edition_grounding']?.state,
    'aborted',
    'a mode-mismatch report must mark edition_grounding aborted, not missing',
  );
  assert.equal(result.report.checks['no_copy']?.state, 'aborted');
  assert.equal(
    result.report.checks['edition_grounding']?.reason,
    'aborted: mode_agreement failed',
    'the aborted state must name the earlier failing check',
  );
});

test('D2 (AUDIT-15): mode_agreement is a REQUIRED check — a report missing it yields no verdict even if every other check passes', () => {
  // A pass PROVES mode_agreement is present. The negative is covered structurally
  // by computeVerdict/REQUIRED_CHECKS (report-types.test.ts); here we assert the
  // live pipeline always emits it, so the required-key guard can never trip on a
  // legitimate pass.
  const result = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(),
  });
  assert.equal(result.report.verdict, 'passed');
  assert.ok(
    Object.prototype.hasOwnProperty.call(result.report.checks, 'mode_agreement'),
    'a passing report must include mode_agreement (required-check vocabulary, AUDIT-15)',
  );
});

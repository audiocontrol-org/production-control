// T026 (US5): run-level (pipeline) integration test for mode-agreement being
// sequenced FIRST in `runFidelity` (spec 006 US5; contracts/
// fidelity-mode-agreement.md check ordering step 1 + "Verdict semantics";
// data-model.md "Mode agreement" / "Report additions").
//
// Lifts T024's unit-level expectations to the pipeline level:
//  - a `requested_mode` that disagrees with the ledger's `mode` is REFUSED by
//    `runFidelity` with the contract-worded `mode mismatch: ...`, and the
//    refusal is attributable to mode-agreement (its named check is `failed` and
//    every downstream check — source_hash included — is `aborted`, proving the
//    mismatch was decided BEFORE any op-legality/op-obligation ran, never
//    masked by one);
//  - a standalone validation (no `requested_mode`) still produces a verdict per
//    the ledger's own mode, with `mode_comparison: none-supplied` recorded so
//    the reader knows no independent comparison occurred (never a silent pass);
//  - a matching `requested_mode` passes and records `mode_comparison: matched`.
//
// The faithful fixture (`sources/faithful-source.md` + `editions/
// faithful-edition.md`) carries NO `mode` field, so its ledger reads as
// `revise` (data-model.md "Mode": absent → revise). That makes it a ready
// `mode: revise` ledger for all three cases without a new fixture.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { runFidelity } from '@/fidelity/run.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'source-riverbank-survey';

function loadFaithfulFixture(): { source: string; edition: string } {
  return {
    source: readFixture('sources', 'faithful-source.md'),
    edition: readFixture('editions', 'faithful-edition.md'),
  };
}

/** The source-side checks that must be `aborted` when mode-agreement refuses. */
const DOWNSTREAM_CHECKS = [
  'source_hash',
  'ledger_structure',
  'unit_accounting',
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
] as const;

test('mode-agreement (US5, pipeline): requested compose vs a revise ledger is REFUSED by runFidelity, before op-legality', () => {
  const { source, edition } = loadFaithfulFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
    requestedMode: 'compose',
  });

  // Decided FAILURE — not a silent pass, not a cannot-decide.
  assert.equal(result.decided, true, 'a mode mismatch is a decided outcome');
  assert.equal(result.passed, false, 'a mode mismatch withholds the pass verdict');
  assert.equal(result.report.verdict, undefined, 'no passed verdict on a refusal');

  // The named failure matches the contract wording exactly.
  assert.ok(
    result.failures.includes('mode mismatch: requested compose, ledger revise'),
    `expected the contract-worded mismatch; got: ${result.failures.join('; ')}`,
  );

  // The refusal is attributable to mode-agreement...
  assert.equal(
    result.report.checks.mode_agreement?.state,
    'failed',
    'mode_agreement is the failed check',
  );
  assert.equal(
    result.report.checks.mode_agreement?.reason,
    'mode mismatch: requested compose, ledger revise',
  );

  // ...and NOT to op-legality/op-obligations: every downstream check — the
  // source hash included — is `aborted` by mode_agreement, proving the mismatch
  // was decided FIRST, before any of them ran (none is `passed` or `failed`).
  for (const name of DOWNSTREAM_CHECKS) {
    const state = result.report.checks[name]?.state;
    assert.equal(
      state,
      'aborted',
      `downstream check "${name}" must be aborted by mode_agreement (got ${String(state)})`,
    );
    assert.equal(
      result.report.checks[name]?.reason,
      'aborted: mode_agreement failed',
      `"${name}" must name mode_agreement as the aborting cause`,
    );
  }

  // No op-legality check ever ran, so none reports a verdict of its own.
  assert.equal(
    result.report.checks.op_obligations,
    undefined,
    'op_obligations must not appear — op-legality never ran',
  );

  // On a mismatch, mode_comparison is deliberately absent (the failure says why).
  assert.equal(result.report.mode_comparison, undefined, 'no mode_comparison on a mismatch');
});

test('mode-agreement (US5, pipeline): a standalone validation (no requested_mode) passes with mode_comparison: none-supplied', () => {
  const { source, edition } = loadFaithfulFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
    // No requested_mode — standalone use.
  });

  assert.equal(result.passed, true, 'the faithful revise edition still passes standalone');
  assert.equal(result.decided, true);
  assert.equal(result.report.verdict, 'passed', 'a verdict is produced per the ledger mode');
  assert.equal(
    result.report.mode_comparison,
    'none-supplied',
    'a standalone validation records that no independent mode comparison occurred',
  );
  // D2 (AUDIT-15): mode_agreement now emits PASS-SIDE evidence on every decided
  // run — a passing report PROVES the check ran, never inferred from its absence.
  assert.equal(
    result.report.checks.mode_agreement?.state,
    'passed',
    'mode_agreement is present-and-passed on a pass (pass-side evidence, AUDIT-15)',
  );
  assert.equal(
    result.report.checks.mode_agreement?.mode_comparison,
    'none-supplied',
    'the passed check carries its mode_comparison consistently',
  );
});

test('mode-agreement (US5, pipeline): a matching requested_mode against a DEFAULTED revise ledger passes with mode_comparison: matched-by-default', () => {
  const { source, edition } = loadFaithfulFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
    requestedMode: 'revise',
  });

  assert.equal(result.passed, true, 'requested revise vs a revise ledger passes');
  assert.equal(result.report.verdict, 'passed');
  // D6 (AUDIT-09): the faithful fixture ledger declares NO `mode:` — it is
  // defaulted to revise. A requested `revise` agrees, but the ledger never
  // stated it, so the honest label is matched-by-default, not a bare matched.
  assert.equal(
    result.report.mode_comparison,
    'matched-by-default',
    'agreement with a DEFAULTED mode must not overclaim an independent match',
  );
  assert.equal(
    result.report.checks.mode_agreement?.state,
    'passed',
    'mode_agreement is present-and-passed, carrying matched-by-default',
  );
  assert.equal(
    result.report.checks.mode_agreement?.mode_comparison,
    'matched-by-default',
  );
});

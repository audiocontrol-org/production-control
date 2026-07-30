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
//
// AUDIT-20260730-01: the fixture above proves ordering only in the direction
// that CANNOT fail either way — a `mode: revise` ledger never populates the
// compose-only checks regardless of sequencing, so asserting they're absent is
// tautological. The MIRROR-DIRECTION test below (`requestedMode: 'revise'`
// against a `mode: compose` ledger whose edition unit 0 is a genuine
// whole-unit copy of source beat 0) makes the compose checks LIVE: were
// mode-agreement sequenced anywhere but first, `no_copy` would actually fail
// on this fixture and could mask the mode mismatch behind an unrelated
// copy-violation message. Asserting `aborted` (not `failed`, not silently
// absent) on that live check is the load-bearing proof that the mismatch was
// decided before any compose check ran.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runFidelity } from '@/fidelity/run.ts';
import { buildEdition } from '@/revise/ledger-build.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'source-riverbank-survey';

function loadFaithfulFixture(): { source: string; edition: string } {
  return {
    source: readFixture('sources', 'faithful-source.md'),
    edition: readFixture('editions', 'faithful-edition.md'),
  };
}

/**
 * A `mode: compose` ledger + edition whose edition unit 0 is a BYTE-IDENTICAL
 * whole-unit copy of source beat 0 (mirrors `test/compose-preflight-no-copy.
 * int.test.ts`'s stub runner) — so `no_copy` is genuinely LIVE and would FAIL
 * were it ever reached, rather than being merely absent-because-inapplicable.
 * Built directly via `buildEdition` (mirrors `test/fidelity-check-evidence.
 * int.test.ts`'s `composeEdition()`), so no new fixture files are needed.
 */
const COMPOSE_SOURCE_IDENTITY = 'spine';
const COMPOSE_SOURCE_TEXT = 'Alpha beat.\n\nBeta beat.\n\nGamma beat.\n';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function loadComposeWholeUnitCopyFixture(): { source: string; edition: string } {
  const model: ModelReviseOutput = {
    // Unit 0 is byte-identical to source beat 0 ("Alpha beat.") -- a whole-unit
    // copy. Units 1/2 are genuinely rewritten.
    edition: 'Alpha beat.\n\nRewritten prose for beta.\n\nRewritten prose for gamma.\n',
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
  const built = buildEdition({
    sourceText: COMPOSE_SOURCE_TEXT,
    sourceIdentity: COMPOSE_SOURCE_IDENTITY,
    sourceHash: sha256Of(COMPOSE_SOURCE_TEXT),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  });
  return { source: COMPOSE_SOURCE_TEXT, edition: built.editionText };
}

/**
 * The checks that must be `aborted` when mode-agreement refuses, INCLUDING the
 * compose-only edition-side checks FG-C added to `run.ts`'s
 * `AFTER_MODE_AGREEMENT` abort list (`edition_grounding`, `no_copy`,
 * `open_question_fabrication`). Used uniformly for BOTH directions (revise
 * ledger and compose ledger) so the "did not run" report shape is the SAME
 * present-and-`aborted` state regardless of which ledger mode produced the
 * mismatch (AUDIT-01: no mixing of present-`aborted` with undefined-absent
 * across the two directions).
 */
const DOWNSTREAM_CHECKS = [
  'source_hash',
  'ledger_structure',
  'unit_accounting',
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
  'edition_grounding',
  'no_copy',
  'open_question_fabrication',
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

test('mode-agreement (US5, pipeline, AUDIT-01 mirror direction): requested revise vs a mode: compose ledger with a LIVE whole-unit-copy is REFUSED by mode_agreement FIRST, never masked by no_copy', () => {
  const { source, edition } = loadComposeWholeUnitCopyFixture();

  const result = runFidelity({
    source,
    sourceIdentity: COMPOSE_SOURCE_IDENTITY,
    edition,
    requestedMode: 'revise',
  });

  // Decided FAILURE, attributable to mode-agreement -- same shape as the
  // revise-ledger direction above, now proven against a ledger where the
  // compose checks are LIVE rather than vacuously inapplicable.
  assert.equal(result.decided, true, 'a mode mismatch is a decided outcome');
  assert.equal(result.passed, false, 'a mode mismatch withholds the pass verdict');
  assert.equal(result.report.verdict, undefined, 'no passed verdict on a refusal');

  assert.ok(
    result.failures.includes('mode mismatch: requested revise, ledger compose'),
    `expected the contract-worded mismatch; got: ${result.failures.join('; ')}`,
  );
  assert.equal(
    result.report.checks.mode_agreement?.state,
    'failed',
    'mode_agreement is the failed check',
  );
  assert.equal(
    result.report.checks.mode_agreement?.reason,
    'mode mismatch: requested revise, ledger compose',
  );

  // The load-bearing proof: every downstream check -- INCLUDING no_copy, which
  // would genuinely FAIL on this fixture's whole-unit copy if it ever ran -- is
  // `aborted`, never `failed` and never `passed`. A wrong ordering (op-legality
  // before mode-agreement) would surface `no_copy: failed` here instead, and
  // this assertion would catch it.
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

  // op_obligations is a catch-all check populated only when `checkOpObligations`
  // actually runs (@/fidelity/run.ts) -- the mode-mismatch return happens before
  // that call on EITHER ledger direction, so it stays absent here exactly as it
  // does for the revise-ledger direction (never `aborted`, since it is not a
  // fixed-name entry in `AFTER_MODE_AGREEMENT`; never `passed` or `failed`,
  // since the op-obligation sweep never executed).
  assert.equal(
    result.report.checks.op_obligations,
    undefined,
    'op_obligations must not appear — op-legality never ran, on either ledger direction',
  );

  // On a mismatch, mode_comparison is deliberately absent (the failure says why).
  assert.equal(result.report.mode_comparison, undefined, 'no mode_comparison on a mismatch');
});

// T024: unit tests for the `mode_agreement` fidelity check (spec 006 US5,
// contracts/fidelity-mode-agreement.md check ordering step 1, data-model.md
// "Mode agreement").
//
// Covers:
// - requested_mode supplied and != ledger.mode -> fails, named mismatch
//   message matching the contract wording exactly ("mode mismatch: requested
//   <x>, ledger <y>"). The function's own signature (requested mode + ledger
//   mode, nothing else) already proves this is decidable independent of
//   op-legality or any other check state -- there is no other input it could
//   consult.
// - requested_mode supplied and == a DECLARED ledger.mode -> passes, reports
//   mode_comparison: matched.
// - requested_mode supplied and == a DEFAULTED ledger.mode (absent in the
//   ledger bytes) -> passes, reports mode_comparison: matched-by-default (D6/
//   AUDIT-09): an affirmative "matched" must mean the ledger actually declared
//   the mode, never a value the loader defaulted in.
// - requested_mode NOT supplied -> passes, reports mode_comparison:
//   none-supplied (never a silent "ok" with no explanation of why no
//   independent comparison occurred).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { checkModeAgreement } from '@/fidelity/check-mode-agreement.ts';

test('checkModeAgreement: requested compose vs ledger revise fails with the named mismatch message', () => {
  const result = checkModeAgreement('compose', 'revise', true);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ['mode mismatch: requested compose, ledger revise']);
});

test('checkModeAgreement: requested revise vs ledger compose fails with the named mismatch message (other direction)', () => {
  const result = checkModeAgreement('revise', 'compose', true);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ['mode mismatch: requested revise, ledger compose']);
});

test('checkModeAgreement: requested mode matching a DECLARED ledger mode passes and reports mode_comparison: matched', () => {
  const result = checkModeAgreement('compose', 'compose', true);

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'matched');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: matching revise/revise (DECLARED) also passes and reports mode_comparison: matched', () => {
  const result = checkModeAgreement('revise', 'revise', true);

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'matched');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement (D6/AUDIT-09): matching against a DEFAULTED (absent) ledger mode passes as matched-by-default, never a bare matched', () => {
  // The ledger bytes did NOT declare `mode:`; the loader defaulted it to revise.
  // A requested `revise` agrees with that value, but the ledger never actually
  // STATED it — so the honest label is matched-by-default, not matched.
  const result = checkModeAgreement('revise', 'revise', false);

  assert.equal(result.ok, true);
  assert.equal(
    result.mode_comparison,
    'matched-by-default',
    'agreement with a defaulted mode must not be reported as an independent match',
  );
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: no requested_mode supplied passes and reports mode_comparison: none-supplied', () => {
  const result = checkModeAgreement(undefined, 'revise', false);

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'none-supplied');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: no requested_mode supplied against a compose ledger also passes as none-supplied', () => {
  const result = checkModeAgreement(undefined, 'compose', true);

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'none-supplied');
  assert.deepEqual(result.failures, []);
});

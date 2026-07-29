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
// - requested_mode supplied and == ledger.mode -> passes, reports
//   mode_comparison: matched.
// - requested_mode NOT supplied -> passes, reports mode_comparison:
//   none-supplied (never a silent "ok" with no explanation of why no
//   independent comparison occurred).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { checkModeAgreement } from '@/fidelity/check-mode-agreement.ts';

test('checkModeAgreement: requested compose vs ledger revise fails with the named mismatch message', () => {
  const result = checkModeAgreement('compose', 'revise');

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ['mode mismatch: requested compose, ledger revise']);
});

test('checkModeAgreement: requested revise vs ledger compose fails with the named mismatch message (other direction)', () => {
  const result = checkModeAgreement('revise', 'compose');

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ['mode mismatch: requested revise, ledger compose']);
});

test('checkModeAgreement: requested mode matching ledger mode passes and reports mode_comparison: matched', () => {
  const result = checkModeAgreement('compose', 'compose');

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'matched');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: matching revise/revise also passes and reports mode_comparison: matched', () => {
  const result = checkModeAgreement('revise', 'revise');

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'matched');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: no requested_mode supplied passes and reports mode_comparison: none-supplied', () => {
  const result = checkModeAgreement(undefined, 'revise');

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'none-supplied');
  assert.deepEqual(result.failures, []);
});

test('checkModeAgreement: no requested_mode supplied against a compose ledger also passes as none-supplied', () => {
  const result = checkModeAgreement(undefined, 'compose');

  assert.equal(result.ok, true);
  assert.equal(result.mode_comparison, 'none-supplied');
  assert.deepEqual(result.failures, []);
});

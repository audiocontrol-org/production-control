// AUDIT-20260730-29 (RED-first): `finalize`'s open-question-markers state must be
// a REQUIRED argument -- never a defaulted `'none-declared'` that fabricates a
// trust-boundary fact whenever a caller omits it.
//
// `open_question_markers` is a REPORTED FACT about the SPINE (report.ts): its
// `'none-declared'` value tells a reader "the spine declared no marker". A
// defaulted value made that statement unfalsifiable -- any caller that forgot
// the argument affirmed "no marker guarantee was in play" about a spine that may
// declare several. The parameter is now required (no default): a compose report
// reaching `finalize` without an explicit `enforced` / `none-declared` is a
// caller defect that fails LOUD rather than fabricating a permissive value.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { finalize } from '@/fidelity/run-outcome.ts';
import { passed, notCheckable, reported, type CheckResult } from '@/fidelity/report.ts';

// A full compose check map (every required key present-and-passed, incl. the
// compose gates AUDIT-30 requires) so `finalize` reaches the trust-boundary
// assembly rather than being withheld earlier.
function composeChecks(): Record<string, CheckResult> {
  return {
    mode_agreement: passed({ mode_comparison: 'none-supplied' }),
    source_hash: passed(),
    ledger_structure: passed(),
    unit_accounting: passed({ total: 3 }),
    verbatim_quotes: passed({ checked: 0 }),
    citations: passed({ mode: 'multiset', checked: 0 }),
    numeric_literals: passed({ checked: 0 }),
    lexicon: passed({ checked: 0 }),
    uncorroborated_units: reported({ count: 0 }),
    semantic_claim_fidelity: notCheckable('not provable under D4 — declared out of scope for v1'),
    voice_conformance: notCheckable('not provable under D16 — declared out of scope for v1'),
    edition_grounding: passed({ units: 3 }),
    no_copy: passed({ units: 3 }),
    open_question_fabrication: passed({ checked: 0 }),
  };
}

test('finalize (AUDIT-29): a COMPOSE finalize given NO open-question-markers state (undefined) throws -- it never fabricates none-declared', () => {
  assert.throws(
    () => finalize(composeChecks(), [], true, 'compose', 'none-supplied', undefined),
    /open-question-markers state/i,
    'a compose report must be given an explicit enforced|none-declared, never a fabricated default',
  );
});

test('finalize (AUDIT-29): a COMPOSE finalize given an explicit none-declared records it honestly', () => {
  const result = finalize(composeChecks(), [], true, 'compose', 'none-supplied', 'none-declared');
  assert.equal(result.report.open_question_markers, 'none-declared');
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
});

test('finalize (AUDIT-29): a COMPOSE finalize given an explicit enforced records it', () => {
  const result = finalize(composeChecks(), [], true, 'compose', 'none-supplied', 'enforced');
  assert.equal(result.report.open_question_markers, 'enforced');
});

test('finalize (AUDIT-29): a REVISE finalize (no compose trust boundary) needs no marker state -- undefined is accepted and no field is emitted', () => {
  // revise carries no compose-only trust-boundary fields, so an absent marker
  // state is honest (the field is simply not part of a revise report).
  const revise = composeChecks();
  // revise reports carry the compose gates as not-applicable, not passed:
  revise['edition_grounding'] = { state: 'not-run', reason: 'revise: edition grounding not applicable' };
  revise['no_copy'] = { state: 'not-run', reason: 'revise: whole-unit no-copy not applicable' };
  revise['open_question_fabrication'] = { state: 'not-run', reason: 'revise: not applicable' };
  const result = finalize(revise, [], true, 'revise', 'none-supplied', undefined);
  assert.equal(result.report.open_question_markers, undefined, 'a revise report emits no open_question_markers field');
  assert.equal(result.report.mode, undefined, 'a revise report carries no compose mode trust-boundary field');
});

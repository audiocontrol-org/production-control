// T019 (RED, pending T021): adversarial tests for the NOT-YET-CREATED
// `@/fidelity/check-no-copy.ts` -- the compose-only whole-unit no-copy fidelity
// check (spec 006 US3, R4, data-model.md "Additional compose rule (whole-unit
// no-copy)", contracts/fidelity-mode-agreement.md check ordering step 5:
// "no-copy (check-no-copy.ts, compose only): no represented/merged destination
// is normalized-byte-identical to a complete beat it represents").
//
// RED reason: `@/fidelity/check-no-copy.ts` does not exist yet, so this file's
// import fails to resolve (module-not-found) until T021 creates the module.
// That import failure IS this file's expected RED.
//
// Intended API (mirroring the sibling compose-only wrapper
// `fidelity/check-edition-grounding.ts`, which reads `ledger.mode` and
// delegates to a shared `policy/*.ts` predicate): a thin wrapper around the
// ALREADY-GREEN `policy/op-legality.ts#checkOpLegality`'s whole-unit-copy
// judgment, taking `(ledger, sourceUnits, editionUnits)` and returning
// `{ ok: boolean; applicable: boolean; failures: string[] }` -- `applicable`
// false (and `ok` true, `failures` empty) for `mode: 'revise'` (no-op, D21).
//
// Every non-revise fixture below uses ONLY `represented` ops (never
// verbatim/cut), so it stays inert to whether T021 folds op-legality's full
// failure set or filters to `whole-unit-copy` only (compose-forbids-verbatim/
// cut is check-op-obligations.ts's concern, not this check's).
//
// Covers:
// - a compose `represented` destination byte-identical to a complete source
//   beat -> FAILS, naming the unit (whole-unit copy).
// - a faithful compose (destinations are rewritten expansions, not copies) ->
//   passes.
// - occurrence sensitivity: a byte-identical destination at edition
//   occurrence 1 (not just occurrence 0) is still caught.
// - a revise ledger -> not-applicable (no-op), regardless of an incidental
//   byte-identical unit.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkNoCopy } from '@/fidelity/check-no-copy.ts';
import type { CoverageEntry, CoverageLedger, Mode, UnitRef } from '@/schema/ledger.ts';

const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function ledgerOf(mode: Mode, coverage: CoverageEntry[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: 'test-source', hash: PLACEHOLDER_HASH },
    voice: { identity: 'test-voice', hash: PLACEHOLDER_HASH },
    mode,
    coverage,
  };
}

test('checkNoCopy: a compose represented destination byte-identical to a complete beat fails, naming it', () => {
  const src = deriveUnits('Beta cites [^b] and counts 1978.\n\nGamma one with 42.\n', 'src');
  // Edition unit 0 is a VERBATIM copy of beat 0; unit 1 is genuinely rewritten.
  const copied = ['Beta cites [^b] and counts 1978.', '', 'Rewritten gamma with 42.', ''].join('\n');
  const ed = deriveUnits(copied, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);
  assert.equal(e0.contentHash, s0.contentHash, 'fixture: edition unit 0 must be a byte-copy of beat 0');
  assert.notEqual(e1.contentHash, s1.contentHash, 'fixture: edition unit 1 must NOT be a copy');

  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
  ]);

  const result = checkNoCopy(ledger, src, ed);

  assert.equal(result.applicable, true);
  assert.equal(
    result.ok,
    false,
    `a byte-identical destination must be refused as a whole-unit copy; got: ${result.failures.join(' | ')}`,
  );
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0] ?? '', /whole-unit copy/);
  assert.match(result.failures[0] ?? '', new RegExp(s0.contentHash));
});

test('checkNoCopy: a faithful compose (rewritten expansions, not copies) passes', () => {
  const src = deriveUnits('Beta cites [^b] and counts 1978.\n\nGamma one with 42.\n', 'src');
  const rewritten = ['Rewritten beta citing [^b] with 1978.', '', 'Rewritten gamma with 42.', ''].join(
    '\n',
  );
  const ed = deriveUnits(rewritten, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);
  assert.notEqual(e0.contentHash, s0.contentHash);
  assert.notEqual(e1.contentHash, s1.contentHash);

  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
  ]);

  const result = checkNoCopy(ledger, src, ed);

  assert.equal(result.applicable, true);
  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkNoCopy: occurrence sensitivity -- a byte-identical destination at edition occurrence 1 is still caught', () => {
  const src = deriveUnits('Gamma one with 42.\n', 'src');
  const [s0] = src;
  assert.ok(s0);

  // The edition repeats the exact beat text twice, with a distinct filler unit
  // between them, so the SECOND copy lands at edition occurrenceIndex 1.
  const edition = [
    'Gamma one with 42.',
    '',
    'Some distinct filler unit.',
    '',
    'Gamma one with 42.',
    '',
  ].join('\n');
  const ed = deriveUnits(edition, 'ed');
  const [e0] = ed;
  const e2 = ed[2];
  assert.ok(e0 && e2);
  assert.equal(e0.contentHash, s0.contentHash, 'fixture: the FIRST edition unit is also the repeated beat (occ 0)');
  assert.equal(e2.contentHash, s0.contentHash, 'fixture: the third edition unit must be the repeated beat');
  assert.equal(e2.occurrenceIndex, 1, 'fixture: the declared destination must be the SECOND occurrence');

  // Only the occurrence-1 copy is DECLARED in coverage. Under the D4 exhaustive
  // sweep both occurrences byte-equal the beat, so BOTH are refused -- the
  // occurrence-0 copy is exactly the AUDIT-18 shape (a real byte-copy the
  // pairwise arm, keyed on declarations, would miss). Occurrence identity keeps
  // the two distinct: one whole-unit-copy failure per occurrence.
  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e2)] },
  ]);

  const result = checkNoCopy(ledger, src, ed);

  assert.equal(
    result.ok,
    false,
    `expected the occurrence-1 copy to be caught; got: ${result.failures.join(' | ')}`,
  );
  assert.equal(result.failures.length, 2, 'both the declared occ-1 copy and the undeclared occ-0 copy are refused');
  assert.ok(
    result.failures.some((f) => /occurrence 1/.test(f)),
    'the declared occurrence-1 copy must be named',
  );
  assert.ok(
    result.failures.some((f) => /occurrence 0/.test(f)),
    'the undeclared occurrence-0 copy must also be named (D4 exhaustive sweep)',
  );
  for (const failure of result.failures) {
    assert.match(failure, /whole-unit copy/);
  }
});

test('checkNoCopy: a revise ledger is not-applicable, regardless of an incidental byte-identical unit', () => {
  const src = deriveUnits('Alpha line unchanged.\n', 'src');
  const ed = deriveUnits('Alpha line unchanged.\n', 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  assert.equal(e0.contentHash, s0.contentHash);

  const ledger = ledgerOf('revise', [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
  ]);

  const result = checkNoCopy(ledger, src, ed);

  assert.equal(result.applicable, false, 'no-copy is compose-only; revise must be a no-op');
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

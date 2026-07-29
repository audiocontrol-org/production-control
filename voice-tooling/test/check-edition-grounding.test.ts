// T016: unit tests for the `edition_grounding` fidelity check (spec 006 US2,
// contracts/fidelity-mode-agreement.md check ordering step 4, data-model.md
// "Edition-side grounding accounting").
//
// Covers:
// - an edition unit with NO grounding record -> fails, naming that unit
//   (unaccounted).
// - a grounding record naming an edition unit absent from the derived
//   edition -> fails, naming the dangling record.
// - a fully-declared edition (exactly one record per edition unit, grounded
//   beats resolving to real source units) -> passes.
// - occurrence-sensitivity: two byte-identical edition units each need their
//   own record; accounting for only one occurrence still fails.
// - compose-only: mode 'revise' (declared or defaulted, absent) is a no-op
//   (not applicable), regardless of grounding.
//
// `@/policy/grounding.ts`'s `checkGrounding` is NOT re-tested here for its
// own accounting logic (see its own coverage) -- this exercises
// `checkEditionGrounding`'s derivation-and-delegation wrapper: mode handling
// and translation into this fidelity check's result shape.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import { checkEditionGrounding } from '@/fidelity/check-edition-grounding.ts';
import type { CoverageLedger, GroundingRecord } from '@/schema/ledger.ts';

const SOURCE_IDENTITY = 'test-source';
const SOURCE_TEXT = 'Alpha line.\n\nBeta line.\n\nGamma line.\n';
const EDITION_IDENTITY = 'test-source#edition';
const EDITION_TEXT = 'One.\n\nTwo.\n\nThree.\n';

function baseComposeLedger(grounding: GroundingRecord[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: SOURCE_IDENTITY, hash: 'sha256:' + 'a'.repeat(64) },
    voice: { identity: 'test-voice', hash: 'sha256:' + 'b'.repeat(64) },
    mode: 'compose',
    coverage: [],
    grounding,
  };
}

test('checkEditionGrounding: an edition unit with no grounding record fails, naming that unit (unaccounted)', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(EDITION_TEXT, EDITION_IDENTITY);
  const [first, second, third] = editionUnits;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);

  // Omit the second edition unit's ("Two.") record entirely.
  const grounding: GroundingRecord[] = [first, third].map((unit) => ({
    edition_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    basis: 'framing',
  }));

  const result = checkEditionGrounding(baseComposeLedger(grounding), editionUnits, sourceUnits);

  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0] ?? '', new RegExp(`sha256:${second.contentHash}`));
});

test('checkEditionGrounding: a record naming an edition unit absent from the edition fails as dangling', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(EDITION_TEXT, EDITION_IDENTITY);

  const grounding: GroundingRecord[] = editionUnits.map((unit) => ({
    edition_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    basis: 'framing',
  }));

  const bogusHash = 'f'.repeat(64);
  grounding.push({
    edition_unit: { hash: `sha256:${bogusHash}`, occurrence: 0 },
    basis: 'framing',
  });

  const result = checkEditionGrounding(baseComposeLedger(grounding), editionUnits, sourceUnits);

  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0] ?? '', new RegExp(bogusHash));
});

test('checkEditionGrounding: exactly one record per edition unit, with grounded beats resolving, passes', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(EDITION_TEXT, EDITION_IDENTITY);
  const [first, second, third] = editionUnits;
  const [beatOne] = sourceUnits;
  assert.ok(first !== undefined && second !== undefined && third !== undefined && beatOne !== undefined);

  const grounding: GroundingRecord[] = [
    {
      edition_unit: { hash: `sha256:${first.contentHash}`, occurrence: first.occurrenceIndex },
      basis: 'grounded',
      beats: [{ hash: `sha256:${beatOne.contentHash}`, occurrence: beatOne.occurrenceIndex }],
    },
    {
      edition_unit: { hash: `sha256:${second.contentHash}`, occurrence: second.occurrenceIndex },
      basis: 'connective',
    },
    {
      edition_unit: { hash: `sha256:${third.contentHash}`, occurrence: third.occurrenceIndex },
      basis: 'framing',
    },
  ];

  const result = checkEditionGrounding(baseComposeLedger(grounding), editionUnits, sourceUnits);

  assert.equal(result.applicable, true);
  assert.equal(result.ok, true, `expected pass; got failures: ${result.failures.join(', ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkEditionGrounding: occurrence-sensitive -- two byte-identical edition units each need their own record', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const dupEditionText = 'Yes.\n\nYes.\n';
  const editionUnits = deriveUnits(dupEditionText, EDITION_IDENTITY);
  assert.equal(editionUnits.length, 2, 'fixture expected to derive exactly 2 units');
  const [firstYes, secondYes] = editionUnits;
  assert.ok(firstYes !== undefined && secondYes !== undefined);
  assert.equal(firstYes.contentHash, secondYes.contentHash, 'fixture units expected to be byte-identical');
  assert.equal(firstYes.occurrenceIndex, 0);
  assert.equal(secondYes.occurrenceIndex, 1);

  // Account for occurrence 0 only; occurrence 1 must still be flagged despite
  // sharing the same contentHash -- identity is (hash, occurrence), not hash alone.
  const grounding: GroundingRecord[] = [
    {
      edition_unit: { hash: `sha256:${firstYes.contentHash}`, occurrence: 0 },
      basis: 'framing',
    },
  ];

  const result = checkEditionGrounding(baseComposeLedger(grounding), editionUnits, sourceUnits);

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0] ?? '', new RegExp(`sha256:${secondYes.contentHash}, occurrence 1`));
});

test('checkEditionGrounding: mode revise is a no-op (not applicable), regardless of grounding', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(EDITION_TEXT, EDITION_IDENTITY);

  const reviseLedger: CoverageLedger = {
    version: 1,
    source: { identity: SOURCE_IDENTITY, hash: 'sha256:' + 'a'.repeat(64) },
    voice: { identity: 'test-voice', hash: 'sha256:' + 'b'.repeat(64) },
    mode: 'revise',
    coverage: [],
  };

  const result = checkEditionGrounding(reviseLedger, editionUnits, sourceUnits);

  assert.equal(result.applicable, false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('checkEditionGrounding: an absent mode defaults to revise (no-op) safely', () => {
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(EDITION_TEXT, EDITION_IDENTITY);

  const noModeLedger: CoverageLedger = {
    version: 1,
    source: { identity: SOURCE_IDENTITY, hash: 'sha256:' + 'a'.repeat(64) },
    voice: { identity: 'test-voice', hash: 'sha256:' + 'b'.repeat(64) },
    coverage: [],
  };

  const result = checkEditionGrounding(noModeLedger, editionUnits, sourceUnits);

  assert.equal(result.applicable, false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

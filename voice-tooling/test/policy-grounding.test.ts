// T009 (RED-first): adversarial tests for the shared, pure edition-side
// grounding accounting policy (spec 006, contracts/voice-compose-cli.md
// Refusals, data-model.md "Edition-side grounding accounting", R8).
//
// checkGrounding is imported by BOTH the producer preflight and the fidelity
// validator (R8). It enforces the reverse-accounting: EXHAUSTIVE (every edition
// unit has exactly one record), EXCLUSIVE (no duplicate, no dangling record),
// and grounded-beat resolution (a `grounded` record's beats each name a real
// source unit). It does NOT judge semantic support. It returns named
// structured failures (never throws for a policy violation).
//
// Covers:
// - an edition unit with NO grounding record -> unaccounted, naming the unit.
// - an edition unit with TWO records -> duplicate, naming the unit.
// - a record naming an edition unit absent from the derived edition -> dangling record.
// - a `grounded` record whose beat names a nonexistent source unit -> dangling beat.
// - a fully-accounted edition -> pass.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkGrounding } from '@/policy/grounding.ts';
import type { GroundingRecord, UnitRef } from '@/schema/ledger.ts';

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

const SOURCE = ['Beta cites [^b] and counts 1978.', '', 'Gamma one with 42.', ''].join('\n');
const EDITION = ['Composed opening paragraph.', '', 'Composed closing paragraph.', ''].join('\n');

test('checkGrounding: a fully-accounted edition passes', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && e0 && e1);

  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] },
    { edition_unit: ref(e1), basis: 'connective' },
  ];

  const result = checkGrounding(records, ed, src);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkGrounding: an edition unit with no record is unaccounted, naming the unit', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && e0 && e1);

  // Only e0 is grounded; e1 has no record.
  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] }];

  const result = checkGrounding(records, ed, src);

  assert.equal(result.ok, false);
  const unaccounted = result.failures.filter((f) => f.kind === 'unaccounted');
  assert.equal(unaccounted.length, 1);
  assert.match(unaccounted[0]?.message ?? '', /has no grounding record/);
  assert.match(unaccounted[0]?.message ?? '', new RegExp(e1.contentHash));
});

test('checkGrounding: an edition unit with two records is a duplicate, naming the unit', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && e0 && e1);

  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] },
    { edition_unit: ref(e0), basis: 'connective' }, // duplicate for e0
    { edition_unit: ref(e1), basis: 'connective' },
  ];

  const result = checkGrounding(records, ed, src);

  assert.equal(result.ok, false);
  const duplicate = result.failures.filter((f) => f.kind === 'duplicate');
  assert.equal(duplicate.length, 1);
  assert.match(duplicate[0]?.message ?? '', /has 2 records/);
  assert.match(duplicate[0]?.message ?? '', new RegExp(e0.contentHash));
});

test('checkGrounding: a record naming an edition unit absent from the edition is a dangling record', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && e0 && e1);

  const bogus: UnitRef = { hash: `sha256:${'d'.repeat(64)}`, occurrence: 0 };
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] },
    { edition_unit: ref(e1), basis: 'connective' },
    { edition_unit: bogus, basis: 'framing' }, // names no real edition unit
  ];

  const result = checkGrounding(records, ed, src);

  assert.equal(result.ok, false);
  const dangling = result.failures.filter((f) => f.kind === 'dangling-record');
  assert.equal(dangling.length, 1);
  assert.match(dangling[0]?.message ?? '', /unknown edition unit/);
  assert.match(dangling[0]?.message ?? '', new RegExp('d'.repeat(64)));
});

test('checkGrounding: a grounded record whose beat names a nonexistent source unit is a dangling beat', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [e0, e1] = ed;
  assert.ok(e0 && e1);

  const bogusBeat: UnitRef = { hash: `sha256:${'c'.repeat(64)}`, occurrence: 0 };
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [bogusBeat] }, // beat does not exist
    { edition_unit: ref(e1), basis: 'connective' },
  ];

  const result = checkGrounding(records, ed, src);

  assert.equal(result.ok, false);
  const danglingBeat = result.failures.filter((f) => f.kind === 'dangling-beat');
  assert.equal(danglingBeat.length, 1);
  assert.match(danglingBeat[0]?.message ?? '', /unknown beat/);
  assert.match(danglingBeat[0]?.message ?? '', new RegExp('c'.repeat(64)));
});

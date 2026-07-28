// RED (T003): durable source-unit identity -- occurrence_index and unitId.
//
// `@/units/derive.ts` and `@/units/identity.ts` do not exist yet (T004
// implements them). This file is expected to fail to load with a "cannot
// find module" error until then -- the correct RED state for a test-first
// task.
//
// Covers (spec.md FR-010; design record D6.9, D6.10, D22 durable-identity
// discussion; data-model.md "Source unit" Validation rules):
//   - occurrence_index = 0-based index among units of the SAME source
//     sharing a content_hash, in document order (D6.9)
//   - reordering byte-identical blocks changes their occurrence_index
//     though content is unchanged (D6.10)
//   - two different sources containing byte-identical units keep distinct
//     durable identity -- source identity distinguishes them
//   - unitId is stable for identical inputs and differs when source
//     identity or occurrence_index differs

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import { unitId } from '@/units/identity.ts';
import { readFixture } from './support.ts';

test('deriveUnits: occurrence_index is the 0-based index among units of the same source sharing a content_hash, in document order (D6.9, FR-010)', () => {
  const text = readFixture('sources', 'repeated-blocks.md');
  const units = deriveUnits(text, 'src-repeat');

  assert.equal(units.length, 3);
  const [first, second, third] = units;
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);

  assert.equal(first.content, 'Repeat me.\n');
  assert.equal(first.occurrenceIndex, 0);

  assert.equal(second.content, 'Different content.\n');
  assert.equal(second.occurrenceIndex, 0);

  assert.equal(third.content, 'Repeat me.\n');
  assert.equal(third.occurrenceIndex, 1);

  assert.equal(first.contentHash, third.contentHash);
});

test('deriveUnits: reordering byte-identical blocks changes their occurrence_index though content is unchanged (D6.10)', () => {
  // reorder-a.md:  Anchor before. / Repeat me. (occ 0) / Anchor after. / Repeat me. (occ 1)
  // reorder-b.md:  Anchor after.  / Repeat me. (occ 0) / Anchor before. / Repeat me. (occ 1)
  // The "Anchor before." / "Anchor after." pair is swapped wholesale between the
  // two documents, so the same content ("Repeat me.\n") that follows "Anchor
  // before." is occurrence 0 in reorder-a but occurrence 1 in reorder-b --
  // purely a consequence of document order, never of content.
  const a = readFixture('sources', 'reorder-a.md');
  const b = readFixture('sources', 'reorder-b.md');

  const unitsA = deriveUnits(a, 'src-reorder');
  const unitsB = deriveUnits(b, 'src-reorder');

  assert.equal(unitsA.length, 4);
  assert.equal(unitsB.length, 4);

  const repeatAfterAnchorBeforeInA = unitsA[1];
  const repeatAfterAnchorBeforeInB = unitsB[3];
  assert.ok(repeatAfterAnchorBeforeInA);
  assert.ok(repeatAfterAnchorBeforeInB);

  assert.equal(repeatAfterAnchorBeforeInA.content, 'Repeat me.\n');
  assert.equal(repeatAfterAnchorBeforeInB.content, 'Repeat me.\n');
  assert.equal(
    repeatAfterAnchorBeforeInA.contentHash,
    repeatAfterAnchorBeforeInB.contentHash,
  );
  assert.equal(repeatAfterAnchorBeforeInA.occurrenceIndex, 0);
  assert.equal(repeatAfterAnchorBeforeInB.occurrenceIndex, 1);
  assert.notEqual(
    repeatAfterAnchorBeforeInA.occurrenceIndex,
    repeatAfterAnchorBeforeInB.occurrenceIndex,
  );
});

test('unitId: two different sources containing byte-identical units keep distinct durable identity', () => {
  const text = readFixture('sources', 'basic-lf.md');
  const unitsA = deriveUnits(text, 'source-alpha');
  const unitsB = deriveUnits(text, 'source-beta');

  const [unitA] = unitsA;
  const [unitB] = unitsB;
  assert.ok(unitA);
  assert.ok(unitB);

  // Content, hash and occurrence_index are all identical between the two...
  assert.equal(unitA.content, unitB.content);
  assert.equal(unitA.contentHash, unitB.contentHash);
  assert.equal(unitA.occurrenceIndex, unitB.occurrenceIndex);

  // ...but durable identity must still distinguish them, because a content
  // hash alone does not bind a unit to a particular declared source.
  const idA = unitId('source-alpha', unitA);
  const idB = unitId('source-beta', unitB);
  assert.notEqual(
    idA,
    idB,
    'durable identity must distinguish units from different sources even when content_hash and occurrence_index match',
  );
});

test('unitId: stable for identical inputs, and differs when occurrence_index differs', () => {
  const text = readFixture('sources', 'repeated-blocks.md');
  const units = deriveUnits(text, 'source-gamma');
  const [first, , third] = units;
  assert.ok(first);
  assert.ok(third);

  assert.equal(first.contentHash, third.contentHash);
  assert.notEqual(first.occurrenceIndex, third.occurrenceIndex);

  const idFirst = unitId('source-gamma', first);
  const idFirstAgain = unitId('source-gamma', first);
  assert.equal(idFirst, idFirstAgain, 'unitId must be stable/deterministic for the same inputs');

  const idThird = unitId('source-gamma', third);
  assert.notEqual(idFirst, idThird, 'differing occurrence_index must yield a different id');
});

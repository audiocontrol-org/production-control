// RED (T003): edition-side FR-011 invariant.
//
// `@/units/derive.ts` and `@/units/identity.ts` do not exist yet (T004
// implements them). This file is expected to fail to load with a "cannot
// find module" error until then -- the correct RED state for a test-first
// task.
//
// Covers (spec.md FR-011; design record D7):
//   deriveUnits applied to an EDITION file strips its leading frontmatter
//   (where the coverage ledger lives) FIRST, so mutating ONLY the
//   frontmatter block leaves every derived unit's content_hash and
//   occurrence_index -- and therefore its durable id -- UNCHANGED.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import { unitId } from '@/units/identity.ts';
import { readFixture } from './support.ts';

test('sanity: the two edition fixtures actually carry different frontmatter ledgers (guards against a no-op fixture)', () => {
  const editionA = readFixture('editions', 'edition-ledger-a.md');
  const editionB = readFixture('editions', 'edition-ledger-b.md');

  assert.notEqual(editionA, editionB);
});

test('deriveUnits (edition, FR-011): mutating ONLY the frontmatter coverage ledger leaves every derived unit content_hash and occurrence_index unchanged (D7)', () => {
  const editionA = readFixture('editions', 'edition-ledger-a.md');
  const editionB = readFixture('editions', 'edition-ledger-b.md');

  const unitsA = deriveUnits(editionA, 'edition-ch01');
  const unitsB = deriveUnits(editionB, 'edition-ch01');

  assert.equal(unitsA.length, unitsB.length);
  assert.ok(unitsA.length > 0, 'fixture must actually yield derivable units');

  for (let i = 0; i < unitsA.length; i += 1) {
    const unitA = unitsA[i];
    const unitB = unitsB[i];
    assert.ok(unitA);
    assert.ok(unitB);

    assert.equal(
      unitA.content,
      unitB.content,
      `unit ${i} content must be unaffected by a frontmatter-only ledger change`,
    );
    assert.equal(
      unitA.contentHash,
      unitB.contentHash,
      `unit ${i} content_hash must be unaffected by a frontmatter-only ledger change`,
    );
    assert.equal(
      unitA.occurrenceIndex,
      unitB.occurrenceIndex,
      `unit ${i} occurrence_index must be unaffected by a frontmatter-only ledger change`,
    );
    assert.equal(
      unitId('edition-ch01', unitA),
      unitId('edition-ch01', unitB),
      `unit ${i} durable id must be identical across a frontmatter-only ledger mutation`,
    );
  }
});

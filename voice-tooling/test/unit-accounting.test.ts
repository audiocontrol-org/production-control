// T012: unit tests for the `unit_accounting` fidelity check (contract step 3,
// FR-017, SC-001, data-model.md "Structural validity rules").
//
// Covers:
// - a ledger accounting for every derived source unit exactly once -> ok,
//   with the correct `total`.
// - a ledger omitting one unit's entry -> failure naming that unit.
// - a ledger entry referencing a non-existent source unit -> "unknown source
//   unit" failure.
// - the `sha256:`-prefix normalization: a ledger entry's `sha256:<hash>` form
//   matches a derived unit whose `contentHash` is the bare `<hash>`.
//
// `@/fidelity/run.ts` (T016) is NOT exercised here -- this only tests
// `checkUnitAccounting` in isolation, fed pre-derived source units.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import { checkUnitAccounting } from '@/fidelity/check-unit-accounting.ts';
import type { CoverageEntry, CoverageLedger } from '@/schema/ledger.ts';

const SOURCE_IDENTITY = 'test-source';
const SOURCE_TEXT = 'Alpha line.\n\nBeta line.\n\nGamma line.\n';

function baseLedger(coverage: CoverageEntry[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: SOURCE_IDENTITY, hash: 'sha256:' + 'a'.repeat(64) },
    voice: { identity: 'test-voice', hash: 'sha256:' + 'b'.repeat(64) },
    coverage,
  };
}

test('checkUnitAccounting: every derived unit accounted for exactly once is ok, with correct total', () => {
  const units = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  assert.equal(units.length, 3, 'fixture expected to derive exactly 3 units');

  const coverage: CoverageEntry[] = units.map((unit) => ({
    source_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    op: 'cut',
    reason: 'not needed for this fixture',
  }));

  const result = checkUnitAccounting(units, baseLedger(coverage));

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.total, 3);
});

test('checkUnitAccounting: a missing entry for one unit fails, naming that unit', () => {
  const units = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const [first, , third] = units;
  assert.ok(first !== undefined && third !== undefined);

  // Omit the middle unit's ("Beta line.") entry entirely.
  const coverage: CoverageEntry[] = [first, third].map((unit) => ({
    source_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    op: 'cut',
    reason: 'not needed for this fixture',
  }));

  const result = checkUnitAccounting(units, baseLedger(coverage));

  assert.equal(result.ok, false);
  assert.equal(result.total, 3);
  assert.equal(result.failures.length, 1);
  const middle = units[1];
  assert.ok(middle !== undefined);
  assert.equal(
    result.failures[0],
    `unit accounting: source unit (hash sha256:${middle.contentHash}, occurrence ${middle.occurrenceIndex}) has no ledger entry`,
  );
});

test('checkUnitAccounting: an entry referencing a non-existent source unit fails as "unknown source unit"', () => {
  const units = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);

  const coverage: CoverageEntry[] = units.map((unit) => ({
    source_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    op: 'cut',
    reason: 'not needed for this fixture',
  }));

  const bogusHash = 'f'.repeat(64);
  coverage.push({
    source_unit: { hash: `sha256:${bogusHash}`, occurrence: 0 },
    op: 'cut',
    reason: 'references a unit that does not exist',
  });

  const result = checkUnitAccounting(units, baseLedger(coverage));

  assert.equal(result.ok, false);
  assert.equal(result.total, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(
    result.failures[0],
    `unit accounting: ledger entry references unknown source unit (hash sha256:${bogusHash}, occurrence 0)`,
  );
});

test('checkUnitAccounting: sha256:-prefix normalization matches a derived unit\'s bare-hex contentHash', () => {
  const units = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const [first] = units;
  assert.ok(first !== undefined);

  // Ledger entries use the sha256:-prefixed form; deriveUnits' contentHash is
  // bare hex. These must be recognized as the SAME unit.
  const coverage: CoverageEntry[] = units.map((unit) => ({
    source_unit: { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex },
    op: 'cut',
    reason: 'not needed for this fixture',
  }));

  const result = checkUnitAccounting(units, baseLedger(coverage));

  assert.equal(result.ok, true, `expected normalization to match; got failures: ${result.failures.join(', ')}`);
  assert.equal(result.total, 3);
});

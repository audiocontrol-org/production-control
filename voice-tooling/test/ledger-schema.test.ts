// RED (T005): carrier-independent coverage-ledger schema + single loader.
//
// `@/schema/ledger.ts` does not exist yet when this file is first written --
// the correct RED state for a test-first task. Covers spec.md FR-012..FR-016
// and data-model.md "Coverage ledger" / "CoverageEntry" / "The closed
// operation set" / "Structural validity rules" / "Additive extensibility",
// per contracts/coverage-ledger-schema.md.
//
// Scope boundary: this suite exercises ONLY what `loadLedger` can determine
// from the ledger's own bytes (D20). "Every source unit has exactly one
// entry" (unit accounting against the derived source), "unknown unit"
// (a source_unit absent from the actual source), `source.hash` matching a
// supplied source, and payload survival are fidelity-validator concerns
// (T011/T012), not this loader's.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { loadLedger } from '@/schema/ledger.ts';

/** A minimal, structurally-valid ledger: one of each op, `merged` sharing a
 * destination with `represented` (per the contract's own worked example). */
const VALID_LEDGER = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
  - source_unit: { hash: sha256:u2, occurrence: 0 }
    op: represented
    treatment: compressed
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
  - source_unit: { hash: sha256:u3, occurrence: 0 }
    op: merged
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
  - source_unit: { hash: sha256:u4, occurrence: 0 }
    op: cut
    reason: "restates the death count carried by the preceding unit"
`;

test('loadLedger: a clean valid ledger loads and round-trips its fields', () => {
  const ledger = loadLedger(VALID_LEDGER);

  assert.equal(ledger.version, 1);
  assert.deepEqual(ledger.source, { identity: 'src-1', hash: 'sha256:aaa1' });
  assert.deepEqual(ledger.voice, { identity: 'voice-1', hash: 'sha256:bbb1' });
  assert.equal(ledger.coverage.length, 4);

  const [verbatimEntry, representedEntry, mergedEntry, cutEntry] = ledger.coverage;
  assert.ok(verbatimEntry !== undefined);
  assert.ok(representedEntry !== undefined);
  assert.ok(mergedEntry !== undefined);
  assert.ok(cutEntry !== undefined);

  assert.equal(verbatimEntry.op, 'verbatim');
  assert.deepEqual(verbatimEntry.source_unit, { hash: 'sha256:u1', occurrence: 0 });
  assert.deepEqual(verbatimEntry.edition_units, [{ hash: 'sha256:u1', occurrence: 0 }]);
  assert.equal(verbatimEntry.reason, undefined);

  assert.equal(representedEntry.op, 'represented');
  assert.equal(representedEntry.treatment, 'compressed');
  assert.deepEqual(representedEntry.edition_units, [{ hash: 'sha256:e1', occurrence: 0 }]);

  assert.equal(mergedEntry.op, 'merged');
  assert.deepEqual(mergedEntry.edition_units, [{ hash: 'sha256:e1', occurrence: 0 }]);

  assert.equal(cutEntry.op, 'cut');
  assert.equal(cutEntry.reason, 'restates the death count carried by the preceding unit');
  assert.equal(cutEntry.edition_units, undefined);
});

test('loadLedger: refuses an absent version, naming the missing field', () => {
  const yamlText = `
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /version/i);
});

test('loadLedger: refuses an unknown version literal', () => {
  const yamlText = `
version: 2
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /version must be the literal 1/);
});

test('loadLedger: refuses a missing source.identity, naming the field', () => {
  const yamlText = `
version: 1
source: { hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /missing required field: source\.identity/);
});

test('loadLedger: refuses a missing source.hash, naming the field', () => {
  const yamlText = `
version: 1
source: { identity: src-1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /missing required field: source\.hash/);
});

test('loadLedger: refuses a missing voice.identity, naming the field', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { hash: sha256:bbb1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /missing required field: voice\.identity/);
});

test('loadLedger: refuses a missing voice.hash, naming the field', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1 }
coverage: []
`;
  assert.throws(() => loadLedger(yamlText), /missing required field: voice\.hash/);
});

test('loadLedger: refuses an entirely missing coverage field, naming it', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
`;
  assert.throws(() => loadLedger(yamlText), /missing required field: coverage/);
});

test('loadLedger: refuses an op outside the closed set', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: rewritten
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /coverage\[0\]\.op must be one of verbatim, represented, merged, cut/);
});

test('loadLedger: refuses a cut entry carrying a destination', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: cut
    reason: "explained"
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /op 'cut' must not carry edition_units/);
});

test('loadLedger: refuses a cut entry with an absent reason', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: cut
`;
  assert.throws(() => loadLedger(yamlText), /op 'cut' requires a non-empty reason/);
});

test('loadLedger: refuses a cut entry with a whitespace-only reason', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: cut
    reason: "   "
`;
  assert.throws(() => loadLedger(yamlText), /op 'cut' requires a non-empty reason/);
});

test('loadLedger: refuses a non-cut entry carrying a reason', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    reason: "should not be here"
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
`;
  assert.throws(
    () => loadLedger(yamlText),
    /op 'represented' must not carry a reason/,
  );
});

test('loadLedger: refuses a non-cut entry with absent edition_units', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
`;
  assert.throws(
    () => loadLedger(yamlText),
    /op 'represented' requires at least one edition_units entry/,
  );
});

test('loadLedger: refuses a non-cut entry with an empty edition_units list', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: merged
    edition_units: []
`;
  assert.throws(
    () => loadLedger(yamlText),
    /op 'merged' requires at least one edition_units entry/,
  );
});

test('loadLedger: refuses a verbatim entry with more than one destination', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:e1, occurrence: 0 }, { hash: sha256:e2, occurrence: 0 } ]
`;
  assert.throws(
    () => loadLedger(yamlText),
    /op 'verbatim' requires exactly one edition_units entry \(got 2\)/,
  );
});

test('loadLedger: refuses two entries declaring a disposition for the same source_unit', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: cut
    reason: "duplicate on purpose"
`;
  assert.throws(() => loadLedger(yamlText), /duplicate disposition/);
});

test('loadLedger: refuses a merged entry sharing no destination with any other entry', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: merged
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /merged with no shared destination/);
});

test('loadLedger: accepts an entry carrying an unknown extra key (additive extensibility, D21)', () => {
  const yamlText = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
    function: dialogue
`;
  const ledger = loadLedger(yamlText);
  assert.equal(ledger.coverage.length, 1);
  const [entry] = ledger.coverage;
  assert.ok(entry !== undefined);
  assert.equal(entry['function'], 'dialogue');
});

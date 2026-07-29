// RED (T006): coverage-ledger `mode` stamp + `grounding` records.
//
// Extends `@/schema/ledger.ts` (T005) on its additive-extensibility seam
// (D21) per specs/006-voice-compose-from-spine/contracts/coverage-ledger-additions.md
// and data-model.md "Mode" / "GroundingRecord" / "CoverageLedger (EXTENDED)".
//
// Scope boundary: this suite exercises ONLY what `loadLedger` can determine
// from the ledger's own bytes (D20) — mode enum + default, grounding
// presence/absence per mode, and each GroundingRecord's structural shape.
// Edition-side accounting (exhaustive/exclusive, beats resolving to real
// derived units) is a fidelity-validator concern (check-edition-grounding.ts),
// not this loader's.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { loadLedger } from '@/schema/ledger.ts';

const BASE_HEADER = `
version: 1
source: { identity: src-1, hash: sha256:aaa1 }
voice: { identity: voice-1, hash: sha256:bbb1 }
`;

test('loadLedger: a pre-006 ledger (no mode, no grounding) loads and defaults mode to revise', () => {
  const yamlText = `${BASE_HEADER}
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  const ledger = loadLedger(yamlText);
  assert.equal(ledger.mode, 'revise');
  assert.equal(ledger.grounding, undefined);
});

test('loadLedger: mode: compose with a non-empty valid grounding array loads', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: grounded
    beats: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  const ledger = loadLedger(yamlText);
  assert.equal(ledger.mode, 'compose');
  assert.deepEqual(ledger.grounding, [
    {
      edition_unit: { hash: 'sha256:e1', occurrence: 0 },
      basis: 'grounded',
      beats: [{ hash: 'sha256:u1', occurrence: 0 }],
    },
  ]);
});

test('loadLedger: mode: compose with a MISSING grounding field is rejected', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /grounding/i);
});

test('loadLedger: mode: compose with an EMPTY grounding list is rejected', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding: []
`;
  assert.throws(() => loadLedger(yamlText), /grounding/i);
});

test('loadLedger: mode: revise carrying grounding is rejected (v1: revise must have grounding absent)', () => {
  const yamlText = `${BASE_HEADER}
mode: revise
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:u1, occurrence: 0 }
    basis: grounded
    beats: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /grounding/i);
});

test('loadLedger: refuses a grounding record with a bad basis enum, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: invented
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.basis/);
});

test('loadLedger: refuses a grounded-basis record with missing beats, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: grounded
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.beats/);
});

test('loadLedger: refuses a grounded-basis record with an empty beats list, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: grounded
    beats: []
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.beats/);
});

test('loadLedger: refuses a connective-basis record that wrongly carries beats, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: connective
    beats: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.beats/);
});

test('loadLedger: refuses a framing-basis record that wrongly carries beats, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: framing
    beats: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.beats/);
});

test('loadLedger: refuses a grounding record whose edition_unit is not a valid UnitRef, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1 }
    basis: framing
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.edition_unit\.occurrence/);
});

test('loadLedger: refuses a grounding record whose beats entry is not a valid UnitRef, naming the index/field', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: grounded
    beats: [ { hash: sha256:u1 } ]
`;
  assert.throws(() => loadLedger(yamlText), /grounding\[0\]\.beats\[0\]\.occurrence/);
});

test('loadLedger: refuses mode present but not compose|revise', () => {
  const yamlText = `${BASE_HEADER}
mode: rewrite
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
`;
  assert.throws(() => loadLedger(yamlText), /mode must be one of compose, revise/);
});

test('loadLedger: a compose ledger passes through an unrelated top-level key (additive extensibility, D21)', () => {
  const yamlText = `${BASE_HEADER}
mode: compose
coverage:
  - source_unit: { hash: sha256:u1, occurrence: 0 }
    op: represented
    edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
grounding:
  - edition_unit: { hash: sha256:e1, occurrence: 0 }
    basis: framing
notes: some-future-field
`;
  const ledger = loadLedger(yamlText);
  assert.equal(ledger['notes'], 'some-future-field');
});

// T013: adversarial unit tests for the per-op mechanical obligation
// (contract step 4, data-model.md "closed operation set" table, D8/D12/D22,
// FR-012/013/017/018/022).
//
// Covers:
// - a FAITHFUL set (verbatim byte-equal; represented payload surviving; two
//   merged entries sharing a destination; a cut) -> ok, with correct opCounts,
//   payloadChecked, uncorroboratedUnits, lexiconApplicable.
// - a verbatim whose destination differs by ONE byte -> failure naming it.
// - a represented where a source citation is DROPPED from the destination
//   union -> failure naming the missing payload.
// - a represented whose source yields NO payload -> ok, contributing to
//   uncorroboratedUnits (D12/FR-022 report-only).
// - a merged NOT sharing a destination (ledger built directly to exercise the
//   defensive branch loadLedger would otherwise reject) -> failure.
// - an edition_units ref that resolves to nothing -> failure.
// - a D22 corroborate-not-infer case: a represented entry whose declared
//   destination is "elsewhere-placed" but carries the payload -> ok (the
//   validator corroborates the DECLARED mapping, never infers a better one).
//
// `@/fidelity/run.ts` (T016) is NOT exercised here -- this tests
// `checkOpObligations` in isolation, fed pre-derived source/edition units.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import type { CoverageEntry, CoverageLedger, UnitRef } from '@/schema/ledger.ts';

const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;

// A faithful 6-unit source: verbatim, represented (payload), two merged
// (each carrying part of the shared destination's payload), represented
// (payload), and a cut. Blank lines separate units; letter citations avoid
// digits so numeric extraction stays clean.
const FAITHFUL_SOURCE = [
  'Alpha verbatim line [^a].',
  '',
  'Beta cites [^b] and counts 1978.',
  '> quoted span one',
  '',
  'Gamma one with 42.',
  '',
  'Gamma two cites [^c].',
  '',
  'Delta prose with [^d].',
  '',
  'Epsilon cut line.',
  '',
].join('\n');

const FAITHFUL_EDITION = [
  'Alpha verbatim line [^a].',
  '',
  'Rewritten beta citing [^b] with 1978.',
  '> quoted span one',
  '',
  'Merged gamma line with 42 and [^c].',
  '',
  'Delta rewritten citing [^d].',
  '',
].join('\n');

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function ledgerOf(coverage: CoverageEntry[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: 'test-source', hash: PLACEHOLDER_HASH },
    voice: { identity: 'test-voice', hash: PLACEHOLDER_HASH },
    coverage,
  };
}

/**
 * Build the faithful 6-entry ledger for a given source/edition unit layout
 * (6 source units, 4 edition units). Tests that mutate the edition reuse this
 * so only the intended mutation differs.
 */
function faithfulLedger(src: SourceUnit[], ed: SourceUnit[]): CoverageLedger {
  const [s0, s1, s2, s3, s4, s5] = src;
  const [e0, e1, e2, e3] = ed;
  assert.ok(s0 && s1 && s2 && s3 && s4 && s5, 'expected 6 source units');
  assert.ok(e0 && e1 && e2 && e3, 'expected 4 edition units');
  return ledgerOf([
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
    { source_unit: ref(s2), op: 'merged', edition_units: [ref(e2)] },
    { source_unit: ref(s3), op: 'merged', edition_units: [ref(e2)] },
    { source_unit: ref(s4), op: 'represented', edition_units: [ref(e3)] },
    { source_unit: ref(s5), op: 'cut', reason: 'not carried into the edition' },
  ]);
}

test('checkOpObligations: a faithful set is ok with correct counts', () => {
  const src = deriveUnits(FAITHFUL_SOURCE, 'src');
  const ed = deriveUnits(FAITHFUL_EDITION, 'ed');
  assert.equal(src.length, 6);
  assert.equal(ed.length, 4);

  const result = checkOpObligations(faithfulLedger(src, ed), src, ed);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.opCounts, { verbatim: 1, represented: 2, merged: 2, cut: 1 });
  assert.deepEqual(result.payloadChecked, {
    quotes: 1,
    citations: 4,
    numerics: 2,
    lexiconTerms: 0,
  });
  assert.equal(result.uncorroboratedUnits, 0);
  assert.equal(result.lexiconApplicable, false);
});

test('checkOpObligations: a lexicon makes lexiconApplicable true', () => {
  const src = deriveUnits(FAITHFUL_SOURCE, 'src');
  const ed = deriveUnits(FAITHFUL_EDITION, 'ed');
  const result = checkOpObligations(faithfulLedger(src, ed), src, ed, ['Gamma']);
  assert.equal(result.lexiconApplicable, true);
});

test('checkOpObligations: a verbatim destination off by one byte fails, naming it', () => {
  const src = deriveUnits(FAITHFUL_SOURCE, 'src');
  // Same layout, but the verbatim destination E0 differs by exactly one byte
  // ("." -> "!").
  const badEdition = FAITHFUL_EDITION.replace(
    'Alpha verbatim line [^a].',
    'Alpha verbatim line [^a]!',
  );
  const ed = deriveUnits(badEdition, 'ed');

  const result = checkOpObligations(faithfulLedger(src, ed), src, ed);

  assert.equal(result.ok, false);
  const s0 = src[0];
  assert.ok(s0);
  assert.deepEqual(result.failures, [
    `op obligation: entry for source unit (sha256:${s0.contentHash}, occurrence 0), op=verbatim: destination bytes differ from source unit bytes`,
  ]);
});

test('checkOpObligations: a represented entry whose source citation is dropped fails, naming the payload', () => {
  const src = deriveUnits(FAITHFUL_SOURCE, 'src');
  // Drop the [^b] citation from the represented destination E1; quote and
  // numeric are preserved, so exactly one shortfall.
  const droppedEdition = FAITHFUL_EDITION.replace(
    'Rewritten beta citing [^b] with 1978.',
    'Rewritten beta citing with 1978.',
  );
  const ed = deriveUnits(droppedEdition, 'ed');

  const result = checkOpObligations(faithfulLedger(src, ed), src, ed);

  assert.equal(result.ok, false);
  const s1 = src[1];
  assert.ok(s1);
  assert.deepEqual(result.failures, [
    `op obligation: entry for source unit (sha256:${s1.contentHash}, occurrence 0), op=represented: citation [^b] does not survive into declared destinations`,
  ]);
});

test('checkOpObligations: a represented whose source yields no payload passes but is uncorroborated', () => {
  const src = deriveUnits('Plain prose line with no literals.\n', 'src');
  const ed = deriveUnits('Rewritten plainly, still no literals.\n', 'ed');
  const s0 = src[0];
  const e0 = ed[0];
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.equal(result.uncorroboratedUnits, 1);
  assert.deepEqual(result.payloadChecked, {
    quotes: 0,
    citations: 0,
    numerics: 0,
    lexiconTerms: 0,
  });
  assert.deepEqual(result.opCounts, { verbatim: 0, represented: 1, merged: 0, cut: 0 });
});

test('checkOpObligations: a merged sharing no destination fails (defensive branch)', () => {
  const src = deriveUnits('Gamma solo with 42.\n', 'src');
  const ed = deriveUnits('Merged solo line with 42.\n', 'ed');
  const s0 = src[0];
  const e0 = ed[0];
  assert.ok(s0 && e0);

  // Constructed directly: loadLedger would reject a lone merged with no shared
  // destination, so we build the ledger object to exercise the defensive
  // re-affirmation. The payload (42) survives, so the ONLY failure is the
  // shared-destination one.
  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'merged', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    `op obligation: op=merged entry for (sha256:${s0.contentHash}, occurrence 0) shares no destination with another entry`,
  ]);
});

test('checkOpObligations: a destination ref that resolves to nothing fails', () => {
  const src = deriveUnits('Beta cites [^z] here.\n', 'src');
  const ed = deriveUnits('An edition with unrelated content.\n', 'ed');
  const s0 = src[0];
  assert.ok(s0);

  const bogus: UnitRef = { hash: `sha256:${'e'.repeat(64)}`, occurrence: 0 };
  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [bogus] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    `op obligation: entry for source unit (sha256:${s0.contentHash}, occurrence 0), op=represented: declared destination (sha256:${'e'.repeat(64)}, occurrence 0) not found in edition`,
  ]);
});

test('checkOpObligations: a source unit ref that resolves to nothing fails', () => {
  const src = deriveUnits('Beta cites [^z] here.\n', 'src');
  const ed = deriveUnits('Rewritten beta citing [^z].\n', 'ed');
  const e0 = ed[0];
  assert.ok(e0);

  const bogusSource: UnitRef = { hash: `sha256:${'f'.repeat(64)}`, occurrence: 0 };
  const result = checkOpObligations(
    ledgerOf([{ source_unit: bogusSource, op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    `op obligation: entry source unit (sha256:${'f'.repeat(64)}, occurrence 0) not found`,
  ]);
});

test('checkOpObligations: D22 corroborates the DECLARED destination even when elsewhere-placed', () => {
  // The source payload survives in a LATER edition unit; a decoy unit sits
  // first. The ledger declares the later unit as the destination. An inferring
  // validator that positionally aligned unit 0 -> unit 0 would fail on the
  // decoy; a corroborating one checks the DECLARED destination and passes.
  const src = deriveUnits('Beta cites [^b] and counts 1978.\n', 'src');
  const edition = [
    'A decoy first paragraph with no shared literals.',
    '',
    'A later paragraph citing [^b] with 1978.',
    '',
  ].join('\n');
  const ed = deriveUnits(edition, 'ed');
  const s0 = src[0];
  const decoy = ed[0];
  const carrier = ed[1];
  assert.ok(s0 && decoy && carrier);
  assert.notEqual(decoy.contentHash, carrier.contentHash);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [ref(carrier)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

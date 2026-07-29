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
  // AUDIT-20260726-08: this fixture uses LETTER-labeled citations ([^a]..[^d],
  // no digits), so the citation-marker-digit exclusion added to extractPayload
  // does not change its numeric count -- the two numerics are the genuine prose
  // numerals "1978" (Beta unit) and "42" (Gamma-one unit), neither from a
  // citation marker. The corrected count is therefore 2, unchanged.
  assert.deepEqual(result.payloadChecked, {
    quotes: 1,
    citations: 4,
    numerics: 2,
    lexiconTerms: 0,
    openQuestionMarkers: 0,
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
  assert.deepEqual(result.failures.map((f) => f.message), [
    `op obligation: entry for source unit (sha256:${s0.contentHash}, occurrence 0), op=verbatim: destination bytes differ from source unit bytes`,
  ]);
  // AUDIT-20260726-23: the failure carries a STRUCTURED kind (not a prose regex).
  assert.deepEqual(result.failures.map((f) => f.kind), ['verbatim']);
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
  assert.deepEqual(result.failures.map((f) => f.message), [
    `op obligation: entry for source unit (sha256:${s1.contentHash}, occurrence 0), op=represented: citation [^b] does not survive into declared destinations`,
  ]);
  // AUDIT-20260726-23: a citation shortfall is kind 'citation', regardless of
  // any word inside the interpolated marker text.
  assert.deepEqual(result.failures.map((f) => f.kind), ['citation']);
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
    openQuestionMarkers: 0,
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
  assert.deepEqual(result.failures.map((f) => f.message), [
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
  assert.deepEqual(result.failures.map((f) => f.message), [
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
  assert.deepEqual(result.failures.map((f) => f.message), [
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

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('AUDIT-20260726-17 (FIX 1): two merged entries sharing ONE destination cannot both discharge a single destination occurrence', () => {
  // Two source units, each carrying the numeral "1978" once, BOTH merged into
  // a single shared destination. Pre-fix, each entry was checked against its
  // own rebuilt copy of the destination union, so ONE destination "1978" could
  // discharge BOTH source obligations -- a cross-unit false-clean. Post-fix the
  // shared supply is consumed once across the group.
  const src = deriveUnits('First merged unit counts 1978.\n\nSecond merged unit counts 1978.\n', 'src');
  const [s0, s1] = src;
  assert.ok(s0 && s1, 'expected 2 source units');

  // Destination contains "1978" only ONCE -> a shortfall for the second entry.
  const edOnce = deriveUnits('The merged edition line records 1978.\n', 'edOnce');
  const [dOnce] = edOnce;
  assert.ok(dOnce);
  const resultOnce = checkOpObligations(
    ledgerOf([
      { source_unit: ref(s0), op: 'merged', edition_units: [ref(dOnce)] },
      { source_unit: ref(s1), op: 'merged', edition_units: [ref(dOnce)] },
    ]),
    src,
    edOnce,
  );
  assert.equal(
    resultOnce.ok,
    false,
    `a single shared "1978" must not discharge both merged obligations; got: ${resultOnce.failures.map((f) => f.message).join(' | ')}`,
  );
  const numericShortfalls = resultOnce.failures.filter((f) => f.kind === 'numeric');
  assert.equal(numericShortfalls.length, 1, 'exactly one numeric obligation goes unmet');
  const shortfall = numericShortfalls[0];
  assert.ok(shortfall);
  // Per-source attribution: the SECOND source unit's obligation is the unmet one.
  assert.equal(
    shortfall.message,
    `op obligation: entry for source unit (sha256:${s1.contentHash}, occurrence 0), op=merged: numeric 1978 does not survive into declared destinations`,
  );

  // Same layout, but the destination now carries "1978" TWICE -> enough supply
  // for both source obligations, so the shared group survives.
  const edTwice = deriveUnits('The merged edition line records 1978 and again 1978.\n', 'edTwice');
  const [dTwice] = edTwice;
  assert.ok(dTwice);
  const resultTwice = checkOpObligations(
    ledgerOf([
      { source_unit: ref(s0), op: 'merged', edition_units: [ref(dTwice)] },
      { source_unit: ref(s1), op: 'merged', edition_units: [ref(dTwice)] },
    ]),
    src,
    edTwice,
  );
  assert.equal(
    resultTwice.ok,
    true,
    `two destination "1978" occurrences discharge both obligations; got: ${resultTwice.failures.map((f) => f.message).join(' | ')}`,
  );
});

test('AUDIT-20260727-03: a verbatim destination cannot doubly-corroborate a represented entry sharing it', () => {
  // verbatim S_A -> D (byte-equal), represented S_B -> D. Both declare D, so
  // they land in ONE component whose shared supply is D's payload. Pre-fix the
  // verbatim entry DONATED D's payload to the pool but never consumed it (it is
  // checked by byte-equality), so S_B could be discharged by the verbatim copy's
  // bytes -- S_B's OWN payload (here a numeric AND a citation) need never appear
  // anywhere else in the edition. Post-fix, verbatim SPENDS its destination's
  // payload first, so S_B has nothing to consume and its obligation fails.
  const src = deriveUnits(
    'The crew counted 1978 items and cited [^a].\n\nRecords note 1978 and cite [^a].\n',
    'src',
  );
  const [sA, sB] = src;
  assert.ok(sA && sB, 'expected 2 source units');

  // ONE edition unit, byte-identical to S_A. S_B's payload (1978, [^a]) does not
  // appear anywhere ELSE in the edition -- only inside the verbatim copy of S_A.
  const ed = deriveUnits('The crew counted 1978 items and cited [^a].\n', 'ed');
  const [d] = ed;
  assert.ok(d);
  assert.equal(d.content, sA.content, 'the edition unit must be byte-identical to the verbatim source');

  const result = checkOpObligations(
    ledgerOf([
      { source_unit: ref(sA), op: 'verbatim', edition_units: [ref(d)] },
      { source_unit: ref(sB), op: 'represented', edition_units: [ref(d)] },
    ]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    false,
    `S_B must not be discharged by the verbatim copy's bytes; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  // The verbatim entry itself passes byte-equality -- so every failure is S_B's,
  // and it spans MORE THAN ONE payload kind (numeric + citation).
  const kinds = new Set(result.failures.map((f) => f.kind));
  assert.equal(kinds.has('numeric'), true, 'S_B\'s numeric 1978 must not survive');
  assert.equal(kinds.has('citation'), true, 'S_B\'s citation [^a] must not survive');
  assert.equal(kinds.has('verbatim'), false, 'the verbatim entry is byte-equal and must not itself fail');
  for (const failure of result.failures) {
    assert.match(
      failure.message,
      new RegExp(`sha256:${sB.contentHash}`),
      `every shortfall must be attributed to S_B, not the verbatim entry; got: ${failure.message}`,
    );
  }
});

test('AUDIT-20260728-04: an entry is corroborated ONLY by its OWN declared destinations, never a sibling\'s in the same shared-destination group', () => {
  // S_A declares [E_shared, E_x]; S_B declares [E_shared] ONLY. S_B's payload
  // ("1978") is present in E_x -- a destination S_B did NOT declare -- and absent
  // from E_shared. Pre-fix, the union-find component (S_A and S_B connected via
  // the shared E_shared) pooled BOTH destinations' payloads, so S_B's "1978" was
  // discharged by E_x though S_B never declared it: a cross-unit false-clean.
  // Post-fix, supply is per-destination-unit and S_B consumes only from its OWN
  // declared destinations (E_shared), where "1978" is absent -> a survival FAIL.
  const src = deriveUnits('Alpha counts 2001.\n\nBeta counts 1978.\n', 'src');
  const [sA, sB] = src;
  assert.ok(sA && sB, 'expected 2 source units');

  const ed = deriveUnits(
    'Shared destination prose with no literals.\n\nExtra destination records 2001 and 1978.\n',
    'ed',
  );
  const [eShared, eX] = ed;
  assert.ok(eShared && eX, 'expected 2 edition units');
  assert.notEqual(eShared.contentHash, eX.contentHash);

  const result = checkOpObligations(
    ledgerOf([
      { source_unit: ref(sA), op: 'represented', edition_units: [ref(eShared), ref(eX)] },
      { source_unit: ref(sB), op: 'represented', edition_units: [ref(eShared)] },
    ]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    false,
    `S_B must NOT be corroborated by E_x, a destination it never declared; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  const numericShortfalls = result.failures.filter((f) => f.kind === 'numeric');
  assert.equal(numericShortfalls.length, 1, 'exactly one numeric obligation (S_B\'s 1978) goes unmet');
  const shortfall = numericShortfalls[0];
  assert.ok(shortfall);
  assert.equal(
    shortfall.message,
    `op obligation: entry for source unit (sha256:${sB.contentHash}, occurrence 0), op=represented: numeric 1978 does not survive into declared destinations`,
  );
});

test('AUDIT-20260728-14: a destination named TWICE by one entry is ONE unit -- its payload once cannot satisfy the source\'s two occurrences', () => {
  // One entry declares edition_units [e0, e0] (the same destination unit named
  // twice) and its source carries "1978" TWICE, while e0 carries "1978" ONCE.
  // A destination named twice must contribute its supply ONCE (it is a single
  // unit), so the second source occurrence has nothing to consume -> a FAIL.
  const src = deriveUnits('Entry counts 1978 and again 1978.\n', 'src');
  const [s0] = src;
  assert.ok(s0);

  const ed = deriveUnits('Destination records 1978 once.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0), ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    false,
    `[e0, e0] must not double-count e0's single "1978"; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  const numericShortfalls = result.failures.filter((f) => f.kind === 'numeric');
  assert.equal(numericShortfalls.length, 1, 'exactly one numeric occurrence goes unmet');
  assert.equal(
    numericShortfalls[0]?.message,
    `op obligation: entry for source unit (sha256:${s0.contentHash}, occurrence 0), op=represented: numeric 1978 does not survive into declared destinations`,
  );
});

test('AUDIT-20260728-14: a destination named twice whose payload covers BOTH source occurrences survives', () => {
  // Companion to the FAIL case: when e0 genuinely carries "1978" TWICE, the two
  // source occurrences are both satisfied by e0's own supply -> PASS. Proves the
  // dedup is about not INVENTING supply, not about capping a unit's real payload.
  const src = deriveUnits('Entry counts 1978 and again 1978.\n', 'src');
  const [s0] = src;
  assert.ok(s0);

  const ed = deriveUnits('Destination records 1978 and also 1978.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0), ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    true,
    `e0's two genuine "1978" occurrences discharge both obligations; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
});

test('AUDIT-20260726-19 (FIX 4): a non-cut entry with zero declared destinations fails, naming the unit', () => {
  // loadLedger rejects an empty edition_units for a non-cut entry; construct the
  // checker input DIRECTLY to exercise the defensive guard. Without it, the
  // destination loop never runs and an empty union trivially "survives" -- a
  // producer could drop prose by labelling it `represented` with no destination.
  const src = deriveUnits('Some prose that would be silently dropped.\n', 'src');
  const ed = deriveUnits('Unrelated edition content.\n', 'ed');
  const [s0] = src;
  assert.ok(s0);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((f) => f.message), [
    `op obligation: entry for source unit (sha256:${s0.contentHash}, occurrence 0), op=represented: non-cut entry declares no destination`,
  ]);
  assert.deepEqual(result.failures.map((f) => f.kind), ['structural']);
});

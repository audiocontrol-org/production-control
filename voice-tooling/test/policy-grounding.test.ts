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
// - occurrence-sensitivity: two byte-identical edition units each need their
//   own per-occurrence record; both records landing on occurrence 0 leaves
//   occurrence 0 duplicated and occurrence 1 unaccounted (the invented-prose
//   hole a hash-only accounting would miss).
// - dangling-beat occurrence-sensitivity: a grounded beat naming a REAL source
//   hash but a non-existent occurrence is dangling.
// - D5 (AUDIT-04/17): a `grounded` record with empty/absent `beats` is invented
//   prose self-labeled grounded -> grounded-without-beats.
// - D8 (AUDIT-21): coverage<->grounding reconciliation -- a unit coverage proves
//   carries a beat cannot claim framing/connective, and a grounded record cannot
//   invent a beat->unit link coverage never declared -> basis-contradicts-coverage.
//
// checkGrounding now takes `coverage` as its 4th arg (D8): it is only ever
// called in compose context, so the reconciliation always runs. Fixtures that
// are not about reconciliation supply a coverage view that AGREES with their
// grounding (via `cov`, or `[]` for pure connective/framing units).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkGrounding } from '@/policy/grounding.ts';
import type { CoverageEntry, GroundingRecord, UnitRef } from '@/schema/ledger.ts';

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

// A `represented` coverage entry mapping a source beat to an edition unit. Used
// to supply the D8 basis<->coverage reconciliation with a coverage view that
// AGREES with the grounding under test, so these accounting fixtures stay
// isolated to the property each one exercises (unaccounted/duplicate/dangling).
function cov(sourceBeat: UnitRef, destUnit: UnitRef): CoverageEntry {
  return { source_unit: sourceBeat, op: 'represented', edition_units: [destUnit] };
}

// Same as `cov`, but the op is a parameter so the D8 reconciliation can be
// exercised over EVERY non-`cut` compose-legal op, not only `represented`
// (AUDIT-20260730-28). The reconciliation must fold ALL non-cut coverage
// entries, so a merged entry proving a destination carries a beat imposes the
// same grounded obligation a represented entry does.
function covWithOp(
  sourceBeat: UnitRef,
  destUnit: UnitRef,
  op: 'represented' | 'merged',
): CoverageEntry {
  return { source_unit: sourceBeat, op, edition_units: [destUnit] };
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

  const result = checkGrounding(records, ed, src, [cov(ref(s0), ref(e0))]);

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

  const result = checkGrounding(records, ed, src, [cov(ref(s0), ref(e0))]);

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

  const result = checkGrounding(records, ed, src, [cov(ref(s0), ref(e0))]);

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

  const result = checkGrounding(records, ed, src, [cov(ref(s0), ref(e0))]);

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

  // Coverage names the same (bogus) beat->unit link the grounded record claims,
  // so D8 reconciliation is silent and the dangling-beat property stays isolated.
  const result = checkGrounding(records, ed, src, [cov(bogusBeat, ref(e0))]);

  assert.equal(result.ok, false);
  const danglingBeat = result.failures.filter((f) => f.kind === 'dangling-beat');
  assert.equal(danglingBeat.length, 1);
  assert.match(danglingBeat[0]?.message ?? '', /unknown beat/);
  assert.match(danglingBeat[0]?.message ?? '', new RegExp('c'.repeat(64)));
});

// HIGH: the invented-prose hole. Grounding accounting is keyed on the derived
// unit's (contentHash, occurrenceIndex) pair -- NOT the hash alone. Two
// byte-identical edition paragraphs are DISTINCT units (occurrences 0 and 1),
// so each needs its own grounding record. A reimplementation that keyed only on
// contentHash would treat them as one unit: two records for the same hash would
// "account" for both, silently letting a second, ungrounded paragraph through.
test('checkGrounding: occurrence-sensitivity -- two byte-identical edition units each need their own record', () => {
  const src = deriveUnits(SOURCE, 'src');
  // Same content twice -> same contentHash, occurrences 0 and 1.
  const dupEdition = ['Same identical paragraph.', '', 'Same identical paragraph.', ''].join('\n');
  const ed = deriveUnits(dupEdition, 'ed');
  const [e0, e1] = ed;
  assert.ok(e0 && e1);
  assert.equal(e0.contentHash, e1.contentHash, 'fixture: both edition units must be byte-identical');
  assert.equal(e0.occurrenceIndex, 0);
  assert.equal(e1.occurrenceIndex, 1);

  // Case A: exactly one record per occurrence -> passes.
  const perOccurrence: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'connective' },
    { edition_unit: ref(e1), basis: 'connective' },
  ];
  // Both units are pure connective tissue (named by no coverage entry), so
  // coverage is empty and D8 reconciliation is inert -- this isolates the
  // occurrence-sensitive EXHAUSTIVE/EXCLUSIVE accounting.
  const passing = checkGrounding(perOccurrence, ed, src, []);
  assert.equal(
    passing.ok,
    true,
    `unexpected failures: ${passing.failures.map((f) => f.message).join(' | ')}`,
  );
  assert.deepEqual(passing.failures, []);

  // Case B: BOTH records resolve to occurrence 0 -> occ 0 duplicated, occ 1 unaccounted.
  const bothOccZero: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'connective' },
    { edition_unit: ref(e0), basis: 'connective' }, // wrongly also occurrence 0
  ];
  const result = checkGrounding(bothOccZero, ed, src, []);

  assert.equal(result.ok, false);
  const duplicate = result.failures.filter((f) => f.kind === 'duplicate');
  const unaccounted = result.failures.filter((f) => f.kind === 'unaccounted');
  assert.equal(duplicate.length, 1);
  assert.equal(unaccounted.length, 1);
  // The named unit distinguishes the two occurrences of the SAME hash: the
  // duplicate is occurrence 0, the unaccounted one is occurrence 1.
  assert.match(duplicate[0]?.message ?? '', /occurrence 0/);
  assert.match(duplicate[0]?.message ?? '', /has 2 records/);
  assert.match(unaccounted[0]?.message ?? '', /occurrence 1/);
  assert.match(unaccounted[0]?.message ?? '', /has no grounding record/);
  // Both messages carry the same hash -- only the occurrence tells them apart.
  assert.match(duplicate[0]?.message ?? '', new RegExp(e0.contentHash));
  assert.match(unaccounted[0]?.message ?? '', new RegExp(e0.contentHash));
});

// A grounded beat is resolved by (contentHash, occurrence), so a beat naming a
// REAL source hash at an occurrence that does not exist must still dangle. A
// hash-only reimplementation would falsely resolve it.
test('checkGrounding: dangling-beat occurrence-sensitivity -- real source hash, non-existent occurrence', () => {
  // A source with a single unique beat: the hash exists ONLY at occurrence 0.
  const src = deriveUnits('Unique source beat line.\n', 'src');
  const [s0] = src;
  assert.ok(s0);
  assert.equal(s0.occurrenceIndex, 0);

  const ed = deriveUnits('One composed edition paragraph.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  // beats names the REAL source hash, but occurrence 1, which does not exist.
  const wrongOccurrenceBeat: UnitRef = { hash: `sha256:${s0.contentHash}`, occurrence: 1 };
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [wrongOccurrenceBeat] },
  ];

  // Coverage names the same (wrong-occurrence) beat->unit link, so D8
  // reconciliation is silent and the dangling-beat property stays isolated.
  const result = checkGrounding(records, ed, src, [cov(wrongOccurrenceBeat, ref(e0))]);

  assert.equal(result.ok, false);
  const danglingBeat = result.failures.filter((f) => f.kind === 'dangling-beat');
  assert.equal(danglingBeat.length, 1);
  assert.match(danglingBeat[0]?.message ?? '', /unknown beat/);
  // The named beat carries the real hash and the non-existent occurrence 1.
  assert.match(danglingBeat[0]?.message ?? '', new RegExp(s0.contentHash));
  assert.match(danglingBeat[0]?.message ?? '', /occurrence 1/);
});

// D5 (AUDIT-04/17): the invented-prose hole reached by the SHORTEST path. A
// `grounded` record asserts its edition unit CAME FROM named source beats; a
// grounded record naming zero beats therefore asserts prose that came from
// nothing. It satisfies EXHAUSTIVE (one record for the unit), EXCLUSIVE (no
// duplicate/dangling), and has no beat to dangle, so a hole-free accounting
// would return ok:true. checkGrounding is the ONE source of truth the producer
// preflight AND the validator rest on, so it must self-defend here even though
// the wire schema/parser also guard the field. One fixture per empty shape.
test('checkGrounding: D5 -- a grounded record with beats: [] is grounded-without-beats, naming the unit', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('One composed edition paragraph.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'grounded', beats: [] }];

  // Empty coverage: the unit is not proven to carry any beat by coverage, so D8
  // adds nothing -- the empty-beats grounded label is the only defect.
  const result = checkGrounding(records, ed, src, []);

  assert.equal(result.ok, false);
  const empty = result.failures.filter((f) => f.kind === 'grounded-without-beats');
  assert.equal(empty.length, 1);
  assert.match(empty[0]?.message ?? '', /names no beats/);
  assert.match(empty[0]?.message ?? '', new RegExp(e0.contentHash));
  // It must NOT be silently accepted, and must NOT be mislabeled as a dangling beat.
  assert.equal(result.failures.filter((f) => f.kind === 'dangling-beat').length, 0);
});

test('checkGrounding: D5 -- a grounded record with beats ABSENT is grounded-without-beats', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('One composed edition paragraph.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  // `beats` omitted entirely (the type permits it -- beats is optional).
  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'grounded' }];

  const result = checkGrounding(records, ed, src, []);

  assert.equal(result.ok, false);
  const empty = result.failures.filter((f) => f.kind === 'grounded-without-beats');
  assert.equal(empty.length, 1);
  assert.match(empty[0]?.message ?? '', new RegExp(e0.contentHash));
});

// D8 (AUDIT-21): coverage and grounding are two views of the SAME beat<->edition
// mapping. Before this fix `basis` was an unfalsifiable self-label: a unit
// coverage PROVES carries beat n could claim `framing` ("not itself a beat") and
// escape the grounded obligation entirely. FORWARD reconciliation refuses that.
test('checkGrounding: D8 forward -- a unit coverage proves carries a beat cannot be labeled framing', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);

  // Coverage: beat 0 -> unit 0 (represented), beat 1 -> unit 1 (represented).
  const coverage: CoverageEntry[] = [cov(ref(s0), ref(e0)), cov(ref(s1), ref(e1))];
  // Grounding: unit 1 is honestly grounded on beat 1, but unit 0 -- which
  // coverage proves carries beat 0 -- self-labels `framing`.
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'framing' },
    { edition_unit: ref(e1), basis: 'grounded', beats: [ref(s1)] },
  ];

  const result = checkGrounding(records, ed, src, coverage);

  assert.equal(result.ok, false);
  const contradiction = result.failures.filter((f) => f.kind === 'basis-contradicts-coverage');
  assert.equal(contradiction.length, 1);
  assert.match(contradiction[0]?.message ?? '', /coverage proves/);
  assert.match(contradiction[0]?.message ?? '', new RegExp(e0.contentHash));
  assert.match(contradiction[0]?.message ?? '', new RegExp(s0.contentHash));
});

// D8 REVERSE: a `grounded` record's beats must be a SUBSET of the beats whose
// coverage names that unit -- grounding cannot invent a beat->unit link coverage
// never declared.
test('checkGrounding: D8 reverse -- a grounded beat not named by coverage for that unit is refused', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('One composed edition paragraph.\n', 'ed');
  const [s0, s1] = src;
  const [e0] = ed;
  assert.ok(s0 && s1 && e0);

  // Coverage says unit 0 carries ONLY beat 0.
  const coverage: CoverageEntry[] = [cov(ref(s0), ref(e0))];
  // Grounding claims unit 0 is grounded on beats 0 AND 1 -- beat 1 is a real
  // source beat, but coverage never maps it to unit 0.
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0), ref(s1)] },
  ];

  const result = checkGrounding(records, ed, src, coverage);

  assert.equal(result.ok, false);
  const contradiction = result.failures.filter((f) => f.kind === 'basis-contradicts-coverage');
  assert.equal(contradiction.length, 1);
  assert.match(contradiction[0]?.message ?? '', /no coverage entry maps that beat/);
  assert.match(contradiction[0]?.message ?? '', new RegExp(s1.contentHash));
  // Beat 1 is a REAL source unit, so this is a reconciliation failure, not a
  // dangling beat.
  assert.equal(result.failures.filter((f) => f.kind === 'dangling-beat').length, 0);
});

// AUDIT-20260730-35: the connective/framing escape (the headline hole). Invented
// prose escaped grounding by self-labeling `basis: 'connective'`/`'framing'`: the
// FORWARD reconciliation only anchors coverage-DECLARED destinations, and the
// REVERSE + grounded-without-beats checks only look at `grounded` records, so a
// non-grounded unit named by no coverage entry was exempt from EVERY beat
// obligation. MECHANICAL FIX: a unit carrying beat-derived REQUIRED PAYLOAD (a
// citation marker or numeral that resolves to a source beat) MUST be `grounded`.
// Whether a genuinely payload-FREE connective unit is honest vs invented is
// SEMANTIC and not mechanically checkable -- reported, not refused here.
test('checkGrounding: AUDIT-35 -- a connective unit carrying a beat CITATION is refused payload-bearing-unit-not-grounded', () => {
  const src = deriveUnits(SOURCE, 'src'); // beat 0 carries the citation [^b]
  const [s0] = src;
  assert.ok(s0);
  // The edition unit self-labels connective but carries the source citation [^b].
  const ed = deriveUnits('A framing sentence that still cites [^b].\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'connective' }];
  // Empty coverage: no coverage entry proves the unit carries a beat, so the ONLY
  // mechanical signal is the payload it itself carries -- isolates the new anchor
  // from the coverage-declaration reconciliation.
  const result = checkGrounding(records, ed, src, []);

  assert.equal(result.ok, false);
  const payloadBearing = result.failures.filter((f) => f.kind === 'payload-bearing-unit-not-grounded');
  assert.equal(payloadBearing.length, 1);
  assert.match(payloadBearing[0]?.message ?? '', /\[\^b\]/);
  assert.match(payloadBearing[0]?.message ?? '', new RegExp(e0.contentHash));
});

test('checkGrounding: AUDIT-35 -- a framing unit carrying a beat NUMERAL is refused payload-bearing-unit-not-grounded', () => {
  const src = deriveUnits(SOURCE, 'src'); // beat 0 carries the numeral 1978
  const [s0] = src;
  assert.ok(s0);
  const ed = deriveUnits('A framing aside mentioning 1978 in passing.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'framing' }];
  const result = checkGrounding(records, ed, src, []);

  assert.equal(result.ok, false);
  const payloadBearing = result.failures.filter((f) => f.kind === 'payload-bearing-unit-not-grounded');
  assert.equal(payloadBearing.length, 1);
  assert.match(payloadBearing[0]?.message ?? '', /1978/);
  assert.match(payloadBearing[0]?.message ?? '', new RegExp(e0.contentHash));
});

// Round-0 self-red-team: the anchor requires `grounded` (what we WANT) -- it must
// NOT false-fire on a genuinely payload-free connective unit, and a numeral/
// citation the unit invents (absent from every source beat) does NOT "resolve to
// a source beat", so it is semantic (reported), not a mechanical refusal.
test('checkGrounding: AUDIT-35 -- a genuinely payload-free connective unit passes (no mechanical anchor fires)', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('A purely connective transition with no source payload.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'connective' }];
  const result = checkGrounding(records, ed, src, []);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkGrounding: AUDIT-35 -- a connective unit with a numeral ABSENT from every beat passes (invented != beat-derived)', () => {
  const src = deriveUnits(SOURCE, 'src'); // beats carry 1978 and 42, NOT 9999
  const ed = deriveUnits('A connective transition inventing the figure 9999.\n', 'ed');
  const [e0] = ed;
  assert.ok(e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'connective' }];
  const result = checkGrounding(records, ed, src, []);

  assert.equal(
    result.ok,
    true,
    `an invented numeral that resolves to no beat is semantic, not a mechanical refusal; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

// AUDIT-20260730-26: forward reconciliation must be PER-BEAT, not merely "the
// unit is named by SOME coverage entry". Coverage proves e0 carries BOTH s0 and
// s1 (a merge landing on one unit); a grounded record that names only s0 DROPS
// s1 -- provenance the two views disagree about while accounting reports ok.
test('checkGrounding: AUDIT-26 forward -- a grounded record that OMITS a beat coverage proves it carries is refused', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('One merged edition paragraph.\n', 'ed');
  const [s0, s1] = src;
  const [e0] = ed;
  assert.ok(s0 && s1 && e0);

  // Coverage proves e0 carries BOTH beats.
  const coverage: CoverageEntry[] = [cov(ref(s0), ref(e0)), cov(ref(s1), ref(e0))];
  // Grounding names only s0 -- s1 is silently dropped.
  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] }];

  const result = checkGrounding(records, ed, src, coverage);

  assert.equal(result.ok, false);
  const contradiction = result.failures.filter((f) => f.kind === 'basis-contradicts-coverage');
  assert.equal(contradiction.length, 1);
  assert.match(contradiction[0]?.message ?? '', /coverage proves/);
  assert.match(contradiction[0]?.message ?? '', new RegExp(s1.contentHash));
});

// AUDIT-20260730-27: empty coverage + an honest `grounded` record naming REAL
// beats. The behavior is PINNED as FAIL-CLOSED: D8's invariant is that coverage
// and grounding are two views of the SAME mapping, so a grounded record whose
// beat NO coverage entry backs is a contradiction (`basis-contradicts-coverage`),
// NOT a silent ok:true. This forbids a producer defeating D8 by emitting zero
// coverage entries.
test('checkGrounding: AUDIT-27 -- empty coverage + a grounded record naming real beats is fail-closed', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits('One composed edition paragraph.\n', 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const records: GroundingRecord[] = [{ edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] }];
  const result = checkGrounding(records, ed, src, []);

  assert.equal(
    result.ok,
    false,
    'an empty coverage view must NOT silently pass an honest grounded record (fail-closed)',
  );
  const contradiction = result.failures.filter((f) => f.kind === 'basis-contradicts-coverage');
  assert.equal(contradiction.length, 1);
  assert.match(contradiction[0]?.message ?? '', /no coverage entry maps that beat/);
});

// AUDIT-20260730-28: the D8 reconciliation must fold EVERY non-`cut` coverage
// entry, not only `represented`. Table-driven over the compose-legal non-cut ops:
// a merged entry proving a destination carries a beat imposes the same grounded
// obligation, so a framing self-label is still refused.
for (const op of ['represented', 'merged'] as const) {
  test(`checkGrounding: AUDIT-28 D8 forward under op '${op}' -- a unit coverage proves carries a beat cannot self-label framing`, () => {
    const src = deriveUnits(SOURCE, 'src');
    const ed = deriveUnits(EDITION, 'ed');
    const [s0, s1] = src;
    const [e0, e1] = ed;
    assert.ok(s0 && s1 && e0 && e1);

    const coverage: CoverageEntry[] = [covWithOp(ref(s0), ref(e0), op), covWithOp(ref(s1), ref(e1), op)];
    const records: GroundingRecord[] = [
      { edition_unit: ref(e0), basis: 'framing' },
      { edition_unit: ref(e1), basis: 'grounded', beats: [ref(s1)] },
    ];

    const result = checkGrounding(records, ed, src, coverage);

    assert.equal(result.ok, false);
    const contradiction = result.failures.filter((f) => f.kind === 'basis-contradicts-coverage');
    assert.equal(contradiction.length, 1);
    assert.match(contradiction[0]?.message ?? '', /coverage proves/);
    assert.match(contradiction[0]?.message ?? '', new RegExp(e0.contentHash));
  });
}

// AUDIT-20260730-28 (drop-shaped op): a `cut` coverage entry drops its beat and
// declares no destination, so it imposes NO grounding obligation -- it must not
// become a spurious `basis-contradicts-coverage`.
test('checkGrounding: AUDIT-28 -- a cut coverage entry imposes no grounding obligation', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);

  // beat 0 -> e0 (represented); beat 1 is CUT (no destination). e1 is pure
  // connective tissue named by no coverage entry.
  const coverage: CoverageEntry[] = [
    cov(ref(s0), ref(e0)),
    { source_unit: ref(s1), op: 'cut', reason: 'dropped from the edition' },
  ];
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] },
    { edition_unit: ref(e1), basis: 'connective' },
  ];

  const result = checkGrounding(records, ed, src, coverage);

  assert.equal(
    result.ok,
    true,
    `a cut entry must not create a grounding obligation; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

// D8 all-consistent: coverage and grounding agree, with a pure connective unit
// (named by no coverage entry) legitimately present -> passes.
test('checkGrounding: D8 -- a coverage-consistent edition with a pure connective unit passes', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(EDITION, 'ed');
  const [s0] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && e0 && e1);

  // Coverage maps beat 0 -> unit 0; unit 1 is pure connective tissue, named by
  // no coverage entry, so it may legitimately be `connective`.
  const coverage: CoverageEntry[] = [cov(ref(s0), ref(e0))];
  const records: GroundingRecord[] = [
    { edition_unit: ref(e0), basis: 'grounded', beats: [ref(s0)] },
    { edition_unit: ref(e1), basis: 'connective' },
  ];

  const result = checkGrounding(records, ed, src, coverage);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

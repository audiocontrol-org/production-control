// T009 (RED-first) round-3 extensions: adversarial tests for the shared, pure
// edition-side grounding accounting policy (spec 006,
// contracts/voice-compose-cli.md Refusals, data-model.md "Edition-side
// grounding accounting", R8).
//
// Split out of policy-grounding.test.ts to keep both files under the
// governance audit envelope; see that file for the core EXHAUSTIVE/EXCLUSIVE/
// dangling-beat accounting tests and the shared checkGrounding contract.
//
// Covers:
// - D5 (AUDIT-04/17): a `grounded` record with empty/absent `beats` is invented
//   prose self-labeled grounded -> grounded-without-beats.
// - D8 (AUDIT-21): coverage<->grounding reconciliation -- a unit coverage proves
//   carries a beat cannot claim framing/connective, and a grounded record cannot
//   invent a beat->unit link coverage never declared -> basis-contradicts-coverage.
// - AUDIT-35: the connective/framing escape -- a unit carrying beat-derived
//   required payload (a citation or numeral resolving to a source beat) must be
//   `grounded`; a genuinely payload-free unit, or one inventing a numeral absent
//   from every beat, still passes.
// - AUDIT-26/27/28: forward reconciliation is PER-BEAT (a merge that drops a
//   beat is refused), fail-closed under empty coverage, folds every non-`cut`
//   op, and a `cut` entry imposes no grounding obligation.
//
// checkGrounding takes `coverage` as its 4th arg (D8): it is only ever
// called in compose context, so the reconciliation always runs.

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
// isolated to the property each one exercises.
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

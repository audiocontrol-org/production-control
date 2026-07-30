// T009 (RED-first): adversarial tests for the shared, pure mode-scoped op
// legality policy (spec 006, contracts/voice-compose-cli.md Refusals, R4, R8,
// data-model.md "CoverageEntry (EXTENDED -- mode-scoped legality)").
//
// checkOpLegality is imported by BOTH the producer preflight and the fidelity
// validator (R8). It judges ONLY op legality per mode -- not accounting,
// payload survival, or grounding. It returns named structured failures (never
// throws for a policy violation).
//
// Covers:
// - compose: a `verbatim` op is illegal, named by coverage entry index.
// - compose: a `cut` op is illegal, named by coverage entry index.
// - compose: a destination byte-identical to a complete source beat (whole-unit
//   copy, R4) is illegal, naming the edition unit + beat -- table-driven over
//   BOTH `represented` and `merged` (AUDIT-03), and asserted OP-AGNOSTIC: the
//   load-bearing detector is the exhaustive sweep, which does not read the op.
// - compose (D4/AUDIT-18): the EXHAUSTIVE sweep catches a byte-identical copy
//   that the coverage-keyed pairwise arm misses -- a copy accounted only via
//   grounding (named in no coverage entry) and a copy declared under a DIFFERENT
//   beat both fail `whole-unit-copy`. Plus the STATE channel: an
//   occurrence-repeated identical unit where only one occurrence is declared.
// - revise: a `verbatim` op whose destination drifts from its source unit is
//   illegal (TASK-50 predicate), naming the unit.
// - revise: a `verbatim` op whose destination is byte-exact to its source is legal.
// - a fully-legal compose set (represented + merged, no copies) passes.
// - compose: an unresolved edition_units ref is skipped by the pairwise arm, not
//   reported as a whole-unit copy (existence is a separate check's concern); the
//   fixture's real edition units are genuine re-voicings, so the exhaustive
//   sweep is also clean.
// - revise: represented/merged destinations that drift from source are legal
//   (only `verbatim` is drift-checked in revise).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkOpLegality } from '@/policy/op-legality.ts';
import type { CoverageEntry, UnitRef } from '@/schema/ledger.ts';

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

// Two distinct beats; letter citations keep numeric/payload noise out of scope.
const SOURCE = ['Beta cites [^b] and counts 1978.', '', 'Gamma one with 42.', ''].join('\n');

// A genuinely composed edition: neither unit is a byte-copy of a beat.
const COMPOSED = ['Rewritten beta citing [^b] with 1978.', '', 'Merged gamma line with 42.', ''].join(
  '\n',
);

test('checkOpLegality: compose forbids a verbatim op, naming the coverage entry', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(COMPOSED, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false);
  const verbatim = result.failures.filter((f) => f.kind === 'compose-forbids-verbatim');
  assert.equal(verbatim.length, 1);
  assert.match(verbatim[0]?.message ?? '', /compose-mode forbids verbatim: coverage entry 0/);
});

test('checkOpLegality: compose forbids a cut op, naming the coverage entry', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(COMPOSED, 'ed');
  const [s0, s1] = src;
  const [e0] = ed;
  assert.ok(s0 && s1 && e0);

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'cut', reason: 'dropped' },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false);
  const cut = result.failures.filter((f) => f.kind === 'compose-forbids-cut');
  assert.equal(cut.length, 1);
  assert.match(cut[0]?.message ?? '', /compose-mode forbids cut: coverage entry 1/);
});

// AUDIT-03: whole-unit copy is exercised under BOTH `represented` AND `merged`,
// table-driven. `merged` is a first-class legal compose op that this same file
// pins as legal, and the model chooses its own op labels -- so the copy rule
// must fire regardless of the label. With D4's exhaustive sweep this is
// OP-AGNOSTIC by construction (the sweep never reads the op); the table proves
// it, and forces any future compose-legal op to be added here deliberately.
for (const op of ['represented', 'merged'] as const) {
  test(`checkOpLegality: compose forbids a whole-unit copy under op '${op}' (destination byte-identical to a beat)`, () => {
    const src = deriveUnits(SOURCE, 'src');
    // The first edition unit is a VERBATIM copy of the first beat; the second is
    // genuinely rewritten.
    const copied = ['Beta cites [^b] and counts 1978.', '', 'Rewritten gamma with 42.', ''].join('\n');
    const ed = deriveUnits(copied, 'ed');
    const [s0, s1] = src;
    const [e0, e1] = ed;
    assert.ok(s0 && s1 && e0 && e1);
    assert.equal(e0.contentHash, s0.contentHash, 'fixture: edition unit 0 must be a byte-copy of beat 0');

    const coverage: CoverageEntry[] = [
      { source_unit: ref(s0), op, edition_units: [ref(e0)] },
      { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
    ];

    const result = checkOpLegality('compose', coverage, src, ed);

    assert.equal(result.ok, false);
    const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
    assert.equal(copies.length, 1, `op '${op}' copy must fire exactly once (pairwise + sweep deduped)`);
    assert.match(copies[0]?.message ?? '', /whole-unit copy/);
    assert.match(copies[0]?.message ?? '', new RegExp(s0.contentHash));
  });
}

// D4 (AUDIT-18) VALUE channel: a byte-identical copy accounted ONLY via
// grounding -- the edition unit is named in NO coverage entry's edition_units,
// so the coverage-keyed pairwise arm never sees it. The exhaustive sweep, which
// compares the derived edition set against the derived source set directly, must
// still refuse it. Invariant: every derived edition unit that byte-equals any
// source beat is a copy, regardless of how (or whether) coverage declares it.
test('checkOpLegality: D4 sweep -- a copy accounted only via grounding (in no coverage entry) fails whole-unit-copy', () => {
  const src = deriveUnits(SOURCE, 'src');
  const [s0, s1] = src;
  assert.ok(s0 && s1);
  // e0 genuinely re-voices beat 0; e1 is a BYTE-IDENTICAL copy of beat 1.
  const edition = ['Rewritten beta citing [^b] with 1978.', '', 'Gamma one with 42.', ''].join('\n');
  const ed = deriveUnits(edition, 'ed');
  const [e0, e1] = ed;
  assert.ok(e0 && e1);
  assert.notEqual(e0.contentHash, s0.contentHash, 'fixture: e0 must be a genuine re-voicing');
  assert.equal(e1.contentHash, s1.contentHash, 'fixture: e1 must be a byte-copy of beat 1');

  // Coverage declares ONLY beat 0 -> e0. e1 (the copy) is named nowhere in
  // coverage -- it is "accounted only via grounding".
  const coverage: CoverageEntry[] = [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false, 'the undeclared byte-copy must be refused by the exhaustive sweep');
  const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
  assert.equal(copies.length, 1);
  assert.match(copies[0]?.message ?? '', new RegExp(e1.contentHash));
});

// D4 (AUDIT-18): a copy declared under a DIFFERENT beat. The pairwise arm
// compares the copy's destination against the WRONG beat (the one its coverage
// entry names), so the hashes differ and it is missed. The sweep compares
// against ALL beats and catches it.
test('checkOpLegality: D4 sweep -- a copy declared under a different beat fails whole-unit-copy', () => {
  const src = deriveUnits(SOURCE, 'src');
  const [s0, s1] = src;
  assert.ok(s0 && s1);
  // e0 re-voices beat 0; e1 is a byte-copy of beat 1 but is DECLARED as a second
  // destination of beat 0's coverage entry (a different beat).
  const edition = ['Rewritten beta citing [^b] with 1978.', '', 'Gamma one with 42.', ''].join('\n');
  const ed = deriveUnits(edition, 'ed');
  const [e0, e1] = ed;
  assert.ok(e0 && e1);
  assert.notEqual(e1.contentHash, s0.contentHash, 'fixture: e1 must NOT match the beat it is declared under');
  assert.equal(e1.contentHash, s1.contentHash, 'fixture: e1 IS a byte-copy of beat 1');

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0), ref(e1)] },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false, 'a copy declared under a different beat must still be refused');
  const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
  assert.equal(copies.length, 1);
  assert.match(copies[0]?.message ?? '', new RegExp(e1.contentHash));
});

// D4 STATE channel: an occurrence-repeated identical unit. The edition contains
// the beat's text TWICE (occurrences 0 and 1); coverage declares only the
// occurrence-1 destination. Both occurrences byte-equal the beat, so the sweep
// -- which is keyed on (contentHash, occurrence) identity for dedup but matches
// on bytes -- refuses BOTH; the undeclared occurrence 0 is exactly the copy the
// pairwise arm would miss.
test('checkOpLegality: D4 sweep -- an occurrence-repeated identical unit fails for every occurrence', () => {
  const src = deriveUnits('Gamma one with 42.\n', 'src');
  const [s0] = src;
  assert.ok(s0);
  const edition = ['Gamma one with 42.', '', 'Some distinct filler unit.', '', 'Gamma one with 42.', ''].join(
    '\n',
  );
  const ed = deriveUnits(edition, 'ed');
  const [e0, , e2] = ed;
  assert.ok(e0 && e2);
  assert.equal(e0.contentHash, s0.contentHash);
  assert.equal(e0.occurrenceIndex, 0);
  assert.equal(e2.contentHash, s0.contentHash);
  assert.equal(e2.occurrenceIndex, 1);

  // Only the occurrence-1 copy is declared.
  const coverage: CoverageEntry[] = [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e2)] }];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false);
  const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
  assert.equal(copies.length, 2, 'both the declared occurrence-1 copy and the undeclared occurrence-0 copy fail');
  assert.ok(copies.some((f) => /occurrence 0/.test(f.message)), 'the undeclared occurrence-0 copy is caught');
  assert.ok(copies.some((f) => /occurrence 1/.test(f.message)), 'the declared occurrence-1 copy is caught');
});

test('checkOpLegality: revise verbatim drift (destination differs from source) is illegal, naming the unit', () => {
  const src = deriveUnits('Alpha verbatim line [^a].\n', 'src');
  const ed = deriveUnits('Alpha verbatim line [^a]!\n', 'ed'); // one byte differs
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  assert.notEqual(e0.contentHash, s0.contentHash);

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
  ];

  const result = checkOpLegality('revise', coverage, src, ed);

  assert.equal(result.ok, false);
  const drift = result.failures.filter((f) => f.kind === 'revise-verbatim-drift');
  assert.equal(drift.length, 1);
  assert.match(drift[0]?.message ?? '', /revise verbatim drift/);
  assert.match(drift[0]?.message ?? '', new RegExp(s0.contentHash));
});

test('checkOpLegality: revise verbatim byte-exact destination is legal', () => {
  const src = deriveUnits('Alpha verbatim line [^a].\n', 'src');
  const ed = deriveUnits('Alpha verbatim line [^a].\n', 'ed'); // byte-exact
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  assert.equal(e0.contentHash, s0.contentHash);

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
  ];

  const result = checkOpLegality('revise', coverage, src, ed);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkOpLegality: a fully-legal compose set (represented + merged, no copies) passes', () => {
  const src = deriveUnits(SOURCE, 'src');
  const ed = deriveUnits(COMPOSED, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'merged', edition_units: [ref(e1)] },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

// MEDIUM: skip-on-unresolved-ref is INTENDED behavior of the PAIRWISE arm,
// pinned here.
//
// WHY IT IS SAFE: op-legality's pairwise arm is scoped to the legality of
// RESOLVED refs. An edition_units ref that resolves to no derived edition unit
// is an EXISTENCE/accounting failure -- independently refused by the validator's
// op-obligations / classify-op-failures over the same ledger. If the pairwise
// arm ALSO flagged it, the unresolved ref would be double-reported; instead it
// defers, so existence stays one check's concern. This test pins that so a
// reimplementation cannot "helpfully" begin reporting whole-unit-copy on refs it
// never resolved.
//
// NOTE (D4/AUDIT-18): this fixture was REWORKED when the exhaustive sweep landed.
// The old fixture made the edition's only real unit a byte-copy of the beat and
// asserted a clean result -- but that scenario IS the AUDIT-18 hole (a real
// derived edition unit byte-identical to a source beat), which the sweep now
// correctly refuses regardless of how it is declared. So the fixture's real
// edition unit is now a GENUINE re-voicing (byte-different from every beat),
// keeping the sweep legitimately silent, while the adversarial UNRESOLVED ref
// still cites a hash that matches a beat at a NON-EXISTENT occurrence -- the
// pairwise arm resolves by (contentHash, occurrence), finds nothing, and skips.
test('checkOpLegality: an unresolved edition_units ref is skipped by the pairwise arm, not reported as a whole-unit copy', () => {
  const src = deriveUnits('Shared identical line here.\n', 'src');
  const ed = deriveUnits('A genuinely re-voiced line here.\n', 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  assert.notEqual(e0.contentHash, s0.contentHash, 'fixture: the real edition unit must be a genuine re-voicing');

  // Adversarial ref: the BEAT's hash at occurrence 1, which resolves to no
  // derived edition unit (the edition has no unit with that hash at all).
  const unresolvedDest: UnitRef = { hash: `sha256:${s0.contentHash}`, occurrence: 1 };
  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'represented', edition_units: [unresolvedDest] },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
  assert.equal(copies.length, 0, 'unresolved dest ref must not be reported as a whole-unit copy');
  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
});

// Only `verbatim` is byte-exactness-checked in revise. `represented`/`merged`
// deliberately allow the destination bytes to differ from the source (that is
// what a rewrite/merge IS), so a drifting destination is LEGAL under those ops.
test('checkOpLegality: revise represented/merged destinations that drift from source are legal (only verbatim is drift-checked)', () => {
  const revSrc = ['Original alpha line.', '', 'Original beta line.', ''].join('\n');
  const revEd = ['Rewritten alpha prose entirely.', '', 'Rewritten beta prose entirely.', ''].join('\n');
  const src = deriveUnits(revSrc, 'src');
  const ed = deriveUnits(revEd, 'ed');
  const [s0, s1] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && e0 && e1);
  assert.notEqual(e0.contentHash, s0.contentHash, 'fixture: represented destination must drift');
  assert.notEqual(e1.contentHash, s1.contentHash, 'fixture: merged destination must drift');

  const coverage: CoverageEntry[] = [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'merged', edition_units: [ref(e1)] },
  ];

  const result = checkOpLegality('revise', coverage, src, ed);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.map((f) => f.message).join(' | ')}`);
  const drift = result.failures.filter((f) => f.kind === 'revise-verbatim-drift');
  assert.equal(drift.length, 0);
  assert.deepEqual(result.failures, []);
});

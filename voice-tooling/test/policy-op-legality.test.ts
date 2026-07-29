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
// - compose: a `represented`/`merged` destination byte-identical to a complete
//   source beat (whole-unit copy, R4) is illegal, naming the edition unit + beat.
// - revise: a `verbatim` op whose destination drifts from its source unit is
//   illegal (TASK-50 predicate), naming the unit.
// - revise: a `verbatim` op whose destination is byte-exact to its source is legal.
// - a fully-legal compose set (represented + merged, no copies) passes.
// - compose: an unresolved edition_units ref is skipped, not reported as a
//   whole-unit copy (existence is a separate check's concern).
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

test('checkOpLegality: compose forbids a whole-unit copy (destination byte-identical to a beat)', () => {
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
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'represented', edition_units: [ref(e1)] },
  ];

  const result = checkOpLegality('compose', coverage, src, ed);

  assert.equal(result.ok, false);
  const copies = result.failures.filter((f) => f.kind === 'whole-unit-copy');
  assert.equal(copies.length, 1);
  assert.match(copies[0]?.message ?? '', /whole-unit copy/);
  assert.match(copies[0]?.message ?? '', new RegExp(s0.contentHash));
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

// MEDIUM: skip-on-unresolved-ref is INTENDED behavior, pinned here.
//
// WHY IT IS SAFE: op-legality is scoped to the legality of RESOLVED refs. An
// edition_units ref that resolves to no derived edition unit is an
// EXISTENCE/accounting failure -- independently refused by the validator's
// op-obligations / classify-op-failures over the same ledger. If op-legality
// ALSO flagged it, the unresolved ref would be double-reported; instead it
// defers, so existence stays one check's concern. This test pins that so a
// reimplementation cannot "helpfully" begin reporting whole-unit-copy on refs
// it never resolved.
//
// The construction is adversarial: the destination bytes ARE a whole-unit copy
// of the beat (identical content -> identical contentHash), but the ref cites
// occurrence 1, which does not exist in the edition (only occurrence 0 does). A
// hash-only check would falsely flag a copy; the correct check resolves the ref
// by (contentHash, occurrence) first, finds nothing, and skips.
test('checkOpLegality: an unresolved edition_units ref is skipped, not reported as a whole-unit copy', () => {
  const shared = 'Shared identical line here.\n';
  const src = deriveUnits(shared, 'src');
  const ed = deriveUnits(shared, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  assert.equal(e0.contentHash, s0.contentHash, 'fixture: edition bytes equal the beat bytes');
  assert.equal(e0.occurrenceIndex, 0, 'fixture: the only edition occurrence is 0');

  // Same hash as the real edition unit, but occurrence 1 -> resolves to nothing.
  const unresolvedDest: UnitRef = { hash: `sha256:${e0.contentHash}`, occurrence: 1 };
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

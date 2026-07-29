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

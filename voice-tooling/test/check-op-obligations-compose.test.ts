// T019 (RED, pending T020): adversarial tests pinning `check-op-obligations.ts`'s
// intended MODE-AWARE behavior (spec 006 US3, contracts/fidelity-mode-agreement.md
// check ordering step 2: "op-obligations -- now mode-aware: in compose,
// `verbatim` and `cut` ops are illegal dispositions (fail); revise unchanged",
// data-model.md "CoverageEntry (EXTENDED -- mode-scoped legality)").
//
// Intended API (unchanged signature -- `checkOpObligations(ledger, sourceUnits,
// editionUnits, lexicon?)`): T020 makes the function read the ALREADY-PRESENT
// `ledger.mode` field and delegate the illegal-disposition judgment to the
// ALREADY-GREEN, shared
// `policy/op-legality.ts#checkOpLegality`, folding its `compose-forbids-verbatim`
// / `compose-forbids-cut` failures (verbatim message:
// "compose-mode forbids verbatim: coverage entry N"; cut message:
// "compose-mode forbids cut: coverage entry N") into this check's own
// `failures[]`. This file does NOT need a new parameter to be RED: it builds a
// ledger with `mode: 'compose'` and expects the illegal-disposition failure the
// CURRENT (mode-blind) implementation does not yet produce.
//
// SHIPPED mode semantics (AUDIT-06/-45): `loadLedger` ALWAYS stamps `mode` and
// returns a `LoadedLedger` whose `mode` is REQUIRED (schema/ledger.ts) -- a
// pre-006 ledger with no `mode:` key reads as `'revise'` for backward
// compatibility, but a LOADED ledger can never be missing its mode. This is NOT
// a fail-open default INSIDE this check: `checkOpObligations` does not default an
// absent mode -- an unstamped `CoverageLedger` reaching it by other means is a
// caller defect it THROWS on (fail-closed), never a silent 'revise'.
//
// Whole-unit no-copy (R4) is deliberately OUT of scope here -- that is
// `check-no-copy.test.ts` / T021's concern (check ordering step 5, a separate
// later check). Every compose fixture below uses only represented/merged ops
// with genuinely rewritten (non-copy) destinations, so it stays inert
// regardless of how T020 folds op-legality's failures.
//
// Covers:
// - compose: a `verbatim` op FAILS, naming the coverage entry.
// - compose: a `cut` op FAILS, naming the coverage entry.
// - compose: a faithful set (only `represented`/`merged`) passes op-obligations.
// - revise: UNCHANGED -- a byte-exact `verbatim` and a reasoned `cut` still pass
//   (pins that T020 does not regress revise).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import type { CoverageEntry, CoverageLedger, Mode, UnitRef } from '@/schema/ledger.ts';

const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function ledgerOf(mode: Mode, coverage: CoverageEntry[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: 'test-source', hash: PLACEHOLDER_HASH },
    voice: { identity: 'test-voice', hash: PLACEHOLDER_HASH },
    mode,
    coverage,
  };
}

test('checkOpObligations: compose forbids a verbatim op, naming the coverage entry', () => {
  const src = deriveUnits('Alpha verbatim line [^a].\n', 'src');
  const ed = deriveUnits('Alpha verbatim line [^a].\n', 'ed'); // byte-exact -- mechanically fine
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
  ]);

  const result = checkOpObligations(ledger, src, ed);

  assert.equal(
    result.ok,
    false,
    `compose must forbid verbatim even when the destination is byte-exact; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
  assert.ok(
    result.failures.some((f) => f.message === 'compose-mode forbids verbatim: coverage entry 0'),
    `expected a "compose-mode forbids verbatim" failure naming coverage entry 0; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
});

test('checkOpObligations: compose forbids a cut op, naming the coverage entry', () => {
  const src = deriveUnits('Epsilon cut line.\n', 'src');
  const [s0] = src;
  assert.ok(s0);

  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'cut', reason: 'not carried into the edition' },
  ]);

  const result = checkOpObligations(ledger, src, []);

  assert.equal(
    result.ok,
    false,
    `compose must forbid cut; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  assert.ok(
    result.failures.some((f) => f.message === 'compose-mode forbids cut: coverage entry 0'),
    `expected a "compose-mode forbids cut" failure naming coverage entry 0; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
});

test('checkOpObligations: a faithful compose set (represented + merged only, no copies) passes', () => {
  const source = [
    'Beta cites [^b] and counts 1978.',
    '> quoted span one',
    '',
    'Gamma one with 42.',
    '',
    'Gamma two cites [^c].',
    '',
  ].join('\n');
  const edition = [
    'Rewritten beta citing [^b] with 1978.',
    '> quoted span one',
    '',
    'Merged gamma line with 42 and [^c].',
    '',
  ].join('\n');
  const src = deriveUnits(source, 'src');
  const ed = deriveUnits(edition, 'ed');
  const [s0, s1, s2] = src;
  const [e0, e1] = ed;
  assert.ok(s0 && s1 && s2 && e0 && e1, 'expected 3 source units and 2 edition units');
  // Neither destination is a byte-copy of any single source beat -- this
  // fixture is inert to whichever op-legality failures T020 chooses to fold in.
  assert.notEqual(e0.contentHash, s0.contentHash);
  assert.notEqual(e1.contentHash, s1.contentHash);
  assert.notEqual(e1.contentHash, s2.contentHash);

  const ledger = ledgerOf('compose', [
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] },
    { source_unit: ref(s1), op: 'merged', edition_units: [ref(e1)] },
    { source_unit: ref(s2), op: 'merged', edition_units: [ref(e1)] },
  ]);

  const result = checkOpObligations(ledger, src, ed);

  assert.equal(
    result.ok,
    true,
    `a faithful represented/merged-only compose set must pass; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

test('checkOpObligations: revise is UNCHANGED -- a byte-exact verbatim still passes', () => {
  const src = deriveUnits('Alpha verbatim line [^a].\n', 'src');
  const ed = deriveUnits('Alpha verbatim line [^a].\n', 'ed'); // byte-exact
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const ledger = ledgerOf('revise', [
    { source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] },
  ]);

  const result = checkOpObligations(ledger, src, ed);

  assert.equal(
    result.ok,
    true,
    `revise verbatim (byte-exact) must remain legal; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

test('checkOpObligations: revise is UNCHANGED -- a reasoned cut still passes', () => {
  const src = deriveUnits('Epsilon cut line.\n', 'src');
  const [s0] = src;
  assert.ok(s0);

  const ledger = ledgerOf('revise', [
    { source_unit: ref(s0), op: 'cut', reason: 'not carried into the edition' },
  ]);

  const result = checkOpObligations(ledger, src, []);

  assert.equal(
    result.ok,
    true,
    `revise cut must remain legal; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

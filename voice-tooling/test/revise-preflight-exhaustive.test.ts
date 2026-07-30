// FG-B2 (AUDIT-20260730-43 + -42): the REVISE branch of `runPreflight` must be
// EXHAUSTIVE over `OpLegalityFailureKind` -- the same fail-open the compose
// branch was hardened against in round 2 (AUDIT-11/12/19). The pre-fix revise
// branch filtered `checkOpLegality('revise', ...)` failures down to ONLY
// `revise-verbatim-drift` and silently dropped every other kind, so an
// `op-without-destination` (a `represented`/`merged` entry that lands nowhere --
// an undeclared cut, FG-A2/AUDIT-34) escaped the write gate in revise.
//
// These pin, at the producer-core layer (value channel):
//   - a non-drift illegal kind (`op-without-destination`) is REFUSED, not dropped;
//   - a LEGITIMATE revise output (represented with real destinations; a byte-exact
//     verbatim carry-over) is NOT falsely refused (round-0 self-red-team control).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { runPreflight } from '@/revise/preflight.ts';
import type { CoverageEntry, UnitRef } from '@/schema/ledger.ts';

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

const SOURCE_TEXT = 'A source unit whose disposition lands nowhere.\n';
const EDITION_TEXT = 'A revised unit.\n';

test('AUDIT-43: revise preflight REFUSES an op-without-destination (represented with EMPTY edition_units) -- a non-drift illegal kind is not silently dropped', () => {
  const src = deriveUnits(SOURCE_TEXT, 'src');
  const ed = deriveUnits(EDITION_TEXT, 'ed');
  const [s0] = src;
  assert.ok(s0);
  // `represented` (a non-cut op) with an EMPTY declared destination set is an
  // undeclared cut -> `checkOpLegality('revise', ...)` yields `op-without-destination`.
  const coverage: CoverageEntry[] = [{ source_unit: ref(s0), op: 'represented', edition_units: [] }];

  const result = runPreflight('revise', undefined, coverage, ed, src);

  assert.equal(
    result.ok,
    false,
    'a revise op that lands nowhere must be refused pre-emit, not dropped by a kind filter',
  );
  assert.ok(
    result.refusals.some((m) => /undeclared cut|declares no edition_units/.test(m)),
    `the refusal must name the op-without-destination kind; got: ${result.refusals.join('; ')}`,
  );
});

test('AUDIT-43 control: a legitimate revise output (represented with a REAL destination) is NOT refused', () => {
  const src = deriveUnits(SOURCE_TEXT, 'src');
  const ed = deriveUnits(EDITION_TEXT, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  const coverage: CoverageEntry[] = [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }];

  const result = runPreflight('revise', undefined, coverage, ed, src);

  assert.equal(
    result.ok,
    true,
    `a legitimate represented revise op must not be refused; refusals: ${result.refusals.join('; ')}`,
  );
  assert.deepEqual(result.refusals, []);
});

test('AUDIT-43 control (round-0 self-red-team): a BYTE-EXACT verbatim revise op is NOT refused -- byte-identity carry-over is legal in revise', () => {
  const text = 'These exact bytes are carried over verbatim.\n';
  const src = deriveUnits(text, 'src');
  const ed = deriveUnits(text, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);
  const coverage: CoverageEntry[] = [{ source_unit: ref(s0), op: 'verbatim', edition_units: [ref(e0)] }];

  const result = runPreflight('revise', undefined, coverage, ed, src);

  assert.equal(
    result.ok,
    true,
    `a byte-exact verbatim revise op must pass (no whole-unit-copy refusal in revise); refusals: ${result.refusals.join('; ')}`,
  );
});

// FG-C D11 (AUDIT-08): the open-question-marker byte-survival obligation is
// COMPOSE-SCOPED (R7/FR-013), mirroring the `lexiconApplicable` gate. In
// COMPOSE, a `[OPEN-QUESTION: ...]` marker in a source beat is required payload
// whose exact bytes must survive into the declared destination. In REVISE it is
// ordinary prose a revision may legitimately RESOLVE by deleting — so dropping
// it must NOT be refused (the marker obligation does not exist in revise).
//
// Exercises `checkOpObligations` directly (mirrors `test/op-obligations.test.ts`):
// the check owns the marker obligation, so gating it there is the load-bearing
// fix. `report.ts`'s `open_question_markers` field stays compose-only already.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import type { CoverageEntry, CoverageLedger, Mode, UnitRef } from '@/schema/ledger.ts';

const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;
// AUDIT-20260730-23: the SCOPE marker carries NO numeral and NO citation, so the
// scope tests below assert ONLY the mode-scope property (revise has no marker
// obligation) -- they no longer defend silent loss of a marker-interior numeral.
// A dedicated numeral-bearing marker (`MARKER_WITH_NUMERAL`) drives the
// companion case that pins numeral enforcement in revise.
const MARKER = '[OPEN-QUESTION: What caused the observed anomaly?]';
const MARKER_WITH_NUMERAL = '[OPEN-QUESTION: does the 42-unit cohort hold?]';

// A source beat that DECLARES a marker; an edition beat that DROPS it (a plain
// rewrite that resolves the question). Represented op, 1:1.
const SOURCE_TEXT = `Beta beat raises a question. ${MARKER}\n`;
const EDITION_DROPS_MARKER = 'Beta rewritten, the question resolved and the marker deleted.\n';

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

test('D11 (AUDIT-08): a REVISE edition that DROPS an open-question marker is NOT refused for that — revise has no marker obligation', () => {
  const src = deriveUnits(SOURCE_TEXT, 'src');
  const ed = deriveUnits(EDITION_DROPS_MARKER, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf('revise', [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    true,
    `a revise edition may resolve an open question by deleting the marker; got: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
  assert.equal(
    result.failures.some((f) => f.kind === 'open-question-marker'),
    false,
    'no open-question-marker obligation exists in revise',
  );
  // And the marker is not counted as required payload in revise.
  assert.equal(result.payloadChecked.openQuestionMarkers, 0);
});

test('D11 (AUDIT-08): a COMPOSE edition that DROPS the same marker IS refused — the obligation is live in compose', () => {
  const src = deriveUnits(SOURCE_TEXT, 'src');
  const ed = deriveUnits(EDITION_DROPS_MARKER, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf('compose', [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false, 'compose still enforces marker byte-survival');
  const markerFailures = result.failures.filter((f) => f.kind === 'open-question-marker');
  assert.equal(markerFailures.length, 1, 'exactly the dropped marker is refused');
  assert.ok(
    markerFailures[0]?.message.includes(MARKER),
    `the failure must name the dropped marker; got: ${markerFailures[0]?.message}`,
  );
  assert.equal(result.payloadChecked.openQuestionMarkers, 1, 'compose counts the marker as required payload');
});

test('D11 (AUDIT-08): a COMPOSE edition that PRESERVES the marker bytes passes the marker obligation', () => {
  const src = deriveUnits(SOURCE_TEXT, 'src');
  const editionKeepsMarker = `Beta rewritten but still asks it. ${MARKER}\n`;
  const ed = deriveUnits(editionKeepsMarker, 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf('compose', [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.failures.some((f) => f.kind === 'open-question-marker'),
    false,
    `a preserved marker satisfies the obligation; got: ${result.failures.map((f) => f.message).join(' | ')}`,
  );
});

// AUDIT-20260730-23 companion: in revise the marker carries NO survival
// obligation, but a numeral written INSIDE the marker is still required payload
// (an ordinary prose numeral) -- so a revise edition that drops it (marker and
// numeral together) MUST be refused via the numeric multiset. The pre-fix
// extractor masked the interior numeral out of `numerics` unconditionally, so
// this dropped numeral was required by NEITHER the marker multiset (compose-only)
// NOR the numeric multiset (masked) -- silent loss. This pins the closure.
test('AUDIT-23: a REVISE edition that drops a numeral living INSIDE an open-question marker IS refused -- via the numeric multiset', () => {
  const sourceText = `Beta beat raises a question. ${MARKER_WITH_NUMERAL}\n`;
  const src = deriveUnits(sourceText, 'src');
  // The edition resolves the question AND drops `42` with it (no numeral remains).
  const ed = deriveUnits('Beta rewritten, the question resolved and the marker deleted.\n', 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf('revise', [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    false,
    `a revise edition dropping a marker-interior numeral must be refused; failures: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
  assert.ok(
    result.failures.some((f) => f.kind === 'numeric' && f.message.includes('42')),
    `the refusal must be a numeric-survival failure naming 42; got: ${result.failures
      .map((f) => `${f.kind}:${f.message}`)
      .join(' | ')}`,
  );
  // And it is NOT laundered as a marker obligation (that obligation is compose-only).
  assert.equal(
    result.failures.some((f) => f.kind === 'open-question-marker'),
    false,
    'revise carries no marker obligation -- the numeral is enforced as a plain prose numeral',
  );
});

test('AUDIT-23: a REVISE edition that PRESERVES the marker-interior numeral (in re-voiced prose) passes -- the numeral survived', () => {
  const sourceText = `Beta beat raises a question. ${MARKER_WITH_NUMERAL}\n`;
  const src = deriveUnits(sourceText, 'src');
  // The revision resolves the marker but keeps the figure 42 in the prose.
  const ed = deriveUnits('Beta rewritten: the 42-unit cohort question is now settled.\n', 'ed');
  const [s0] = src;
  const [e0] = ed;
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf('revise', [{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(
    result.ok,
    true,
    `preserving 42 in the prose satisfies the numeric obligation; failures: ${result.failures
      .map((f) => f.message)
      .join(' | ')}`,
  );
});

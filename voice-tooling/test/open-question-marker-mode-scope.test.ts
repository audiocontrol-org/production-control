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
const MARKER = '[OPEN-QUESTION: What caused the anomaly in sample 2?]';

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

// AUDIT-20260730-33 (RED-first): the open-question marker fabrication/survival
// comparison must be a MULTISET, not a Set.
//
// Before this fix both sides were deduplicated (spineMarkers was a `Set`, the
// edition scan skipped repeats via `seen`), so a spine that declares one
// `[OPEN-QUESTION: X]` and an edition that emits it N>1 times passed BOTH
// fabrication (byte-present) and survival (1 subset of N). Repeating a marker
// the spine declared once invents the extra copies -- an overclaim about how
// many unresolved questions the evidence left open. The check now compares
// counts: an edition marker whose count EXCEEDS the spine's count is fabrication
// (the surplus copies are invented), named. A legitimate 1:1 marker still passes
// (the US1 happy-path channel).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import { checkOpenQuestionFabrication } from '@/fidelity/check-open-question-fabrication.ts';
import type { CoverageLedger } from '@/schema/ledger.ts';

const MARKER = '[OPEN-QUESTION: What caused the anomaly in sample 2?]';
const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;

// The fabrication check reads only `ledger.mode`; coverage content is irrelevant.
function composeLedger(): CoverageLedger {
  return {
    version: 1,
    source: { identity: 'spine', hash: PLACEHOLDER_HASH },
    voice: { identity: 'voice', hash: PLACEHOLDER_HASH },
    mode: 'compose',
    coverage: [],
  };
}

test('checkOpenQuestionFabrication (AUDIT-33): an edition that MULTIPLIES a once-declared spine marker is REFUSED as fabrication, naming the marker', () => {
  const spine = deriveUnits(`Beta raises it. ${MARKER}\n`, 'spine'); // marker count 1
  // Two derived edition units, each carrying the marker -> edition count 2 > 1.
  const edition = deriveUnits(
    `Beta rewritten. ${MARKER}\n\nGamma also repeats it. ${MARKER}\n`,
    'ed',
  );

  const result = checkOpenQuestionFabrication(composeLedger(), spine, edition);

  assert.equal(
    result.ok,
    false,
    'an edition emitting the marker MORE times than the spine declares invents the surplus copies',
  );
  assert.ok(
    result.failures.some((f) => f.includes(MARKER)),
    `the refusal must name the multiplied marker; got: ${result.failures.join(' | ')}`,
  );
});

test('checkOpenQuestionFabrication (AUDIT-33 happy path): a legitimate 1:1 marker (spine once, edition once) still PASSES', () => {
  const spine = deriveUnits(`Beta raises it. ${MARKER}\n`, 'spine'); // count 1
  const edition = deriveUnits(`Beta rewritten, still raising it. ${MARKER}\n`, 'ed'); // count 1

  const result = checkOpenQuestionFabrication(composeLedger(), spine, edition);

  assert.equal(
    result.ok,
    true,
    `a faithful 1:1 marker must not be refused; got: ${result.failures.join(' | ')}`,
  );
  assert.deepEqual(result.failures, []);
});

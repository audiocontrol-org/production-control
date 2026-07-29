// T027 (spec 006 Polish phase, R7/FR-013): the declared `[OPEN-QUESTION: ...]`
// marker is REQUIRED payload -- its exact bytes must survive from the spine
// beat into the edition, the SAME multiset guarantee citations and numerals
// already carry (`@/payload/extract.ts`'s `openQuestionMarkers` field,
// threaded through `@/fidelity/check-op-obligations.ts`). The report's
// `open_question_markers` field (`@/fidelity/report.ts`) is a REPORTED FACT
// about whether that guarantee is ACTIVE for this spine -- `'enforced'` iff
// the spine declares at least one marker, `'none-declared'` otherwise --
// independent of whether the run ultimately passes.
//
// Drives `runFidelity` directly (mirrors `test/edition-grounding-run.test.ts`'s
// style): `buildEdition` turns a hand-authored `ModelReviseOutput` into a
// well-formed `mode: compose` ledgered edition without hand-writing YAML.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';

const SOURCE_IDENTITY = 'spine';
const MARKER = '[OPEN-QUESTION: What caused the anomaly in sample 2?]';

// A spine that DECLARES the marker in its second beat.
const SOURCE_WITH_MARKER = `Alpha beat states a fact.\n\nBeta beat raises a question. ${MARKER}\n\nGamma beat concludes.\n`;

// A spine with no marker syntax at all.
const SOURCE_WITHOUT_MARKER = 'Alpha beat states a fact.\n\nBeta beat states another fact.\n\nGamma beat concludes.\n';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function composeEdition(sourceText: string, editionBody: string): string {
  const model: ModelReviseOutput = {
    edition: editionBody,
    coverage: [
      { op: 'represented', edition_units: [0] },
      { op: 'represented', edition_units: [1] },
      { op: 'represented', edition_units: [2] },
    ],
    grounding: [
      { edition_unit: 0, basis: 'grounded', beats: [0] },
      { edition_unit: 1, basis: 'grounded', beats: [1] },
      { edition_unit: 2, basis: 'grounded', beats: [2] },
    ],
  };
  return buildEdition({
    sourceText,
    sourceIdentity: SOURCE_IDENTITY,
    sourceHash: sha256Of(sourceText),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  }).editionText;
}

test('open-question marker (R7/FR-013): a spine declaring a marker whose bytes SURVIVE into the edition passes, and the report says enforced', () => {
  const editionBody = `Alpha rewritten.\n\nBeta rewritten, still raising it. ${MARKER}\n\nGamma rewritten.\n`;
  const editionText = composeEdition(SOURCE_WITH_MARKER, editionBody);

  const result = runFidelity({
    source: SOURCE_WITH_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');
  assert.equal(
    result.report.open_question_markers,
    'enforced',
    'the spine declares a marker, so the byte-survival guarantee is active',
  );
});

test('open-question marker (R7/FR-013): a spine declaring a marker whose bytes are DROPPED from the edition FAILS fidelity, naming the marker -- the report still says enforced (the guarantee was active and checked)', () => {
  // Beta's edition paraphrases the question WITHOUT the bracketed marker syntax
  // -- the declared marker's bytes do not survive anywhere in the edition.
  const editionBody = 'Alpha rewritten.\n\nBeta rewritten, dropping the marker entirely.\n\nGamma rewritten.\n';
  const editionText = composeEdition(SOURCE_WITH_MARKER, editionBody);

  const result = runFidelity({
    source: SOURCE_WITH_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, false, 'a dropped declared open-question marker must withhold the pass verdict');
  assert.equal(result.report.verdict, undefined, 'no pass verdict when the marker does not survive');
  assert.equal(
    result.report.checks['op_obligations']?.state,
    'failed',
    'a dropped open-question marker maps to the op_obligations catch-all (no dedicated named check)',
  );
  assert.ok(
    result.failures.some((f) => f.includes('open-question marker') && f.includes(MARKER)),
    `a failure must name the dropped open-question marker; failures: ${result.failures.join('; ')}`,
  );
  assert.equal(
    result.report.open_question_markers,
    'enforced',
    'the spine DID declare a marker (the guarantee was active and checked), regardless of the failed outcome -- ' +
      'this trust-boundary field reports the SCOPE of what was checked, never whether it passed',
  );
});

test('open-question marker (R7/FR-013): a spine with NO marker syntax passes normally, and the report honestly says none-declared', () => {
  const editionBody = 'Alpha rewritten.\n\nBeta rewritten.\n\nGamma rewritten.\n';
  const editionText = composeEdition(SOURCE_WITHOUT_MARKER, editionBody);

  const result = runFidelity({
    source: SOURCE_WITHOUT_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');
  assert.equal(
    result.report.open_question_markers,
    'none-declared',
    'no marker syntax appears anywhere in the spine, so nothing is falsely claimed as enforced',
  );
});

// D3 (AUDIT-20260730-14): the unenforced-bytes hole, proven CLOSED end-to-end.
//
// A spine beat declares an open-question marker that contains a nested `[^ref-4]`
// citation and a trailing `42` AFTER that citation's inner `]`. Under the
// pre-fix extractor, `extractPayload` (raw) truncated the marker at the inner
// `]` while the numeric masker (citation-stripped) masked `42` out of numerics
// -- so `42` was required by NEITHER multiset and an edition could silently
// drop it. This drives the real `runFidelity` binary: a faithful edition PASSES,
// an edition that drops the trailing numeral inside the marker FAILS (named).
//
// The source carries a frontmatter `citation_allowlist` for `[^ref-4]` so the
// faithful edition's citation resolves (checkCitations) -- isolating the marker
// extent as the property under test.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';

const SOURCE_IDENTITY = 'spine';
const MARKER = '[OPEN-QUESTION: does [^ref-4] cover the 42-unit cohort?]';

// A spine whose second beat declares the nested-citation marker with a trailing
// numeral, plus a frontmatter allow-list for the nested citation.
const SOURCE_WITH_NESTED_MARKER =
  '---\n' +
  'citation_allowlist:\n' +
  '  - "[^ref-4]"\n' +
  '---\n' +
  'Alpha beat states a fact.\n\n' +
  `Beta beat raises it. Not settled: ${MARKER}\n\n` +
  'Gamma beat concludes.\n';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function composeEdition(editionBody: string): string {
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
    sourceText: SOURCE_WITH_NESTED_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    sourceHash: sha256Of(SOURCE_WITH_NESTED_MARKER),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  }).editionText;
}

test('D3 end-to-end: an edition preserving the nested-citation marker VERBATIM (incl. the trailing 42) passes', () => {
  const editionBody = `Alpha rewritten.\n\nBeta rewritten, still open. ${MARKER}\n\nGamma rewritten.\n`;
  const result = runFidelity({
    source: SOURCE_WITH_NESTED_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(editionBody),
  });
  assert.equal(result.decided, true, `expected decided; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
});

test('D3 end-to-end: an edition that DROPS the trailing 42 from inside the marker FAILS (the byte after the inner ] is now enforced)', () => {
  // The marker text is kept except `42` is deleted from `42-unit` -> `-unit`.
  const dropped = '[OPEN-QUESTION: does [^ref-4] cover the -unit cohort?]';
  const editionBody = `Alpha rewritten.\n\nBeta rewritten, still open. ${dropped}\n\nGamma rewritten.\n`;
  const result = runFidelity({
    source: SOURCE_WITH_NESTED_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(editionBody),
  });
  assert.equal(result.decided, true, `expected decided; failures: ${result.failures.join('; ')}`);
  assert.equal(
    result.passed,
    false,
    'dropping the trailing numeral inside the marker must withhold the pass (previously an unenforced-bytes hole)',
  );
  assert.ok(
    result.failures.some((f) => f.includes('open-question marker')),
    `a failure must name the unmet open-question marker; failures: ${result.failures.join('; ')}`,
  );
});

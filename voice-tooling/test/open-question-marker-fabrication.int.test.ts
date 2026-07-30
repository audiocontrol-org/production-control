// AUDIT-20260730-02: the FABRICATION direction of the open-question marker.
//
// Marker survival is a source-subset-of-destination containment check, so an
// edition that INVENTS `[OPEN-QUESTION: ...]` where the spine declared none used
// to pass with `open_question_markers: 'none-declared'` -- putting an
// unresolved-question claim in the spine's mouth (an overclaim about what the
// evidence left open). The fix adds a DESTINATION-side check (compose only):
// every edition marker must be byte-present in the spine, else a named refusal.
//
// Channels (channel-enumeration): compose-fabricated (FAIL, named),
// compose-faithful (PASS + check present-and-passed), revise (not-applicable).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'spine';
const MARKER = '[OPEN-QUESTION: What caused the anomaly in sample 2?]';
const FABRICATED = '[OPEN-QUESTION: Was the sample contaminated?]';

const SOURCE_WITH_MARKER = `Alpha beat states a fact.\n\nBeta beat raises a question. ${MARKER}\n\nGamma beat concludes.\n`;
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

test('AUDIT-02: a compose edition that FABRICATES an [OPEN-QUESTION:] marker absent from the spine is REFUSED, named', () => {
  // The spine declares no marker; the edition invents one in its Beta unit.
  const editionBody = `Alpha rewritten.\n\nBeta rewritten, inventing a question. ${FABRICATED}\n\nGamma rewritten.\n`;
  const result = runFidelity({
    source: SOURCE_WITHOUT_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(SOURCE_WITHOUT_MARKER, editionBody),
  });

  assert.equal(result.decided, true, `expected decided; failures: ${result.failures.join('; ')}`);
  assert.equal(
    result.passed,
    false,
    'an edition-fabricated open-question marker misrepresents the spine and must withhold the pass',
  );
  assert.equal(
    result.report.checks['open_question_fabrication']?.state,
    'failed',
    'the fabrication is a named, failed check',
  );
  assert.ok(
    result.failures.some((f) => f.includes('fabrication') && f.includes(FABRICATED)),
    `a failure must name the fabricated marker; failures: ${result.failures.join('; ')}`,
  );
});

test('AUDIT-02 (US1 happy path): a spine-declared marker LEGITIMATELY preserved by the edition still PASSES, fabrication check present-and-passed', () => {
  const editionBody = `Alpha rewritten.\n\nBeta rewritten, still raising it. ${MARKER}\n\nGamma rewritten.\n`;
  const result = runFidelity({
    source: SOURCE_WITH_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(SOURCE_WITH_MARKER, editionBody),
  });

  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(
    result.report.checks['open_question_fabrication']?.state,
    'passed',
    'a faithful compose edition records fabrication as present-and-passed',
  );
});

test('AUDIT-38: a COMPOSE ledger validated with NO requested_mode records mode_comparison none-supplied AND still RUNS the compose gates (present-and-passed) -- omission does not skip them', () => {
  // Pins the channel AUDIT-38 named: a caller that omits `requested_mode` grades
  // the edition under the ledger's own mode. For a COMPOSE ledger that must NOT
  // downgrade to revise rules -- the compose gates (edition_grounding, no_copy,
  // open_question_fabrication) must still run and clear, and mode_comparison
  // reads `none-supplied` (no independent comparison), never a silent skip.
  const editionBody = 'Alpha rewritten.\n\nBeta rewritten.\n\nGamma rewritten.\n';
  const result = runFidelity({
    source: SOURCE_WITHOUT_MARKER,
    sourceIdentity: SOURCE_IDENTITY,
    edition: composeEdition(SOURCE_WITHOUT_MARKER, editionBody),
    // No requestedMode -- standalone validation.
  });

  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');
  assert.equal(
    result.report.mode_comparison,
    'none-supplied',
    'no requested_mode was supplied, so no independent mode comparison occurred',
  );
  assert.equal(
    result.report.mode,
    'compose',
    'the compose trust-boundary mode is recorded from the ledger, not skipped',
  );
  // The load-bearing assertions: the compose gates RAN (present-and-passed),
  // proving mode_comparison being none-supplied did NOT bypass them.
  assert.equal(
    result.report.checks['edition_grounding']?.state,
    'passed',
    'edition_grounding ran and cleared -- not skipped by an omitted requested_mode',
  );
  assert.equal(
    result.report.checks['no_copy']?.state,
    'passed',
    'no_copy ran and cleared -- not skipped by an omitted requested_mode',
  );
  assert.equal(
    result.report.checks['open_question_fabrication']?.state,
    'passed',
    'open_question_fabrication ran and cleared -- not skipped by an omitted requested_mode',
  );
});

test('AUDIT-02 (revise channel): the fabrication check is NOT applicable for revise -- markers are ordinary prose there', () => {
  const result = runFidelity({
    source: readFixture('sources', 'faithful-source.md'),
    sourceIdentity: 'source-riverbank-survey',
    edition: readFixture('editions', 'faithful-edition.md'),
  });
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(
    result.report.checks['open_question_fabrication']?.state,
    'not-run',
    'revise must record the fabrication check as an explicit not-applicable state',
  );
  assert.match(String(result.report.checks['open_question_fabrication']?.reason), /revise/);
});

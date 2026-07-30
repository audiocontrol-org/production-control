// T018 (US2): the `edition_grounding` check is WIRED into the validator run
// (`@/fidelity/run.ts`), compose-only, after the source-side checks. A composed
// edition whose ledger does NOT exhaustively/exclusively account for its derived
// edition units must be REFUSED by `runFidelity` -- the pass verdict withheld,
// the offending edition unit NAMED (contracts/fidelity-mode-agreement.md check
// ordering step 4; spec 006 US2; Principle V).
//
// This is the wiring test: `checkEditionGrounding`'s own accounting is unit-
// tested in `test/check-edition-grounding.test.ts`; here we prove `runFidelity`
// actually invokes it in sequence and folds its failure into the verdict.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveUnits } from '@/units/derive.ts';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';

const SOURCE_IDENTITY = 'spine';
// Plain prose beats: no citation markers / numerals, so every source-side check
// (source_hash, ledger_structure, citation-allowlist, unit_accounting,
// op-obligations, payload) passes and the run reaches the edition-grounding step.
const SOURCE_TEXT = 'Alpha beat.\n\nBeta beat.\n\nGamma beat.\n';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

test('runFidelity (T018 US2): a compose edition with an unaccounted edition unit is REFUSED -- no pass verdict, edition_grounding failed, offending unit named', () => {
  const editionBody = 'One prose line.\n\nTwo prose line.\n\nThree prose line.\n';

  // A model output with faithful 1:1 represented coverage for all three beats
  // but grounding declared for ONLY edition units 0 and 2 -- edition unit 1
  // ("Two prose line.") is left UNACCOUNTED. `buildEdition` maps the declared
  // grounding indices faithfully (it does not itself enforce exhaustiveness), so
  // the built ledger carries two grounding records for three edition units. The
  // two present records are grounded-on-their-beat (D8-consistent with coverage),
  // so the ONLY defect is the unaccounted unit 1.
  const model: ModelReviseOutput = {
    edition: editionBody,
    coverage: [
      { op: 'represented', edition_units: [0] },
      { op: 'represented', edition_units: [1] },
      { op: 'represented', edition_units: [2] },
    ],
    grounding: [
      { edition_unit: 0, basis: 'grounded', beats: [0] },
      { edition_unit: 2, basis: 'grounded', beats: [2] },
    ],
  };

  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    sourceHash: sha256Of(SOURCE_TEXT),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  });

  const result = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, false, 'an unaccounted edition unit must withhold the pass verdict');
  assert.equal(result.report.verdict, undefined, 'no pass verdict when edition-grounding fails');
  assert.equal(
    result.report.checks['edition_grounding']?.state,
    'failed',
    'the edition_grounding named check must be present and failed',
  );

  // The failure names the specific unaccounted edition unit (occurrence 1's beat
  // in reading order -- the "Two prose line." unit).
  const editionUnits = deriveUnits(editionText, `${SOURCE_IDENTITY}#edition`);
  const unaccounted = editionUnits[1];
  assert.ok(unaccounted !== undefined, 'fixture edition must derive to 3 units');
  assert.ok(
    result.failures.some((f) => f.includes(`sha256:${unaccounted.contentHash}`)),
    `a failure must name the unaccounted edition unit; failures: ${result.failures.join('; ')}`,
  );
});

test('runFidelity (T018 US2): a fully-grounded compose edition still PASSES (the wiring does not reject a well-formed compose)', () => {
  const editionBody = 'One prose line.\n\nTwo prose line.\n\nThree prose line.\n';
  // Each edition unit is a coverage destination (represented) and therefore
  // DEMONSTRABLY carries its beat, so grounding must label it grounded-on-that-
  // beat (D8/AUDIT-21): an all-`framing` grounding for coverage-carried units is
  // a contradiction the validator now refuses, not a well-formed compose.
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

  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    sourceHash: sha256Of(SOURCE_TEXT),
    voiceIdentity: 'voice',
    voiceHash: sha256Of('voice-doc'),
    model,
    mode: 'compose',
  });

  const result = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, true, `expected a pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');
});

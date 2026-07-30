// FG-B / D9 (AUDIT-10) + D7 (AUDIT-20): the producer core refuses PARTIAL,
// DUPLICATE, and EMPTY compose grounding BEFORE any write. `checkGrounding` is
// exhaustive + exclusive over the derived edition units, so the pre-emit
// self-check (`@/revise/preflight.ts`) catches:
//   - PARTIAL grounding (fewer records than edition units): an `unaccounted`
//     refusal -- the model cannot omit the record for a unit it invented.
//   - DUPLICATE `edition_unit` (one unit declared twice, another undeclared): a
//     `duplicate` refusal.
// and `buildEdition` itself refuses:
//   - EMPTY grounding (`[]`) at the mode-aware boundary (compose requires a
//     non-empty declaration) -- distinct from revise's legitimate ABSENT.
//
// These pin the emit-time contract at the producer-core layer (value channel),
// complementing the end-to-end binary cases in
// `compose-preflight-illegal-op.int.test.ts`.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseModelOutput } from '@/revise/protocol.ts';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runPreflight } from '@/revise/preflight.ts';
import type { PreflightResult } from '@/revise/preflight.ts';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

// A 2-beat source composed into a 2-unit edition.
const SOURCE_TEXT = 'First beat body.\n\nSecond beat body.\n';
const EDITION_TEXT = 'Composed unit one.\n\nComposed unit two.\n';
const SOURCE_IDENTITY = 'draft';
const VOICE_IDENTITY = 'voice';
const SOURCE_HASH = sha256Of(SOURCE_TEXT);
const VOICE_HASH = sha256Of('voice-bytes');

const BASE_COVERAGE = [
  { op: 'represented', edition_units: [0] },
  { op: 'represented', edition_units: [1] },
];

function preflightCompose(modelJson: string): PreflightResult {
  const model = parseModelOutput(modelJson);
  const built = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    voiceIdentity: VOICE_IDENTITY,
    voiceHash: VOICE_HASH,
    sourceHash: SOURCE_HASH,
    model,
    mode: 'compose',
  });
  return runPreflight('compose', built.ledger.grounding, built.ledger.coverage, built.editionUnits, built.sourceUnits);
}

test('compose preflight (D9): PARTIAL grounding (a unit left undeclared) is REFUSED -- unaccounted', () => {
  const result = preflightCompose(
    JSON.stringify({
      edition: EDITION_TEXT,
      coverage: BASE_COVERAGE,
      // Only edition unit 0 declared; unit 1 (the invented-prose escape hatch) omitted.
      grounding: [{ edition_unit: 0, basis: 'grounded', beats: [0] }],
    }),
  );
  assert.equal(result.ok, false, 'partial grounding must be refused before write');
  assert.ok(
    result.refusals.some((message) => /has no grounding record/.test(message)),
    `refusal must name the unaccounted unit; got: ${result.refusals.join('; ')}`,
  );
});

test('compose preflight (D9): DUPLICATE edition_unit grounding is REFUSED -- duplicate', () => {
  const result = preflightCompose(
    JSON.stringify({
      edition: EDITION_TEXT,
      coverage: BASE_COVERAGE,
      // Unit 0 declared twice; unit 1 also declared, so the ONLY defect is the duplicate.
      grounding: [
        { edition_unit: 0, basis: 'grounded', beats: [0] },
        { edition_unit: 0, basis: 'grounded', beats: [0] },
        { edition_unit: 1, basis: 'grounded', beats: [1] },
      ],
    }),
  );
  assert.equal(result.ok, false, 'duplicate edition_unit grounding must be refused before write');
  assert.ok(
    result.refusals.some((message) => /has 2 records/.test(message)),
    `refusal must name the duplicated unit; got: ${result.refusals.join('; ')}`,
  );
});

test('compose preflight (D7): EMPTY grounding array is refused at the mode-aware build boundary', () => {
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model: parseModelOutput(
          JSON.stringify({ edition: EDITION_TEXT, coverage: BASE_COVERAGE, grounding: [] }),
        ),
        mode: 'compose',
      }),
    /mode 'compose' requires a non-empty grounding declaration/,
  );
});

test('compose preflight: a correct 1:1 grounding PASSES (control -- refusals are not spurious)', () => {
  const result = preflightCompose(
    JSON.stringify({
      edition: EDITION_TEXT,
      coverage: BASE_COVERAGE,
      grounding: [
        { edition_unit: 0, basis: 'grounded', beats: [0] },
        { edition_unit: 1, basis: 'grounded', beats: [1] },
      ],
    }),
  );
  assert.equal(result.ok, true, `a correct compose grounding must pass; refusals: ${result.refusals.join('; ')}`);
  assert.deepEqual(result.refusals, []);
});

// T028 (spec 006 Polish phase, SC-007): overclaim REGRESSION test, not a
// feature test -- it pins the honest trust boundary the deterministic
// fidelity gate must never cross.
//
// spec.md's own Edge Cases list names this exact scenario: "A composed
// edition where all payload survives but the prose invents a causal claim:
// passes the deterministic gate; the report states
// `composition_semantic_grounding: not-checkable` (regression protection
// against overclaiming)." FR-012 forbids the system from claiming the
// deterministic gate detects invented facts, promotional-as-fact, or
// causality -- so a byte-faithful, fully-grounded, legally-op'd edition that
// happens to ALSO assert an unsupported causal claim in its prose MUST still
// pass mechanically (the gate has no semantic-content check to fail), and the
// report must say so honestly rather than imply semantic grounding was
// proven.
//
// This test is expected to hold against the CURRENT implementation -- it does
// not exercise new behavior, it documents/guards the boundary. If it fails,
// that is a live overclaim bug (the gate reporting `passed`/`not-checkable`
// while somehow also implying semantic proof), not a reason to weaken the
// test.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';

const SOURCE_IDENTITY = 'spine';

// Three beats, each carrying one numeral -- the required payload this test
// proves survives byte-exact. None of the three beats states or implies any
// CAUSAL relationship between the crack count and the eventual repair.
const SOURCE_TEXT = [
  'The crew arrived in 1978 to begin the initial survey.',
  '',
  'Inspectors logged 12 separate cracks near the north pier.',
  '',
  'The repair work concluded after 6 months.',
  '',
].join('\n');

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

test('SC-007 overclaim regression: a byte-faithful, fully-grounded compose edition that INVENTS a causal claim still passes deterministically, and the report names the not-checkable limit honestly', () => {
  // Every beat is `represented` 1:1, exhaustively and exclusively grounded,
  // every numeral survives byte-exact, and no destination is a whole-unit copy
  // of its source beat (each is reworded). Edition unit 1 ADDITIONALLY invents
  // a causal claim ("directly caused") the source never states or implies --
  // the source beats report the crack count and the repair duration as two
  // independent facts; nothing in the spine supports a causal link between
  // them. This is exactly the invented-causality shape the deterministic gate
  // MUST NOT (and cannot) catch.
  const editionBody = [
    'The survey crew began its work in 1978.',
    '',
    'The 12 cracks near the north pier directly caused the structure to fail years later.',
    '',
    'Repairs wrapped up after 6 months of effort.',
    '',
  ].join('\n');

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

  // Sanity: the invented causal claim really is present in the edition body,
  // and really is absent from the source -- otherwise this test would not be
  // exercising the scenario it claims to.
  assert.match(editionText, /directly caused/, 'fixture must actually contain the invented causal claim');
  assert.doesNotMatch(SOURCE_TEXT, /caused/, 'the source must never state or imply the causal claim');

  const result = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });

  // The deterministic gate is mechanical: it proves payload survival, exhaustive
  // /exclusive grounding accounting, and op-legality -- NONE of which the
  // invented causal claim violates. It MUST pass, deterministically.
  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(
    result.passed,
    true,
    `the gate has no semantic-content check to fail on an invented causal claim; failures: ${result.failures.join('; ')}`,
  );
  assert.equal(result.report.verdict, 'passed');

  // Re-run to confirm the pass is DETERMINISTIC (same inputs, same outcome) --
  // not an accident of one run.
  const again = runFidelity({
    source: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    edition: editionText,
  });
  assert.deepEqual(again.report, result.report, 'the same inputs must yield the identical report deterministically');

  // The honest boundary (FR-012/SC-007): the report explicitly states the
  // deterministic gate cannot and does not prove semantic grounding -- never a
  // verdict implying the invented causal claim was validated.
  assert.equal(
    result.report.composition_semantic_grounding,
    'not-checkable',
    'the report must never claim semantic grounding was proven for a passing compose edition',
  );
  assert.equal(
    result.report.checks['semantic_claim_fidelity']?.state,
    'not-checkable',
    'the semantic_claim_fidelity check itself must also be honestly not-checkable, never passed',
  );
  assert.equal(result.report.spine_source_fidelity, 'not-checked');
});

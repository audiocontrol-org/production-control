// RED (T009): US1 integration test -- refusal cases for the deterministic
// fidelity validator, plus the distinct "cannot-decide" no-verdict outcome.
//
// `@/fidelity/run.ts` (runFidelity) does not exist yet -- T016 implements it.
// This file is expected to fail to load with a "Cannot find module" error
// until then -- the correct RED state for a test-first task. Do NOT implement
// runFidelity here; see specs/004-voice-editions/tasks.md T011-T016.
//
// Covers: spec.md User Story 1, Acceptance Scenarios 2, 3, 4, 5, 6;
// FR-017, FR-023, FR-030; SC-001, SC-003, SC-006;
// contracts/voice-fidelity-validator.md ("Behavior" ordered check sequence,
// the ValidateResponse `failed` shape, and "No-verdict exit").
//
// Each bad case is derived by MUTATING a copy of the faithful fixture pair
// (test/fixtures/{sources,editions}/faithful-*.md, established by T008 /
// fidelity-pass.test.ts) -- no new fixture files are added; the mutated
// bytes are built in-test from the faithful fixture strings so each
// derivation sits right next to the assertion it feeds.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { runFidelity } from '@/fidelity/run.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'source-riverbank-survey';

function loadFaithfulFixture(): { source: string; edition: string } {
  return {
    source: readFixture('sources', 'faithful-source.md'),
    edition: readFixture('editions', 'faithful-edition.md'),
  };
}

/**
 * Replace `search` with `replacement` in `text`, asserting `search` was
 * actually present first -- a silent no-op mutation (e.g. after an
 * unrelated fixture edit) would defeat the whole point of the test.
 */
function mustReplace(text: string, search: string, replacement: string): string {
  assert.ok(text.includes(search), `expected fixture text to contain: ${search}`);
  return text.replace(search, replacement);
}

test('fidelity-refuse (US1, Acceptance Scenario 3): a mutated verbatim destination is refused, naming the op obligation and the unit', () => {
  const { source, edition } = loadFaithfulFixture();

  // U1/E1 verbatim destination: change one byte of E1 so it no longer
  // equals U1's bytes byte-for-byte. Leaves U1's numeric literal "1978" and
  // every other unit untouched -- only the verbatim op obligation breaks.
  const mutatedEdition = mustReplace(
    edition,
    'The survey crew arrived at the crossing in 1978 to assess the retaining wall.',
    'The survey crew arriv3d at the crossing in 1978 to assess the retaining wall.',
  );

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition: mutatedEdition,
  });

  assert.equal(result.passed, false, 'a mutated verbatim destination must not pass');
  assert.equal(result.decided, true, 'this is a deterministic, decided failure -- not a no-verdict abort');
  assert.equal(result.report.verdict, undefined, 'no passed verdict is ever emitted alongside a decided failure');
  assert.ok(
    result.failures.some((f: string) => /verbatim/i.test(f) && /(differ|mismatch|byte)/i.test(f)),
    `expected a failure naming the verbatim op obligation; got: ${JSON.stringify(result.failures)}`,
  );
  assert.ok(
    result.failures.some((f: string) => /897dc094/.test(f) || /occurrence[^\n]*0/i.test(f)),
    `expected the failure to identify U1's unit (hash or occurrence); got: ${JSON.stringify(result.failures)}`,
  );
});

test('fidelity-refuse (US1, Acceptance Scenario 4, FR-023): a dropped citation marker is refused, naming citation preservation', () => {
  const { source, edition } = loadFaithfulFixture();

  // U3's citation payload `[^1]` is declared to survive at E2. Drop the
  // marker from E2 while leaving the rest of the edition (and the ledger)
  // untouched -- the citation cited by a non-cut source unit is now absent
  // from its declared destinations.
  const mutatedEdition = mustReplace(
    edition,
    "Historians credit the original engineer's calculations[^1] for the design's endurance.",
    "Historians credit the original engineer's calculations for the design's endurance.",
  );

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition: mutatedEdition,
  });

  assert.equal(result.passed, false, 'a dropped citation must not pass');
  assert.equal(result.decided, true, 'this is a deterministic, decided failure -- not a no-verdict abort');
  assert.equal(result.report.verdict, undefined);
  assert.equal(
    result.report.checks.citations?.state,
    'failed',
    'the citations check must be the one reporting the failure',
  );
  assert.ok(
    result.failures.some((f: string) => /citation/i.test(f) && f.includes('[^1]')),
    `expected a failure naming the missing [^1] citation marker; got: ${JSON.stringify(result.failures)}`,
  );
});

test('fidelity-refuse (US1, Acceptance Scenario 2, SC-001): a missing unit disposition is refused, naming the unaccounted source unit', () => {
  const { source, edition } = loadFaithfulFixture();

  // Drop U6's `cut` ledger entry entirely, leaving only 5 dispositions for
  // the fixture's 6 derived source units -- U6 is now unaccounted for.
  const mutatedEdition = mustReplace(
    edition,
    '\n    - source_unit: { hash: sha256:44bbbbea994ffd4e618da2b79ee3b40e96e23fcfd61b2822c97da4cf6dd6e4db, occurrence: 0 }\n' +
      '      op: cut\n' +
      '      reason: "restates continuity already established by the two preceding units; no new claim"',
    '',
  );

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition: mutatedEdition,
  });

  assert.equal(result.passed, false, 'a source unit with no ledger disposition must not pass');
  assert.equal(result.decided, true, 'this is a deterministic, decided failure -- not a no-verdict abort');
  assert.equal(result.report.verdict, undefined);
  assert.equal(
    result.report.checks.unit_accounting?.state,
    'failed',
    'the unit_accounting check must be the one reporting the failure',
  );
  assert.ok(
    result.failures.some((f: string) => /unit accounting|unaccounted/i.test(f) && /44bbbbea/.test(f)),
    `expected a failure naming U6's unaccounted unit; got: ${JSON.stringify(result.failures)}`,
  );
});

test('fidelity-refuse (US1, Acceptance Scenario 5, SC-003): a source.hash mismatch is refused BEFORE any unit obligation is evaluated', () => {
  const { source, edition } = loadFaithfulFixture();

  // Supply a source whose bytes differ from what the ledger's source.hash
  // was computed against -- the ledger and edition are otherwise faithful.
  // One trailing byte is enough to change the sha256.
  const mismatchedSource = `${source}\n`;
  assert.notEqual(mismatchedSource, source);

  const result = runFidelity({
    source: mismatchedSource,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
  });

  assert.equal(result.passed, false, 'a source.hash mismatch must not pass');
  assert.equal(result.decided, true, 'this is a deterministic, decided failure -- not a no-verdict abort');
  assert.equal(result.report.verdict, undefined);
  assert.equal(
    result.report.checks.source_hash?.state,
    'failed',
    'source_hash is checked first (D15) and must be the one reporting the failure',
  );
  assert.ok(
    result.failures.some((f: string) => /source hash|source\.hash/i.test(f) && /(mismatch|does not match|differ)/i.test(f)),
    `expected a failure naming the source.hash mismatch; got: ${JSON.stringify(result.failures)}`,
  );

  // No unit/op obligation may have run -- the abort happens before all of
  // them (FR-017/SC-003, D15). Each is reported `not-run`, naming
  // source_hash as the aborting check.
  const abortedChecks = [
    'ledger_structure',
    'unit_accounting',
    'verbatim_quotes',
    'citations',
    'numeric_literals',
    'lexicon',
    'uncorroborated_units',
  ] as const;
  for (const name of abortedChecks) {
    const check = result.report.checks[name];
    assert.equal(
      check?.state,
      'not-run',
      `expected "${name}" to be not-run after a source_hash abort; got: ${JSON.stringify(check)}`,
    );
    assert.match(
      String(check?.reason ?? ''),
      /aborted.*source_hash/i,
      `expected "${name}"'s not-run reason to name source_hash as the aborting check; got: ${JSON.stringify(check)}`,
    );
  }
});

test('fidelity-refuse (US1, Acceptance Scenario 6, FR-030/SC-006): an unreadable (non-UTF-8) source cannot be decided -- no verdict, distinct from a decided failure', () => {
  const { edition } = loadFaithfulFixture();

  // 0xFF and 0xFE are never valid UTF-8 leading bytes -- unambiguously
  // undecodable, not merely a mismatched-but-readable source.
  const unreadableSource = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01, 0x02]);

  const result = runFidelity({
    source: unreadableSource,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
  });

  assert.equal(result.passed, false, 'an undecidable source can never be reported as passed');
  assert.equal(
    result.decided,
    false,
    'a cannot-decide condition is NOT a decided failure -- this is the third, distinct outcome (FR-030/SC-006)',
  );
  assert.equal(
    result.report.verdict,
    undefined,
    'no verdict of any kind (passed or failed) is emitted when the validator cannot decide',
  );

  // Distinct from the four cases above: those were all `decided === true`
  // with a failure naming a specific obligation. This one is not decided at
  // all -- asserted explicitly so a future regression that collapses
  // "cannot-decide" into an ordinary decided failure is caught here.
  assert.notEqual(
    result.decided,
    true,
    'must not be reported the same way as a decided, named-obligation failure',
  );
});

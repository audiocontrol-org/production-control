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
import { createHash } from 'node:crypto';
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

test('fidelity-refuse (AUDIT-20260728-24): an unresolved destination for a NO-PAYLOAD paragraph is refused -- an absent destination can never pass, and the fault names the unresolved reference (no "survives" blessing)', () => {
  const { source, edition } = loadFaithfulFixture();

  // E3 is the shared `merged` destination for U4/U5, whose source units are
  // ordinary prose with NO extractable payload. Edit E3's bytes so its
  // content-derived identity changes -- the ledger's E3 references now resolve to
  // nothing. Pre-fix, a no-payload entry whose destination is simply ABSENT was
  // "blessed" ("the payload survives across the resolved destinations") and the
  // run's verdict could be withheld only by the removed failures.length coupling.
  // Post-fix, an unresolved reference is ALWAYS a decided failure via the
  // op_obligations catch-all, regardless of payload.
  const mutatedEdition = mustReplace(
    edition,
    "Repair crews restored the east face's mortar while leaving the west face untouched.",
    "Repair crews rebuilt the east face's mortar while leaving the west face untouched.",
  );

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition: mutatedEdition,
  });

  assert.equal(result.passed, false, 'an absent (unresolved) destination paragraph must never pass');
  assert.equal(result.decided, true, 'this is a deterministic, decided failure -- not a no-verdict abort');
  assert.equal(result.report.verdict, undefined, 'no passed verdict alongside an unresolved destination');
  assert.equal(
    result.report.checks.op_obligations?.state,
    'failed',
    'the unresolved destination flips the op_obligations catch-all check',
  );
  assert.ok(
    result.failures.some((f: string) => /not found in edition|does not resolve to an edition unit/.test(f)),
    `expected a failure naming the unresolved destination reference; got: ${JSON.stringify(result.failures)}`,
  );
  assert.equal(
    result.failures.some((f: string) => /survives across the resolved destinations/.test(f)),
    false,
    `no "survives" blessing may be emitted for an absent destination; got: ${JSON.stringify(result.failures)}`,
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
  // them (FR-017/SC-003, D15). Each is reported with the first-class `aborted`
  // state (AUDIT-20260726-14: an earlier-failure abort is its OWN blocking state,
  // not a `not-run` carrying an optional boolean that could be forgotten and fail
  // open), naming source_hash as the aborting check.
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
      'aborted',
      `expected "${name}" to be aborted after a source_hash abort; got: ${JSON.stringify(check)}`,
    );
    assert.match(
      String(check?.reason ?? ''),
      /aborted.*source_hash/i,
      `expected "${name}"'s aborted reason to name source_hash as the aborting check; got: ${JSON.stringify(check)}`,
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

test(
  'fidelity-refuse (AUDIT-20260726-18): a malformed source citation_allowlist shape is a DECIDED ' +
    'refusal, not a thrown exception -- even though source.hash still matches the (corrupted) bytes',
  () => {
    const { source, edition } = loadFaithfulFixture();

    // Corrupt ONLY the source's frontmatter: `citation_allowlist` becomes a bare string instead of
    // a list. `deriveUnits` strips the whole leading frontmatter block before deriving source
    // units (src/units/derive.ts), so this changes NEITHER the derived units nor their hashes --
    // only the full-file source.hash changes, which is why the ledger's declared hash below is
    // recomputed rather than reused verbatim.
    const corruptedSource = mustReplace(
      source,
      'citation_allowlist:\n  - "[^1]"',
      'citation_allowlist: "not-a-list"',
    );
    const corruptedSourceHash = `sha256:${createHash('sha256').update(corruptedSource, 'utf8').digest('hex')}`;

    // The ledger's declared source.hash MUST match the corrupted bytes -- this is the "source IS
    // the declared one" precondition the fix's decided-vs-cannot-decide distinction turns on.
    const patchedEdition = mustReplace(
      edition,
      'hash: sha256:7e76eae507dbe92c328efd7134f644aa2aa1819e87f8d77b77a887166c1ba503',
      `hash: ${corruptedSourceHash}`,
    );

    // The point of this test: calling runFidelity must not throw and must not produce an
    // unhandled rejection -- node:test would fail this test itself if it did.
    const result = runFidelity({
      source: corruptedSource,
      sourceIdentity: SOURCE_IDENTITY,
      edition: patchedEdition,
    });

    assert.equal(
      result.decided,
      true,
      'a malformed source allow-list, once source.hash has confirmed these ARE the declared ' +
        'bytes, is a decided refusal -- never cannot-decide and never a thrown exception',
    );
    assert.equal(result.passed, false, 'a malformed source citation allow-list must not pass');
    assert.equal(result.report.verdict, undefined);
    assert.equal(
      result.report.checks.source_hash?.state,
      'passed',
      'source_hash must still pass first -- the corrupted bytes ARE what the ledger declared',
    );
    assert.equal(
      result.report.checks.ledger_structure?.state,
      'failed',
      'the malformed source allow-list is folded into the ledger_structure check',
    );
    assert.ok(
      result.failures.some((f: string) => /citation allow-list/i.test(f) && /malformed/i.test(f)),
      `expected a failure naming the malformed source citation allow-list; got: ${JSON.stringify(result.failures)}`,
    );
  },
);

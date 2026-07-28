// RED (T010): US1 integration test -- a valid-but-thinly-corroborated edition
// PASSES, and the coverage report's `uncorroborated_units` check surfaces a
// HIGH count -- report-only, and it never lowers the verdict (D12/FR-022).
//
// `@/fidelity/run.ts` (runFidelity) does not exist yet -- T016 implements it.
// This file is expected to fail to load with a "Cannot find module" error
// until then -- the correct RED state for a test-first task. Do NOT implement
// runFidelity here; see specs/004-voice-editions/tasks.md T011-T016.
//
// Covers: spec.md User Story 1, Acceptance Scenario 3 (implicit -- see the
// Independent Test's third clause: "a valid-but-thinly-corroborated edition
// passes while the report shows a high uncorroborated-unit count"); the edge
// case "A `represented`/`merged` entry whose source unit yields no extractable
// payload passes but is recorded as `uncorroborated` with a first-class count
// -- never silently passed (D12)"; FR-022; quickstart.md Scenario S3;
// contracts/voice-fidelity-validator.md step 5 ("Payload checks" -- the
// `uncorroborated_units` `reported` state, "this never fails the run").
//
// Fixtures (voice-tooling/test/fixtures/{sources,editions}/uncorroborated-*.md):
// a fresh 10-unit source (an outpost log, subject-agnostic) and a 9-unit
// edition whose ledger accounts for every one of the 10 source units. Of the
// 9 non-`verbatim` (`represented`/`merged`) entries, 7 have source units that
// are ordinary connective prose with NO extractable payload (no blockquote,
// no citation marker, no digit, and no lexicon declared) -- a clear majority
// -- while 2 carry payload (one numeric literal, one citation marker), so the
// validator's payload machinery is still exercised and not merely inert. See
// the fixture-derivation summary below the tests for the hand-verified unit
// hashes, dispositions, and the exact accounting this relies on.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { runFidelity } from '@/fidelity/run.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'source-uncorroborated-outpost-log';

/**
 * The count of ledger entries whose op is `represented` or `merged` AND whose
 * source unit yields no extractable payload (D12/FR-022): the four plain
 * `represented` entries (U2 field notes, U3 equipment maintenance, U4 staff
 * rotation, U5 supply truck) + the two `merged` entries sharing a destination
 * (U6 morning briefing, U7 evening briefing) + the one plain `represented`
 * entry (U8 generator) = 7. This is a HIGH fraction of the fixture's 9
 * non-verbatim entries (7 of 9) while still leaving 2 payload-bearing entries
 * (U9's numeric literal "1987", U10's citation marker "[^1]") so the
 * validator's payload-matching machinery is genuinely exercised, not just
 * inert on this fixture.
 */
const EXPECTED_UNCORROBORATED_COUNT = 7;

function loadUncorroboratedFixture(): { source: string; edition: string } {
  return {
    source: readFixture('sources', 'uncorroborated-source.md'),
    edition: readFixture('editions', 'uncorroborated-edition.md'),
  };
}

test('fidelity-uncorroborated (US1, Acceptance Scenario 3 / quickstart S3, D12/FR-022): a valid-but-thinly-corroborated edition PASSES, and the report surfaces a high uncorroborated count that never lowers the verdict', () => {
  const { source, edition } = loadUncorroboratedFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
    // No lexicon declared -- deliberately, so the fixture's no-payload prose
    // truly has nothing extractable (not even an entity a lexicon would catch).
  });

  // The edition PASSES despite most of its non-verbatim entries being
  // uncorroborated -- vacuity is never grounds for refusal (D12).
  assert.equal(result.passed, true, 'a thinly-corroborated but structurally faithful edition must still pass');
  assert.equal(result.decided, true, 'the validator reached a decision (not a no-verdict abort)');
  assert.deepEqual(result.failures, [], 'no obligation failed -- a high uncorroborated count is not a failure');
  assert.equal(result.report.verdict, 'passed', 'top-level verdict is passed (D15/FR-025) even though corroboration is thin');

  const { checks } = result.report;

  // Every source unit is accounted for (10 units: 1 verbatim + 9 represented/merged).
  assert.equal(checks.unit_accounting?.state, 'passed');
  assert.equal(checks.unit_accounting?.['total'], 10);

  // The single payload-bearing citation and numeral each survive at their
  // declared destinations -- proof the payload machinery actually ran on this
  // fixture rather than having nothing to check.
  assert.equal(checks.citations?.state, 'passed');
  assert.equal(checks.citations?.['checked'], 1);
  assert.equal(checks.numeric_literals?.state, 'passed');
  assert.equal(checks.numeric_literals?.['checked'], 1);

  // No lexicon input was declared for this fixture -- reported not-run, never
  // silently skipped (FR-020), consistent with "no lexicon declared" above.
  assert.equal(checks.lexicon?.state, 'not-run');

  // -------------------------------------------------------------------
  // The core assertion pair this test exists to make: a HIGH count, AND
  // still passed -- both facts asserted TOGETHER so a future regression that
  // either (a) hides the weak-corroboration signal, or (b) starts treating a
  // high count as a failure, is caught here.
  // -------------------------------------------------------------------

  // Not silently clean: uncorroborated_units is explicitly present in
  // `checks` -- never omitted -- with state `reported` (D12's report-only
  // state, distinct from `passed`/`not-run`/`not-checkable`) and a POSITIVE
  // count (never `passed` with a count of 0 hiding the weakness).
  assert.ok(
    Object.prototype.hasOwnProperty.call(checks, 'uncorroborated_units'),
    'coverage report must enumerate the "uncorroborated_units" check even when the run passes (FR-025/SC-004)',
  );
  assert.equal(checks.uncorroborated_units?.state, 'reported');
  assert.ok(
    typeof checks.uncorroborated_units?.['count'] === 'number' &&
      (checks.uncorroborated_units['count'] as number) > 0,
    `expected a positive uncorroborated count; got: ${JSON.stringify(checks.uncorroborated_units)}`,
  );

  // The count is not just "positive" -- it is the SPECIFIC high value this
  // fixture was constructed to produce (7 of 9 non-verbatim entries, D12).
  assert.equal(
    checks.uncorroborated_units?.['count'],
    EXPECTED_UNCORROBORATED_COUNT,
    `expected uncorroborated_units.count to equal the fixture's known no-payload entry count (${EXPECTED_UNCORROBORATED_COUNT})`,
  );

  // Restated as its own explicit pair, per the task: HIGH count and PASSED
  // verdict must both hold at once -- the count is report-only and NEVER
  // lowers the verdict (D12/FR-022), regardless of how high it is.
  assert.ok(
    (checks.uncorroborated_units?.['count'] as number) >= EXPECTED_UNCORROBORATED_COUNT,
    'the uncorroborated count must be at the fixture-constructed high value',
  );
  assert.equal(result.report.verdict, 'passed', 'a high uncorroborated count must never lower the verdict (D12/FR-022)');
});

// ---------------------------------------------------------------------------
// Fixture-derivation summary (hand-verified; for T016's benefit)
// ---------------------------------------------------------------------------
//
// Verified by running `deriveUnits`/`loadLedger` (already implemented, T004/
// T005) against these exact fixture bytes in a scratch script -- NOT by hand
// -- then hand-cross-checked below that every derived source unit appears in
// the ledger exactly once, every edition_units reference resolves to an
// actual derived edition unit, and the ledger loads without throwing
// (structurally valid per D20). The scratch script was deleted after use; it
// is not part of this commit.
//
// SOURCE (uncorroborated-source.md), sourceIdentity =
// 'source-uncorroborated-outpost-log', source.hash =
// sha256:992db3f6e4082c6735569684fb93c0d9d282609b9ee8b3942c12b2cb2ba7f440
// (sha256 of the FULL source file bytes, frontmatter included).
//
//   U1  verbatim    sha256:0d81f53d...4cce696 "Rain fell steadily against the
//                   observation post through the night shift."
//                   -> edition_units: [E1] (byte-identical to U1)
//   U2  represented sha256:6bd8875d...81c430d61 "Field notes accumulated
//                   slowly over the following weeks." (no extractable payload)
//                   -> edition_units: [E2]
//   U3  represented sha256:1dd2869c...560d1ea17efd22 "The equipment required
//                   routine maintenance twice a season." (no payload)
//                   -> edition_units: [E3]
//   U4  represented sha256:5ab9efbc...743a727ffb204b89 "Local staff rotated
//                   through the outpost on a fixed schedule." (no payload)
//                   -> edition_units: [E4]
//   U5  represented sha256:a4968468...9758952e44490d76 "Supplies arrived by
//                   truck along the gravel road." (no payload)
//                   -> edition_units: [E5]
//   U6  merged      sha256:dc13730f...faea5871c2fcbbb607 "Morning briefings
//                   covered weather and staffing." (no payload)
//                   -> edition_units: [E6] (SHARED with U7)
//   U7  merged      sha256:22545c74...342ab0efcb24313b745 "Evening briefings
//                   covered maintenance and supplies." (no payload)
//                   -> edition_units: [E6] (SHARED with U6 -- the shared
//                      destination that makes `merged` mechanically distinct
//                      from `represented`, D8)
//   U8  represented sha256:ec72f38c...43ae2cd02f65f8bf04 "The generator ran
//                   without incident for most of the term." (no payload)
//                   -> edition_units: [E7]
//   U9  represented sha256:87dc6df8...e4abe0c2687b87af9 "The station logged a
//                   record temperature drop in 1987." (numeric-literal
//                   payload "1987")
//                   -> edition_units: [E8] ("By 1987 the station had logged
//                      its coldest reading on record." -- "1987" preserved)
//   U10 represented sha256:f0ff0b4d...881a242dad0f29ae7 "The original survey
//                   established the boundary marker[^1]." (citation payload
//                   "[^1]", listed in the source's own frontmatter
//                   `citation_allowlist`)
//                   -> edition_units: [E9] ("Surveyors originally established
//                      the boundary marker[^1]." -- "[^1]" preserved)
//
// EDITION (uncorroborated-edition.md body, after frontmatter strip):
//
//   E1 sha256:0d81f53d...4cce696   "Rain fell steadily against the
//      observation post through the night shift." (== U1, verbatim)
//   E2 sha256:9f4b011e...fea56b26de032 "Weeks passed as field notes slowly
//      piled up."
//   E3 sha256:0975bbe6...78688767ed8e99fabf7fb0c5 "Routine maintenance kept
//      the equipment running each season."
//   E4 sha256:228072b8...f49a66f050aaa6830 "Staff rotated through the outpost
//      according to a fixed schedule."
//   E5 sha256:4584f51a...b5e2862e59324fcfb "A truck delivered supplies along
//      the gravel road."
//   E6 sha256:0dd86f4d...4763a4f04e95f380dd "Briefings each morning and
//      evening covered weather, staffing, maintenance, and supplies." (merged
//      destination for both U6 and U7)
//   E7 sha256:8e0161f1...421b8970ec72c301d "The generator kept running
//      without incident through most of the term."
//   E8 sha256:f5aad3ef...ba288b027e1b275ffa "By 1987 the station had logged
//      its coldest reading on record." (numeral "1987" intact)
//   E9 sha256:974ec930...729e747961e18e0f "Surveyors originally established
//      the boundary marker[^1]." (citation "[^1]" intact)
//
// Manual accounting check performed (via scratch script, not committed):
//   - All 10 source-unit keys (hash:occurrence) appear in the ledger's
//     coverage list exactly once each -- no missing, no duplicate (confirmed
//     via a `sourceKeys`/`ledgerKeys` set-difference in both directions --
//     both empty).
//   - Every entry's edition_units reference resolves to an actual edition
//     unit derived from the full edition file (confirmed via an
//     `editionKeys` set membership check for every edition_units ref --
//     zero unresolved).
//   - `loadLedger` accepts the ledger's YAML (extracted from the frontmatter's
//     `ledger:` sub-tree, re-serialized, per the established T008 fixture
//     convention) without throwing: known op set, verbatim carries exactly
//     one destination, the two merged entries share destination E6, no entry
//     carries both edition_units and reason.
//   - Of the 9 non-verbatim (represented/merged) entries, exactly 7 (U2, U3,
//     U4, U5, U6, U7, U8) have source-unit content containing no blockquote
//     marker, no citation marker, no digit character, and (no lexicon being
//     declared) no lexicon term -- i.e. no extractable payload under any
//     payload check this validator runs. The other 2 (U9, U10) each carry
//     exactly one payload instance, and each survives at its declared,
//     single destination.

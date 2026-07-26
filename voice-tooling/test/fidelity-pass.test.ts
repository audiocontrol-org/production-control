// RED (T008): US1 integration test -- a faithful fixture edition passes the
// deterministic fidelity validator, plus the D22 corroborate-not-infer
// regression guard.
//
// `@/fidelity/run.ts` (runFidelity) does not exist yet -- T016 implements it.
// This file is expected to fail to load with a "cannot find module" error
// until then -- the correct RED state for a test-first task. Do NOT implement
// runFidelity here; see specs/004-voice-editions/tasks.md T011-T016.
//
// Covers: spec.md User Story 1, Acceptance Scenario 1; quickstart.md
// Scenario S1; FR-017/018/020/022/025; SC-001/002/004;
// contracts/voice-fidelity-validator.md ("Behavior" step sequence + the
// "Corroboration, never inference" (D22) section); data-model.md "Coverage
// report" / CheckState invariant (SC-004).
//
// Fixtures (voice-tooling/test/fixtures/{sources,editions}/faithful-*.md):
// a 6-unit source draft (`faithful-source.md`) and a 4-unit edition
// (`faithful-edition.md`) whose frontmatter ledger accounts for every one of
// the 6 source units. See the fixture-derivation summary below the tests for
// the hand-verified unit hashes and dispositions -- this is the manual
// verification T016 can rely on without re-deriving the fixture from scratch.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { runFidelity } from '@/fidelity/run.ts';
import { readFixture } from './support.ts';

const SOURCE_IDENTITY = 'source-riverbank-survey';

/**
 * The 10 checks named in contracts/voice-fidelity-validator.md's coverage-report
 * example and data-model.md's CheckState table. FR-025/SC-004 requires every
 * one of these be named in the report, whether or not it actually ran.
 */
const EXPECTED_CHECK_NAMES = [
  'source_hash',
  'ledger_structure',
  'unit_accounting',
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
  'semantic_claim_fidelity',
  'voice_conformance',
] as const;

function loadFaithfulFixture(): { source: string; edition: string } {
  return {
    source: readFixture('sources', 'faithful-source.md'),
    edition: readFixture('editions', 'faithful-edition.md'),
  };
}

test('fidelity-pass (US1, quickstart S1): a faithful fixture edition passes, and the coverage report enumerates every applicable check', () => {
  const { source, edition } = loadFaithfulFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
    // No lexicon declared and no quote bank declared for this fixture --
    // exercises the `lexicon: not-run` path (FR-020) and exact-block quote
    // preservation rather than quote-bank identity semantics (FR-024/D14).
  });

  assert.equal(result.passed, true, 'a faithful edition must pass');
  assert.equal(result.decided, true, 'the validator reached a decision (not a no-verdict abort)');
  assert.deepEqual(result.failures, [], 'no obligation failed');
  assert.equal(result.report.verdict, 'passed', 'top-level verdict is passed (D15/FR-025)');

  const { checks } = result.report;

  // FR-025/SC-004: every applicable check is NAMED, whether or not it ran.
  for (const name of EXPECTED_CHECK_NAMES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(checks, name),
      `coverage report must enumerate the "${name}" check (FR-025/SC-004)`,
    );
  }

  // source.hash matches the supplied source draft's hash -- checked first (FR-017, D15).
  assert.equal(checks.source_hash?.state, 'passed');

  // The ledger is structurally valid (D20) -- known op set, no duplicate
  // dispositions, merged's shared-destination condition satisfied, cut's
  // reason non-empty.
  assert.equal(checks.ledger_structure?.state, 'passed');

  // Every one of the fixture's 6 derived source units carries exactly one
  // ledger entry (SC-001).
  assert.equal(checks.unit_accounting?.state, 'passed');
  assert.equal(checks.unit_accounting?.['total'], 6);

  // The blockquote unit's payload (the exact quoted line) survives at its
  // declared destination -- exact-block preservation since no quote bank is
  // declared (FR-024/D14).
  assert.equal(checks.verbatim_quotes?.state, 'passed');
  assert.equal(checks.verbatim_quotes?.['checked'], 1);

  // The citation marker `[^1]` survives at its declared destination, and it
  // resolves within the source's own frontmatter `citation_allowlist` (D13.4).
  assert.equal(checks.citations?.state, 'passed');
  assert.equal(checks.citations?.['checked'], 1);

  // The numeric literal "1978" survives (trivially, via the verbatim entry).
  assert.equal(checks.numeric_literals?.state, 'passed');
  assert.equal(checks.numeric_literals?.['checked'], 1);

  // No lexicon input was declared -- entity survival is reported not-run,
  // never silently skipped and never a false pass (FR-020).
  assert.equal(checks.lexicon?.state, 'not-run');
  assert.match(String(checks.lexicon?.reason ?? ''), /lexicon/i);

  // The two `merged` entries (the east-face/west-face units) yield no
  // extractable payload -- they pass, but are counted as uncorroborated,
  // never silently passed without a trace (D12/FR-022).
  assert.equal(checks.uncorroborated_units?.state, 'reported');
  assert.equal(checks.uncorroborated_units?.['count'], 2);

  // The validator never claims semantic or voice-conformance equivalence --
  // always not-checkable, by design, in v1 (D4/D16/FR-026).
  assert.equal(checks.semantic_claim_fidelity?.state, 'not-checkable');
  assert.ok(String(checks.semantic_claim_fidelity?.reason ?? '').length > 0);
  assert.equal(checks.voice_conformance?.state, 'not-checkable');
  assert.ok(String(checks.voice_conformance?.reason ?? '').length > 0);
});

test('fidelity-pass D22 regression guard: a represented entry whose payload lands at an editorially "wrong" destination still PASSES -- the validator corroborates the declared mapping, it never infers a better one', () => {
  // --------------------------------------------------------------------
  // WHY THIS TEST EXISTS (read this before "fixing" it):
  //
  // The fixture edition (faithful-edition.md) deliberately relocates the
  // source's blockquote unit (source unit #2, "The bridge held through the
  // first flood...") to the LAST edition unit, after the two merged units
  // that report on repair work. A human editor revising this narration would
  // almost certainly keep the quote near the opening claim it supports (its
  // source-order position, right after unit #1) -- placing it dead last,
  // after the repair paragraph, is editorially backwards.
  //
  // The ledger's `represented` entry for this unit still declares that same
  // last-position edition unit as its ONLY destination, and the quoted
  // payload survives there byte-for-byte. Per D22/FR-018, the validator's
  // job is to corroborate that DECLARED destination -- confirm it exists and
  // that the payload survives within it -- and NOTHING else. It must never
  // ask "wouldn't this quote read better up near unit #1?" and it must never
  // scan the edition for a "more sensible" destination the producer didn't
  // declare. Editorial judgment about placement is explicitly out of scope
  // (D4/D15) -- only accounting completeness and literal-payload survival are
  // proven.
  //
  // This test is a REGRESSION GUARD: a future maintainer "improving" the
  // validator to flag or infer placement would break this test. That
  // breakage is the point -- it is a trust-boundary violation, not a bug
  // fix. If this test ever needs to change to make placement matter, that is
  // a spec change (a new FR), not a quiet implementation "improvement".
  // --------------------------------------------------------------------

  const { source, edition } = loadFaithfulFixture();

  const result = runFidelity({
    source,
    sourceIdentity: SOURCE_IDENTITY,
    edition,
  });

  assert.equal(
    result.passed,
    true,
    'a represented entry satisfying its payload obligation at an editorially "wrong" declared destination must still pass (D22)',
  );
  assert.equal(result.report.verdict, 'passed');
  assert.equal(
    result.report.checks.verbatim_quotes?.state,
    'passed',
    'the relocated quote\'s payload obligation is satisfied at its declared (if oddly placed) destination',
  );
});

// ---------------------------------------------------------------------------
// Fixture-derivation summary (hand-verified; for T016's benefit)
// ---------------------------------------------------------------------------
//
// Verified by running `deriveUnits`/`loadLedger` (already implemented, T004/
// T005) against these exact fixture bytes in a scratch step -- NOT by hand
// -- then hand-cross-checked below that every derived source unit appears
// in the ledger exactly once and every edition_units reference resolves.
//
// SOURCE (faithful-source.md), sourceIdentity = 'source-riverbank-survey',
// source.hash = sha256:7e76eae507dbe92c328efd7134f644aa2aa1819e87f8d77b77a887166c1ba503
// (this is sha256 of the FULL source file bytes, frontmatter included --
// `source.hash` is checked against the whole supplied `source` string, not a
// derived unit).
//
//   U1 verbatim    sha256:897dc094...883aa "The survey crew arrived at the
//                  crossing in 1978 to assess the retaining wall."
//                  -> edition_units: [E1] (byte-identical to U1)
//   U2 represented sha256:fe593a9b...81dc2 "> The bridge held through the
//                  first flood, and every flood after." (blockquote / quote
//                  payload)
//                  -> edition_units: [E4] (LAST edition unit -- deliberately
//                     relocated; see the D22 regression-guard test above)
//   U3 represented sha256:a0a15611...39a2759 "Local records credited the
//                  original engineer's calculations[^1]." (citation payload
//                  `[^1]`, listed in the source's own frontmatter
//                  `citation_allowlist`)
//                  -> edition_units: [E2] (paraphrase preserving `[^1]`)
//   U4 merged      sha256:bba3e37e...f6ee653 "The wall's east face needed new
//                  mortar." (no extractable payload)
//                  -> edition_units: [E3]
//   U5 merged      sha256:a650949a...34765a0 "The wall's west face was
//                  untouched." (no extractable payload)
//                  -> edition_units: [E3] (SHARED with U4 -- this shared
//                     destination is what makes `merged` mechanically
//                     distinct from `represented`, D8)
//   U6 cut         sha256:44bbbbea...6dd6e4db "No one moved the marker stone
//                  during the rebuild."
//                  -> no destination; reason: "restates continuity already
//                     established by the two preceding units; no new claim"
//
// EDITION (faithful-edition.md body, after frontmatter strip),
// editionIdentity used by the validator is whatever it derives internally;
// unit content/hashes below were computed against the raw body text and
// re-confirmed against the FULL edition file (frontmatter + body) to prove
// the ledger's own bytes do not perturb them (D7/FR-011):
//
//   E1 sha256:897dc094...883aa "The survey crew arrived at the crossing in
//      1978 to assess the retaining wall." (== U1, verbatim)
//   E2 sha256:f6ede45a...51dc00 "Historians credit the original engineer's
//      calculations[^1] for the design's endurance." (citation `[^1]` intact)
//   E3 sha256:a4975ee9...30e5cf9 "Repair crews restored the east face's
//      mortar while leaving the west face untouched." (merged destination
//      for both U4 and U5)
//   E4 sha256:fe593a9b...81dc2 "> The bridge held through the first flood,
//      and every flood after." (== U2, the relocated quote)
//
// Manual accounting check performed (via scratch script, not committed):
//   - All 6 source-unit keys (hash:occurrence) appear in the ledger's
//     coverage list exactly once each -- no missing, no duplicate.
//   - Every non-cut entry's edition_units reference resolves to an actual
//     edition unit derived from the full edition file.
//   - U1's content is byte-identical to E1's content (verbatim obligation).
//   - U2's content is byte-identical to E4's content (quote payload
//     obligation, satisfied at the relocated destination).
//   - `loadLedger` accepts the ledger's YAML without throwing (structurally
//     valid: known op set, verbatim has exactly one destination, merged's
//     two entries share destination E3, cut carries a non-empty reason and
//     no destination).

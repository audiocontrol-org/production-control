import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { CheckResult, CoverageReport } from '@/fidelity/report.ts';
import {
  passed,
  notRun,
  aborted,
  reported,
  notCheckable,
  failed,
  computeVerdict,
} from '@/fidelity/report.ts';

/**
 * A complete required-check set, every entry in a NON-blocking passing state, for
 * verdict tests that isolate a single dimension. Because `computeVerdict` now
 * refuses a verdict unless every REQUIRED_CHECKS key is present (AUDIT-13/-16),
 * verdict tests must supply the full vocabulary; callers override the one or two
 * checks whose state the test is actually about.
 */
function fullChecks(
  overrides: Record<string, CheckResult> = {},
): Record<string, CheckResult> {
  return {
    // mode_agreement is required (AUDIT-15) and emitted on every decided run.
    mode_agreement: passed({ mode_comparison: 'none-supplied' }),
    source_hash: passed(),
    ledger_structure: passed(),
    unit_accounting: passed({ total: 57 }),
    verbatim_quotes: passed({ checked: 10 }),
    citations: passed({ mode: 'multiset', checked: 11 }),
    numeric_literals: passed({ checked: 8 }),
    lexicon: notRun('no lexicon declared'),
    uncorroborated_units: reported({ count: 6 }),
    semantic_claim_fidelity: notCheckable(
      'not provable under D4 — declared out of scope for v1',
    ),
    voice_conformance: notCheckable(
      'not provable under D16 — declared out of scope for v1',
    ),
    ...overrides,
  };
}

test('coverage-report: passed() helper constructs a passed CheckResult', () => {
  const result = passed();
  assert.equal(result.state, 'passed');
  assert.equal(result.reason, undefined);
});

test('coverage-report: passed() helper accepts count fields', () => {
  const result = passed({ total: 57, checked: 50 });
  assert.equal(result.state, 'passed');
  assert.equal(result.total, 57);
  assert.equal(result.checked, 50);
});

test('coverage-report: notRun() helper constructs a not-run CheckResult with reason', () => {
  const result = notRun('no lexicon declared');
  assert.equal(result.state, 'not-run');
  assert.equal(result.reason, 'no lexicon declared');
});

test('coverage-report: notRun() helper accepts additional fields', () => {
  const result = notRun('skipped due to missing input', { attempted: false });
  assert.equal(result.state, 'not-run');
  assert.equal(result.reason, 'skipped due to missing input');
  assert.equal(result.attempted, false);
});

test('coverage-report: reported() helper constructs a reported CheckResult', () => {
  const result = reported();
  assert.equal(result.state, 'reported');
  assert.equal(result.reason, undefined);
});

test('coverage-report: reported() helper accepts count fields', () => {
  const result = reported({ count: 6 });
  assert.equal(result.state, 'reported');
  assert.equal(result.count, 6);
});

test('coverage-report: notCheckable() helper constructs a not-checkable CheckResult with reason', () => {
  const result = notCheckable(
    'not provable under D4 — declared out of scope for v1',
  );
  assert.equal(result.state, 'not-checkable');
  assert.equal(result.reason, 'not provable under D4 — declared out of scope for v1');
});

test('coverage-report: notCheckable() helper accepts additional fields', () => {
  const result = notCheckable('out of scope', { scope: 'v1' });
  assert.equal(result.state, 'not-checkable');
  assert.equal(result.reason, 'out of scope');
  assert.equal(result.scope, 'v1');
});

test('coverage-report: failed() helper constructs a failed CheckResult with reason', () => {
  const result = failed('destination bytes differ from source unit bytes');
  assert.equal(result.state, 'failed');
  assert.equal(result.reason, 'destination bytes differ from source unit bytes');
});

test('coverage-report: failed() helper accepts additional fields', () => {
  const result = failed('citation does not survive', { checked: 3 });
  assert.equal(result.state, 'failed');
  assert.equal(result.reason, 'citation does not survive');
  assert.equal(result.checked, 3);
});

test('coverage-report (AUDIT-14): aborted() helper constructs an aborted CheckResult with reason', () => {
  const result = aborted('aborted: source_hash failed');
  assert.equal(result.state, 'aborted');
  assert.equal(result.reason, 'aborted: source_hash failed');
});

test('coverage-report (AUDIT-14): aborted() helper accepts additional fields', () => {
  const result = aborted('aborted: ledger_structure failed', { after: 'ledger_structure' });
  assert.equal(result.state, 'aborted');
  assert.equal(result.reason, 'aborted: ledger_structure failed');
  assert.equal(result.after, 'ledger_structure');
});

test('verdict-invariant: full required set, all checks passed → verdict is passed', () => {
  // Re-pointed for AUDIT-13/-16: a verdict now requires the FULL required-check
  // vocabulary present. The original partial `{ source_hash, ledger_structure,
  // unit_accounting }` would (correctly, now) yield no verdict; the coverage this
  // test provides — "every present check passing yields passed" — is preserved by
  // supplying the complete required set.
  const report: CoverageReport = { checks: fullChecks() };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + inapplicable not-run (no lexicon) → verdict is passed', () => {
  // The dimension under test is "an inapplicable lexicon not-run does not block".
  // `fullChecks()` already sets lexicon to `not-run('no lexicon declared')`, so the
  // full required set is present with a not-run lexicon → passed.
  const report: CoverageReport = { checks: fullChecks() };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + reported count + inapplicable not-run → verdict is passed', () => {
  // Dimension under test: a `reported` uncorroborated count does not block. The full
  // required set already carries `uncorroborated_units: reported(...)` and a not-run
  // lexicon.
  const report: CoverageReport = { checks: fullChecks() };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + not-checkable (out of scope) → verdict is passed', () => {
  // Dimension under test: the declared-out-of-scope `not-checkable` checks do not
  // block. The full required set already carries both as `not-checkable`.
  const report: CoverageReport = { checks: fullChecks() };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant (AUDIT-13/-16): a report missing a required key yields NO verdict even when every present check passed', () => {
  // Regression guard for the missing-required-check false pass: start from the full
  // required set (which passes), then DROP one required obligation — as an
  // orchestrator early-return, a key typo, or a check behind a false condition would.
  // Every remaining check still passes, yet the verdict must be withheld because the
  // dropped obligation never ran.
  const withoutUnitAccounting = fullChecks();
  delete withoutUnitAccounting['unit_accounting'];
  assert.equal(computeVerdict({ checks: withoutUnitAccounting }), undefined);

  // The specific class the audit named — a key TYPO (`unitAccounting` instead of
  // `unit_accounting`) — presents to `computeVerdict` as the required key simply
  // being absent, so it is caught by the same guard.
  const typoedKey = fullChecks();
  delete typoedKey['unit_accounting'];
  typoedKey['unitAccounting'] = passed({ total: 57 });
  assert.equal(computeVerdict({ checks: typoedKey }), undefined);
});

test('verdict-invariant (AUDIT-14): an `aborted` check (earlier failure) → no verdict', () => {
  // Re-pointed to the discriminated-state model: an earlier-failure abort is now a
  // first-class `state: 'aborted'`, not a `not-run` carrying an `aborted: true`
  // boolean. `computeVerdict` still never sniffs `reason` text — it blocks on the
  // explicit `aborted` STATE. The full required set is present so the ONLY reason a
  // verdict is withheld is the aborted state.
  const report: CoverageReport = {
    checks: fullChecks({
      ledger_structure: aborted('aborted: source_hash failed'),
      unit_accounting: aborted('aborted: source_hash failed'),
    }),
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, undefined);
});

test('verdict-invariant (AUDIT-14): a `not-run` (inapplicable) NEVER blocks, even with an "aborted"-sounding reason string', () => {
  // `not-run` now unambiguously means "inapplicable" and can never block — there is
  // no longer any boolean flag that could turn a not-run into a blocker. A not-run
  // whose reason text happens to mention "aborted"/"failed" is still inapplicable and
  // does not block (no reason-sniffing). Full required set present → passed.
  const report: CoverageReport = {
    checks: fullChecks({
      lexicon: notRun(
        'not applicable — an earlier prototype aborted this path, but this check is simply not applicable',
      ),
    }),
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: complex realistic report with all check types → verdict is passed', () => {
  // Mirrors the validator contract example closely
  const report: CoverageReport = {
    checks: {
      mode_agreement: passed({ mode_comparison: 'none-supplied' }),
      source_hash: passed(),
      ledger_structure: passed(),
      unit_accounting: passed({ total: 57 }),
      verbatim_quotes: passed({ checked: 10 }),
      citations: passed({ mode: 'multiset', checked: 11 }),
      numeric_literals: passed({ checked: 8 }),
      lexicon: notRun('no lexicon declared'),
      uncorroborated_units: reported({ count: 6 }),
      semantic_claim_fidelity: notCheckable(
        'not provable under D4 — declared out of scope for v1',
      ),
      voice_conformance: notCheckable(
        'not provable under D16 — declared out of scope for v1',
      ),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: a decided failed() check → no verdict', () => {
  // Isolates the `failed`-blocks dimension: full required set present, one obligation
  // overridden to `failed`. (A bare partial report would now also yield undefined via
  // the missing-key guard; overriding on the full set keeps this test about `failed`.)
  const report: CoverageReport = {
    checks: fullChecks({
      unit_accounting: failed('some obligation was not satisfied'),
    }),
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, undefined);
});

test('verdict-invariant (AUDIT-14): multiple aborted checks → no verdict', () => {
  const report: CoverageReport = {
    checks: fullChecks({
      ledger_structure: aborted('aborted: source validation failed'),
      unit_accounting: aborted('aborted: source validation failed'),
    }),
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, undefined);
});

test('report interface: verdict is optional in CoverageReport', () => {
  const reportWithoutVerdict: CoverageReport = {
    checks: {
      source_hash: passed(),
    },
  };

  assert.equal(reportWithoutVerdict.verdict, undefined);

  const reportWithVerdict: CoverageReport = {
    verdict: 'passed',
    checks: {
      source_hash: passed(),
    },
  };

  assert.equal(reportWithVerdict.verdict, 'passed');
});

test('check-result: index signature permits arbitrary count fields', () => {
  // Verify that TypeScript's index signature allows unknown count fields
  const result: CheckResult = passed({
    total: 100,
    checked: 95,
    mode: 'multiset',
    customField: 'value',
    nestedData: { nested: true },
  });

  assert.equal(result.state, 'passed');
  assert.equal(result.total, 100);
  assert.equal(result.checked, 95);
  assert.equal(result.mode, 'multiset');
  assert.equal(result.customField, 'value');
  assert.deepEqual(result.nestedData, { nested: true });
});

test('sc-004-invariant: document the invariant clearly', () => {
  /**
   * SC-004 Invariant: a `passed` top-level verdict never appears alongside
   * an unrun *applicable* obligation.
   *
   * - An obligation that is inapplicable (no lexicon declared) is correctly
   *   `not-run`, not a violation of this invariant.
   * - The invariant is about *applicable* checks being silently skipped, not
   *   about every possible check having actually executed.
   * - A `reported` count does NOT block `passed`.
   * - A `not-checkable` check that is declared out of scope (D4, D16) does NOT block `passed`.
   * - An abort (earlier check failure) producing the `aborted` state DOES block `passed`.
   * - A report MISSING a required obligation yields NO verdict (AUDIT-13/-16).
   *
   * All dimensions are exercised on the FULL required-check set (with a single
   * override) so each assertion isolates the one state it is about — rather than
   * being confounded by the missing-required-key guard.
   */

  // Test: inapplicable not-run is OK (fullChecks() already carries a not-run lexicon)
  assert.equal(computeVerdict({ checks: fullChecks() }), 'passed');

  // Test: reported is OK (fullChecks() already carries a reported uncorroborated count)
  const withReported: CoverageReport = {
    checks: fullChecks({ uncorroborated_units: reported({ count: 5 }) }),
  };
  assert.equal(computeVerdict(withReported), 'passed');

  // Test: not-checkable is OK (fullChecks() already carries the two not-checkable checks)
  assert.equal(computeVerdict({ checks: fullChecks() }), 'passed');

  // Test: an `aborted` state blocks the verdict
  const withAbort: CoverageReport = {
    checks: fullChecks({ ledger_structure: aborted('aborted: source_hash failed') }),
  };
  assert.equal(computeVerdict(withAbort), undefined);

  // Test: a decided failed() check also blocks the verdict
  const withFailed: CoverageReport = {
    checks: fullChecks({ unit_accounting: failed('unaccounted source unit') }),
  };
  assert.equal(computeVerdict(withFailed), undefined);

  // Test: a MISSING required obligation yields no verdict, even though every present
  // check passes
  const missingRequired = fullChecks();
  delete missingRequired['citations'];
  assert.equal(computeVerdict({ checks: missingRequired }), undefined);
});

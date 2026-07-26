import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { CheckResult, CoverageReport } from '@/fidelity/report.ts';
import {
  passed,
  notRun,
  reported,
  notCheckable,
  failed,
  computeVerdict,
} from '@/fidelity/report.ts';

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

test('verdict-invariant: all checks passed → verdict is passed', () => {
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      ledger_structure: passed(),
      unit_accounting: passed({ total: 57 }),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + inapplicable not-run (no lexicon) → verdict is passed', () => {
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      verbatim_quotes: passed({ checked: 10 }),
      citations: passed({ checked: 11, mode: 'multiset' }),
      lexicon: notRun('no lexicon declared'),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + reported count + inapplicable not-run → verdict is passed', () => {
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      unit_accounting: passed({ total: 57 }),
      verbatim_quotes: passed({ checked: 10 }),
      uncorroborated_units: reported({ count: 6 }),
      lexicon: notRun('no lexicon declared'),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: passed + not-checkable (out of scope) → verdict is passed', () => {
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      ledger_structure: passed(),
      unit_accounting: passed({ total: 57 }),
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

test('verdict-invariant: explicit-abort not-run (earlier failure, aborted:true marker) → no verdict', () => {
  // computeVerdict does NOT sniff `reason` text — an aborted not-run is
  // identified by the explicit `aborted: true` marker (see notRun()'s doc
  // comment and computeVerdict's doc comment).
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      ledger_structure: notRun('aborted: source_hash failed', { aborted: true }),
      unit_accounting: notRun('aborted: source_hash failed', { aborted: true }),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, undefined);
});

test('verdict-invariant: not-run WITHOUT the aborted marker never blocks, even with an "aborted"-sounding reason string', () => {
  // Regression guard for the "no reason-sniffing" requirement: a `not-run`
  // whose reason text happens to mention "aborted" or "failed" must NOT
  // block the verdict unless the explicit `aborted: true` marker is set.
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      lexicon: notRun('not applicable — an earlier prototype aborted this path, but this check is simply not applicable'),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, 'passed');
});

test('verdict-invariant: complex realistic report with all check types → verdict is passed', () => {
  // Mirrors the validator contract example closely
  const report: CoverageReport = {
    checks: {
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
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      some_check: failed('some obligation was not satisfied'),
    },
  };

  const verdict = computeVerdict(report);
  assert.equal(verdict, undefined);
});

test('verdict-invariant: multiple aborted not-run checks → no verdict', () => {
  const report: CoverageReport = {
    checks: {
      source_hash: passed(),
      ledger_structure: notRun('aborted: source validation failed', { aborted: true }),
      unit_accounting: notRun('aborted: source validation failed', { aborted: true }),
    },
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
   * - An abort (earlier check failure) producing `not-run` DOES block `passed`.
   */

  // Test: inapplicable not-run is OK
  const inapplicable: CoverageReport = {
    checks: {
      source_hash: passed(),
      lexicon: notRun('no lexicon declared'),
    },
  };
  assert.equal(computeVerdict(inapplicable), 'passed');

  // Test: reported is OK
  const withReported: CoverageReport = {
    checks: {
      source_hash: passed(),
      uncorroborated_units: reported({ count: 5 }),
    },
  };
  assert.equal(computeVerdict(withReported), 'passed');

  // Test: not-checkable is OK
  const withNotCheckable: CoverageReport = {
    checks: {
      source_hash: passed(),
      semantic_claim_fidelity: notCheckable(
        'not provable under D4 — declared out of scope for v1',
      ),
    },
  };
  assert.equal(computeVerdict(withNotCheckable), 'passed');

  // Test: abort blocks verdict
  const withAbort: CoverageReport = {
    checks: {
      source_hash: notRun('aborted: parsing failed', { aborted: true }),
    },
  };
  assert.equal(computeVerdict(withAbort), undefined);

  // Test: a decided failed() check also blocks verdict
  const withFailed: CoverageReport = {
    checks: {
      source_hash: passed(),
      unit_accounting: failed('unaccounted source unit'),
    },
  };
  assert.equal(computeVerdict(withFailed), undefined);
});

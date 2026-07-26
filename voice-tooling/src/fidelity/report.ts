/**
 * Coverage report types and helpers (D15, FR-025, SC-004).
 *
 * The coverage report is the validator's structured, first-class output enumerating
 * every check with its state, applicable counts, and an optional top-level verdict.
 * A `passed` verdict means every APPLICABLE deterministic obligation passed — never
 * semantic equivalence. Absent verdict signals the validator could not decide (FR-030).
 *
 * Invariant (SC-004): a `passed` top-level verdict never appears alongside an unrun
 * *applicable* obligation. An obligation that is inapplicable (no lexicon declared)
 * is correctly `not-run`, not a violation. The invariant is about *applicable* checks
 * being silently skipped, not about every possible check executing.
 */

/**
 * The four check states (FR-025, D15).
 * - `passed`: obligation checked and satisfied
 * - `not-run`: check skippable-by-design with no applicable input (e.g., no lexicon)
 * - `reported`: count surfaced without pass/fail verdict (uncorroborated units)
 * - `not-checkable`: obligation real but outside mechanical scope (semantic/voice conformance, out of scope in v1)
 */
export type CheckState = 'passed' | 'not-run' | 'reported' | 'not-checkable';

/**
 * A single check result within the coverage report.
 *
 * Per the validator contract, state is required; reason is present for not-run and
 * not-checkable states (naming why); count fields (total, checked, count, etc.) carry
 * check-specific metadata. The index signature permits per-check fields without
 * loosening the state constraint.
 *
 * Example states from the contract:
 * - { "state": "passed" }
 * - { "state": "not-run", "reason": "no lexicon declared" }
 * - { "state": "passed", "total": 57 }
 * - { "state": "passed", "checked": 10 }
 * - { "state": "reported", "count": 6 }
 * - { "state": "not-checkable", "reason": "not provable under D4 — declared out of scope for v1" }
 */
export interface CheckResult {
  state: CheckState;
  reason?: string; // Present at least for 'not-run' / 'not-checkable' (name why).
  [k: string]: unknown; // Permit per-check count fields (total, checked, count, mode, etc.) without loosening state.
}

/**
 * The coverage report: structured first-class output from the validator.
 *
 * `verdict` is present (and set to 'passed') ONLY when every APPLICABLE deterministic
 * obligation passed — never for semantic equivalence. Absent verdict signals the
 * validator cannot decide (FR-030, SC-006), distinct from a "failed" verdict which
 * is not modeled here (it appears in ValidateResponse.state instead).
 *
 * `checks` maps every check the validator can run (whether it ran or not) to its
 * result state and metadata.
 */
export interface CoverageReport {
  verdict?: 'passed'; // ABSENT means "no verdict" (cannot decide / refused).
  checks: Record<string, CheckResult>;
}

/**
 * Helper to construct a `passed` CheckResult.
 * Optionally accepts per-check count fields (total, checked, count, mode, etc.).
 */
export function passed(fields?: Record<string, unknown>): CheckResult {
  return {
    state: 'passed',
    ...fields,
  };
}

/**
 * Helper to construct a `not-run` CheckResult with a reason naming why.
 * Reason is required (Constitution: every reported state MUST name its cause).
 * Optionally accepts additional fields.
 */
export function notRun(
  reason: string,
  fields?: Record<string, unknown>,
): CheckResult {
  return {
    state: 'not-run',
    reason,
    ...fields,
  };
}

/**
 * Helper to construct a `reported` CheckResult (count surfaced without pass/fail).
 * Accepts count fields (count, total, etc.) as per-check metadata.
 */
export function reported(fields?: Record<string, unknown>): CheckResult {
  return {
    state: 'reported',
    ...fields,
  };
}

/**
 * Helper to construct a `not-checkable` CheckResult with a reason naming why.
 * Reason is required (Constitution: every reported state MUST name its cause).
 * Optionally accepts additional fields.
 */
export function notCheckable(
  reason: string,
  fields?: Record<string, unknown>,
): CheckResult {
  return {
    state: 'not-checkable',
    reason,
    ...fields,
  };
}

/**
 * Compute the top-level verdict based on SC-004 invariant.
 *
 * A `passed` verdict appears ONLY when:
 * 1. Every check in the report is in a valid state (passed, not-run, reported, not-checkable).
 * 2. No 'not-run' checks are flagged with blocking reasons (e.g., "aborted: ...").
 * 3. No checks indicate failure or refusal.
 *
 * An absent verdict signals:
 * - A structural refusal or check failure occurred.
 * - The validator could not decide (FR-030, SC-006).
 * - An applicable obligation is unmet or unresolved.
 *
 * Note: 'not-run' checks with reasons like "no lexicon declared" are inapplicable
 * (inputs don't exist) and do NOT block a 'passed' verdict. 'reported' counts and
 * 'not-checkable' checks (declared out of scope) also do NOT block 'passed'.
 *
 * @param report The coverage report to evaluate
 * @returns 'passed' if the invariant holds; undefined if no verdict should be emitted
 */
export function computeVerdict(report: CoverageReport): 'passed' | undefined {
  // Check if all checks are in valid, non-failure states.
  // Valid states per the contract: 'passed', 'not-run', 'reported', 'not-checkable'.
  for (const [checkName, result] of Object.entries(report.checks)) {
    // Check for blocking "not-run" reasons (e.g., "aborted: ..." indicates earlier failure).
    // A 'not-run' from skippable-by-design (e.g., "no lexicon declared") does NOT block.
    if (result.state === 'not-run' && result.reason) {
      // If the reason indicates an abort or failure, no verdict.
      if (
        result.reason.toLowerCase().includes('aborted') ||
        result.reason.toLowerCase().includes('failed')
      ) {
        return undefined;
      }
    }

    // All valid states are acceptable for a passed verdict.
    // A state outside this set would indicate a failure (e.g., a malformed result
    // or an explicit failed state), which would not be in this report format.
    const validStates: CheckState[] = [
      'passed',
      'not-run',
      'reported',
      'not-checkable',
    ];
    if (!validStates.includes(result.state)) {
      return undefined;
    }
  }

  // If we got here, all checks are in valid states and no blocking conditions exist.
  return 'passed';
}

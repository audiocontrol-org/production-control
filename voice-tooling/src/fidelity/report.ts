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
 * The five check states (FR-025, D15).
 * - `passed`: obligation checked and satisfied
 * - `failed`: obligation checked and NOT satisfied (a decided, named failure)
 * - `not-run`: check skippable-by-design with no applicable input (e.g., no lexicon),
 *   OR a check that was aborted by an earlier failure (see the `aborted` marker below)
 * - `reported`: count surfaced without pass/fail verdict (uncorroborated units)
 * - `not-checkable`: obligation real but outside mechanical scope (semantic/voice conformance, out of scope in v1)
 */
export type CheckState = 'passed' | 'failed' | 'not-run' | 'reported' | 'not-checkable';

/**
 * A single check result within the coverage report.
 *
 * Per the validator contract, state is required; reason is present for failed,
 * not-run, and not-checkable states (naming why); count fields (total, checked,
 * count, etc.) carry check-specific metadata. The index signature permits
 * per-check fields without loosening the state constraint.
 *
 * `aborted` is an explicit boolean marker (not a reason-string convention) set
 * ONLY on a `not-run` result produced because an EARLIER check failed and the
 * sequence was aborted (as opposed to a `not-run` because the check is simply
 * inapplicable, e.g. "no lexicon declared"). `computeVerdict` reads this
 * marker directly rather than sniffing `reason` text (see `computeVerdict`).
 *
 * Example states from the contract:
 * - { "state": "passed" }
 * - { "state": "failed", "reason": "..." }
 * - { "state": "not-run", "reason": "no lexicon declared" }
 * - { "state": "not-run", "reason": "aborted: source_hash failed", "aborted": true }
 * - { "state": "passed", "total": 57 }
 * - { "state": "passed", "checked": 10 }
 * - { "state": "reported", "count": 6 }
 * - { "state": "not-checkable", "reason": "not provable under D4 — declared out of scope for v1" }
 */
export interface CheckResult {
  state: CheckState;
  reason?: string; // Present at least for 'failed' / 'not-run' / 'not-checkable' (name why).
  [k: string]: unknown; // Permit per-check count fields (total, checked, count, mode, aborted, etc.) without loosening state.
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
 * Optionally accepts additional fields — pass `{ aborted: true }` when this
 * `not-run` is the result of an EARLIER check's failure aborting the sequence
 * (as opposed to the check being simply inapplicable); `computeVerdict` reads
 * that marker explicitly (see its doc comment).
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
 * Helper to construct a `failed` CheckResult with a reason naming the unmet
 * obligation. Reason is required (Constitution: every reported state MUST
 * name its cause). Optionally accepts additional fields.
 */
export function failed(
  reason: string,
  fields?: Record<string, unknown>,
): CheckResult {
  return {
    state: 'failed',
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
 * 1. No check in the report is `failed`.
 * 2. No `not-run` check carries the explicit `aborted: true` marker (an
 *    APPLICABLE obligation the run never reached because an earlier check
 *    failed and the sequence was aborted).
 *
 * This is a structural check on explicit fields — it never inspects `reason`
 * text. A `not-run` check that is merely inapplicable (e.g. "no lexicon
 * declared", with no `aborted` marker) does NOT block `passed`; neither does
 * `reported` (uncorroborated units, D12) nor `not-checkable` (the declared
 * out-of-scope semantic/voice checks, D4/D16).
 *
 * An absent verdict signals a decided failure (some check is `failed`, or an
 * applicable check was aborted). It is NOT used for the separate "cannot
 * decide" outcome (FR-030/SC-006) — that outcome is signaled by the caller
 * never calling this function with a verdict-bearing report at all (see
 * `@/fidelity/run.ts`'s `decided` flag).
 *
 * @param report The coverage report to evaluate
 * @returns 'passed' if the invariant holds; undefined if no verdict should be emitted
 */
export function computeVerdict(report: CoverageReport): 'passed' | undefined {
  for (const result of Object.values(report.checks)) {
    if (result.state === 'failed') {
      return undefined;
    }
    if (result.state === 'not-run' && result['aborted'] === true) {
      return undefined;
    }
  }
  return 'passed';
}

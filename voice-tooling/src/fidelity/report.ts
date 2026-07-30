import type { Mode } from '@/schema/ledger.ts';

/**
 * Which mode-agreement pass outcome held (spec 006 US5, AUDIT-09). The
 * `'matched'` vs `'matched-by-default'` split is the mode-PROVENANCE honesty
 * fix: an affirmative `'matched'` must mean the ledger actually DECLARED the
 * mode the request agreed with, never a value the loader defaulted in.
 */
export type ModeComparison = 'matched' | 'matched-by-default' | 'none-supplied';

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
 *
 * Spec 006 (T015, FR-012): a composed edition's report additionally carries explicit
 * TRUST-BOUNDARY fields, distinct from `checks` — they are REPORTED FACTS about the
 * scope of what the deterministic gate can prove, never a verdict implying semantic
 * grounding, invented-fact detection, or spine-source correctness were proven. See
 * `composeTrustBoundaryFields` below and contracts/fidelity-mode-agreement.md
 * "Report fields".
 */

/**
 * The six check states (FR-025, D15).
 * - `passed`: obligation checked and satisfied
 * - `failed`: obligation checked and NOT satisfied (a decided, named failure) — BLOCKS the verdict
 * - `not-run`: check inapplicable-by-design with no applicable input (e.g., no lexicon
 *   declared). This state now UNAMBIGUOUSLY means "inapplicable" and NEVER blocks the
 *   verdict — the earlier-failure/abort case is its own `aborted` state (below), not a
 *   `not-run` carrying a boolean flag.
 * - `aborted`: an APPLICABLE obligation the run never reached because an EARLIER check
 *   failed and the sequence was aborted. Carries a `reason` naming the earlier failing
 *   check. BLOCKS the verdict. This is a first-class, discriminated state — there is no
 *   longer any optional `aborted: true` boolean on a `not-run` result (a forgotten,
 *   mistyped, or wrong-typed flag used to fail OPEN to `passed`; see AUDIT-20260726-14).
 * - `reported`: count surfaced without pass/fail verdict (uncorroborated units)
 * - `not-checkable`: obligation real but outside mechanical scope (semantic/voice conformance, out of scope in v1)
 */
export type CheckState =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'aborted'
  | 'reported'
  | 'not-checkable';

/**
 * A single check result within the coverage report.
 *
 * Per the validator contract, state is required; reason is present for failed,
 * not-run, aborted, and not-checkable states (naming why); count fields (total,
 * checked, count, etc.) carry check-specific metadata. The index signature permits
 * per-check fields without loosening the state constraint.
 *
 * An earlier-failure abort is now modeled as its own `state: 'aborted'` (carrying a
 * `reason` naming the earlier failing check), NOT as a `not-run` with an optional
 * `aborted: true` boolean. This is deliberate: an optional boolean fails OPEN — a
 * typo (`aborded`), a string (`aborted: 'true'`), or a forgotten flag would silently
 * yield `passed`. A discriminated state cannot be forgotten without also forgetting
 * to name the state at all.
 *
 * Example states from the contract:
 * - { "state": "passed" }
 * - { "state": "failed", "reason": "..." }
 * - { "state": "not-run", "reason": "no lexicon declared" }
 * - { "state": "aborted", "reason": "aborted: source_hash failed" }
 * - { "state": "passed", "total": 57 }
 * - { "state": "passed", "checked": 10 }
 * - { "state": "reported", "count": 6 }
 * - { "state": "not-checkable", "reason": "not provable under D4 — declared out of scope for v1" }
 */
export interface CheckResult {
  state: CheckState;
  reason?: string; // Present at least for 'failed' / 'not-run' / 'aborted' / 'not-checkable' (name why).
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
  /**
   * Trust-boundary fields (spec 006, FR-012), present for a composed edition.
   * ABSENT for revise (and for any report that never got far enough to know
   * the ledger's mode) — never a fabricated default.
   */
  mode?: Mode;
  /**
   * Which mode-agreement pass outcome held (spec 006 US5, FR-012, AUDIT-09):
   * `'matched'` when an independently-supplied `requested_mode` equalled a mode
   * the ledger ACTUALLY DECLARED; `'matched-by-default'` when it equalled a mode
   * the ledger did NOT declare (absent `mode:` defaulted to `revise`) — an
   * honest label that never claims independent agreement about a value the
   * ledger never stated; `'none-supplied'` when no `requested_mode` was supplied
   * (standalone validation) — so a reader knows no independent mode comparison
   * occurred, never a silent "ok". ABSENT on a mode mismatch (the named failure
   * says why) and on any report that never reached a decided verdict. Unlike the
   * compose-only trust-boundary fields below, this applies to any mode.
   */
  mode_comparison?: ModeComparison;
  /** The producer operation was mechanically source-cited but its own upstream fidelity is out of scope (asset-bank territory). Always `'not-checked'` when present. */
  spine_source_fidelity?: 'not-checked';
  /** The deterministic gate proves edition-side accounting only, never semantic support. Always `'not-checkable'` when present. */
  composition_semantic_grounding?: 'not-checkable';
  /** Whether a declared open-question marker syntax was mechanically recognized for this edition (R7/FR-013). */
  open_question_markers?: 'enforced' | 'none-declared';
  checks: Record<string, CheckResult>;
}

/**
 * The FR-012 trust-boundary fields for a composed edition's report — REPORTED
 * FACTS about the scope of the deterministic gate, never a verdict. `spine_
 * source_fidelity` and `composition_semantic_grounding` are always their
 * single declared value for compose (the spine's own upstream citation
 * correctness and the composed prose's semantic support are both out of
 * scope for v1 — see spec.md "Assumptions"/"Deferred").
 *
 * `openQuestionMarkers` is threaded in by the caller (T027, R7) rather than
 * computed here: `@/payload/extract.ts` recognizes a declared
 * `[OPEN-QUESTION: ...]` marker as required payload and `@/fidelity/run.ts`
 * decides `'enforced'` vs `'none-declared'` from whether the SPINE actually
 * declares one — this helper only assembles the already-decided value into
 * the report, so it never invents an `'enforced'` claim on its own.
 */
export function composeTrustBoundaryFields(
  openQuestionMarkers: 'enforced' | 'none-declared',
): Pick<
  CoverageReport,
  'mode' | 'spine_source_fidelity' | 'composition_semantic_grounding' | 'open_question_markers'
> {
  return {
    mode: 'compose',
    spine_source_fidelity: 'not-checked',
    composition_semantic_grounding: 'not-checkable',
    open_question_markers: openQuestionMarkers,
  };
}

/**
 * The v1 required-obligation vocabulary (AUDIT-20260726-13/-16). A `passed` verdict
 * may only be emitted when EVERY one of these keys is present in `report.checks` —
 * `computeVerdict` derives its verdict solely from the entries PRESENT in the report,
 * so an obligation that is simply ABSENT (an orchestrator early-return, a key typo,
 * a check added behind a false condition) would otherwise let a report of only-passing
 * checks yield `passed` over a run that never executed the obligation. Requiring the
 * full vocabulary closes that missing-required-check false pass: a report missing any
 * required key yields NO verdict.
 */
export const REQUIRED_CHECKS = [
  // mode_agreement is sequenced FIRST (contract step 1) and now emits pass-side
  // evidence on EVERY decided run (revise and compose alike, AUDIT-15): making
  // it required proves a `passed` verdict came from a runner that actually
  // performed the mode comparison, never from an older/broken one that omitted it.
  'mode_agreement',
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
 *
 * `not-run` now means UNAMBIGUOUSLY "inapplicable by design" (e.g. no lexicon
 * declared) and NEVER blocks the verdict. An earlier-failure abort is its own
 * `aborted(...)` state — do NOT model it as a `not-run` with a flag.
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
 * Helper to construct an `aborted` CheckResult with a reason naming the EARLIER
 * check whose failure aborted the sequence before this applicable obligation could
 * run. `aborted` BLOCKS the verdict (see `computeVerdict`). Reason is required.
 */
export function aborted(
  reason: string,
  fields?: Record<string, unknown>,
): CheckResult {
  return {
    state: 'aborted',
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
 * Whether a check state BLOCKS a `passed` verdict.
 *
 * Exhaustive over the `CheckState` union — there is no default fall-through to a
 * non-blocking result. Any state not explicitly listed as non-blocking (including a
 * future/unmodeled state that slipped past the type) is treated as BLOCKING, so the
 * verdict fails CLOSED rather than open (AUDIT-20260726-14).
 */
function blocksVerdict(state: CheckState): boolean {
  switch (state) {
    // Non-blocking: a satisfied, inapplicable, report-only, or declared-out-of-scope
    // obligation never lowers the verdict.
    case 'passed':
    case 'not-run':
    case 'reported':
    case 'not-checkable':
      return false;
    // Blocking: a decided failure, or an applicable obligation aborted by an earlier
    // failure.
    case 'failed':
    case 'aborted':
      return true;
    // Fail closed on any unmodeled state — never fall through to a passing verdict.
    default:
      return true;
  }
}

/**
 * Compute the top-level verdict based on the SC-004 invariant.
 *
 * A `passed` verdict appears ONLY when BOTH hold:
 * 1. Every REQUIRED_CHECKS key is PRESENT in `report.checks`. An applicable
 *    obligation that is simply absent (never declared) yields NO verdict — a report
 *    of only-passing checks can no longer pass over a run that skipped an obligation
 *    (AUDIT-20260726-13/-16).
 * 2. No present check is in a BLOCKING state — a decided `failed`, or an `aborted`
 *    applicable obligation the run never reached because an earlier check failed.
 *
 * This is a structural check on explicit `state` values — it never inspects `reason`
 * text. `not-run` (inapplicable, e.g. "no lexicon declared"), `reported`
 * (uncorroborated units, D12), and `not-checkable` (declared out-of-scope
 * semantic/voice checks, D4/D16) never block.
 *
 * An absent verdict signals a decided failure (some check is `failed`/`aborted`) OR a
 * missing required obligation. It is NOT used for the separate "cannot decide" outcome
 * (FR-030/SC-006) — that outcome is signaled by the caller never calling this function
 * with a verdict-bearing report at all (see `@/fidelity/run.ts`'s `decided` flag).
 *
 * @param report The coverage report to evaluate
 * @returns 'passed' if the invariant holds; undefined if no verdict should be emitted
 */
export function computeVerdict(report: CoverageReport): 'passed' | undefined {
  // (1) Every required obligation must be PRESENT — an absent key is not a pass.
  for (const key of REQUIRED_CHECKS) {
    if (!Object.prototype.hasOwnProperty.call(report.checks, key)) {
      return undefined;
    }
  }
  // (2) No present check may be in a blocking state.
  for (const result of Object.values(report.checks)) {
    if (blocksVerdict(result.state)) {
      return undefined;
    }
  }
  return 'passed';
}

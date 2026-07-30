// Outcome assembly for `@/fidelity/run.ts` (spec 006), split out to keep that
// orchestrator within the project's file-size guideline (CLAUDE.md). This module
// owns ONLY the final translation of an accumulated check map into the contract's
// three-way result (decided pass / decided failure / cannot-decide) — it runs no
// check of its own; every verdict decision still derives from `computeVerdict`
// over the named-check map ALONE (AUDIT-20260728-28).

import type { Mode } from '@/schema/ledger.ts';
import {
  notCheckable,
  computeVerdict,
  composeTrustBoundaryFields,
  type CheckResult,
  type CoverageReport,
  type ModeComparison,
} from '@/fidelity/report.ts';

/**
 * The three-way outcome the contract requires: a decided pass, a decided
 * failure (both `decided: true`), or cannot-decide (`decided: false`, and
 * `report.verdict` is then never set) — see "No-verdict exit" (FR-030/SC-006).
 */
export interface FidelityResult {
  report: CoverageReport;
  passed: boolean;
  decided: boolean;
  failures: string[];
}

export function finalize(
  checks: Record<string, CheckResult>,
  failures: string[],
  decided: true,
  mode?: Mode,
  modeComparison?: ModeComparison,
  openQuestionMarkers: 'enforced' | 'none-declared' = 'none-declared',
): FidelityResult {
  // Every applicable path in `runFidelity` already sets both honest-boundary
  // checks before reaching here EXCEPT the abort paths (source_hash/
  // ledger_structure/unit_accounting failures return early) -- set them
  // unconditionally so FR-025/SC-004's "every one of the checks is always named"
  // holds even on a decided, aborted failure.
  if (!('semantic_claim_fidelity' in checks)) {
    checks['semantic_claim_fidelity'] = notCheckable(
      'not provable under D4 — declared out of scope for v1',
    );
  }
  if (!('voice_conformance' in checks)) {
    checks['voice_conformance'] = notCheckable(
      'not provable under D16 — declared out of scope for v1',
    );
  }

  // The verdict derives from the named-check map ALONE (AUDIT-20260728-28):
  // every op-obligation failure has already flipped a named check (a payload
  // check, or the `op_obligations` catch-all) by the time we get here, so there
  // is no `failures.length` coupling and no advisory side-channel that could flip
  // a pass. `failures[]` remains for the human-facing ValidateResponse only.
  const verdict = computeVerdict({ checks });
  const isPassed = verdict === 'passed';
  // FR-012 (spec 006): a composed edition's report always carries the
  // trust-boundary fields, regardless of verdict — they describe the scope
  // of what was checked, not whether it passed.
  const trustBoundary = mode === 'compose' ? composeTrustBoundaryFields(openQuestionMarkers) : {};
  // `mode_comparison` (spec 006 US5, FR-012) records WHICH mode-agreement pass
  // outcome held — applies to ANY mode, so (unlike the compose-only trust-
  // boundary fields) it is threaded whenever mode-agreement passed, incl. a
  // standalone revise validation (`none-supplied`). Absent on a mismatch and on
  // abort paths that never reached a full ledger.
  const report: CoverageReport = {
    ...(isPassed ? { verdict: 'passed' as const } : {}),
    ...trustBoundary,
    ...(modeComparison !== undefined ? { mode_comparison: modeComparison } : {}),
    checks,
  };
  return { report, passed: isPassed, decided, failures };
}

export function cannotDecide(diagnostic: string): FidelityResult {
  return {
    report: { checks: {} },
    passed: false,
    decided: false,
    failures: [diagnostic],
  };
}

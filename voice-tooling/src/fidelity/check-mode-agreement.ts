// T025: the `mode_agreement` fidelity check (spec 006 US5, contracts/
// fidelity-mode-agreement.md check ordering step 1, data-model.md "Mode
// agreement").
//
// Pure and deterministic: takes exactly the two values the contract says
// this check is decidable from -- the governed build's independently-supplied
// `requested_mode` (or its absence, for standalone use) and the ledger's own
// `mode` -- and nothing else. That the function signature carries no other
// parameter is itself the proof that this decision never depends on
// op-legality, grounding, or any other check's outcome; per the contract this
// check is sequenced FIRST, before all of those.
//
// A mismatch is a hard, named refusal (never merely reported) -- Principle V
// (fail-loud, never a silent pass). A match or an absent `requested_mode` are
// both legitimate pass outcomes, but distinct ones: `mode_comparison` records
// WHICH pass outcome occurred so a standalone validation is never mistaken
// for one that independently confirmed the mode (FR-012's trust-boundary
// discipline). On a mismatch, `mode_comparison` is deliberately left absent
// rather than assigned a value that would falsely claim a matched or
// not-supplied state that didn't hold -- the named failure in `failures`
// already says exactly what happened.

import type { Mode } from '@/schema/ledger.ts';

/** Result of the `mode_agreement` check (contract step 1, data-model.md). */
export interface ModeAgreementResult {
  ok: boolean;
  /**
   * Present only for a pass: 'matched' when `requestedMode` was supplied and
   * equals `ledgerMode`; 'none-supplied' when no `requestedMode` was supplied
   * at all. Absent on a mismatch (see module doc above).
   */
  mode_comparison?: 'matched' | 'none-supplied';
  failures: string[];
}

/**
 * Compare a governed build's requested mode against the ledger's stamped
 * mode, before any op-legality or grounding check runs.
 *
 * @param requestedMode the `ValidateRequest.requested_mode` wire field, or
 *   `undefined` for standalone validation (no independent mode was supplied).
 * @param ledgerMode    the coverage ledger's own `mode` (already defaulted to
 *   `revise` by `loadLedger` when absent from the ledger bytes).
 */
export function checkModeAgreement(
  requestedMode: Mode | undefined,
  ledgerMode: Mode,
): ModeAgreementResult {
  if (requestedMode === undefined) {
    return { ok: true, mode_comparison: 'none-supplied', failures: [] };
  }
  if (requestedMode !== ledgerMode) {
    return {
      ok: false,
      failures: [`mode mismatch: requested ${requestedMode}, ledger ${ledgerMode}`],
    };
  }
  return { ok: true, mode_comparison: 'matched', failures: [] };
}

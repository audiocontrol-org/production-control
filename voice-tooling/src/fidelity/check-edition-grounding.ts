// T017: the `edition_grounding` fidelity check (spec 006 US2, contracts/
// fidelity-mode-agreement.md check ordering step 4, data-model.md
// "Edition-side grounding accounting").
//
// This module owns NO accounting logic of its own -- it derives nothing and
// re-implements nothing. It is a thin, compose-only wrapper: it reads the
// ledger's `mode` (default `revise`) and `grounding` records, then delegates
// straight to the shared, pure `@/policy/grounding.ts#checkGrounding` (the
// SAME logic the producer's pre-emit self-check uses, per Principle VI --
// neither entry point depends on the other) and translates its structured
// failures into this fidelity check's result shape.
//
// Compose-only (D21): mode 'revise' has no grounding to account for, so this
// check is a no-op -- `applicable: false`, never a failure. Pure and
// deterministic: no I/O, no re-derivation -- the caller derives edition units
// and source units (via `deriveUnits`) and passes them in, matching every
// other `fidelity/check-*.ts` module's input convention (e.g.
// `check-unit-accounting.ts`, `check-op-obligations.ts`).
//
// This check does NOT judge semantic support (whether the prose is actually
// warranted by its beats) -- that remains reported not-checkable elsewhere
// (`semantic_claim_fidelity`, D4).

import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger } from '@/schema/ledger.ts';
import { checkGrounding } from '@/policy/grounding.ts';

/** Result of the `edition_grounding` check (contract step 4, data-model.md). */
export interface EditionGroundingResult {
  ok: boolean;
  /** False for mode 'revise' (default when `mode` is absent): a no-op, never a failure. */
  applicable: boolean;
  failures: string[];
}

/**
 * Verify the ledger's `grounding` records exhaustively and exclusively
 * account for the derived edition units, and that every grounded beat
 * resolves to a real derived source unit -- compose mode only.
 *
 * @param ledger       the coverage ledger (its `mode` and `grounding` fields).
 * @param editionUnits the derived edition units to account for.
 * @param sourceUnits  the derived source units, for resolving grounded `beats`.
 */
export function checkEditionGrounding(
  ledger: CoverageLedger,
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): EditionGroundingResult {
  // D6 (AUDIT-06): NO `?? 'revise'` fail-open default. `loadLedger` always
  // stamps `mode`; an unstamped ledger reaching here is a caller defect, not a
  // compose edition to silently skip as a revise no-op. Fail LOUD.
  if (ledger.mode === undefined) {
    throw new Error('coverage ledger has no mode stamp; cannot judge edition grounding');
  }
  if (ledger.mode !== 'compose') {
    return { ok: true, applicable: false, failures: [] };
  }

  const result = checkGrounding(ledger.grounding ?? [], editionUnits, sourceUnits, ledger.coverage);
  return {
    ok: result.ok,
    applicable: true,
    failures: result.failures.map((failure) => failure.message),
  };
}

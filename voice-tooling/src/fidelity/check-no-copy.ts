// T021: the `no_copy` fidelity check (spec 006 US3, R4, data-model.md
// "Additional compose rule (whole-unit no-copy)", contracts/
// fidelity-mode-agreement.md check ordering step 5: "no-copy
// (check-no-copy.ts, compose only): no represented/merged destination is
// normalized-byte-identical to a complete beat it represents").
//
// This module owns NO copy-detection logic of its own -- it derives nothing and
// re-implements nothing. It is a thin, compose-only wrapper mirroring its
// sibling `check-edition-grounding.ts`: it reads the ledger's `mode` (default
// `revise`) and delegates straight to the shared, pure
// `@/policy/op-legality.ts#checkOpLegality` (the SAME policy the producer's
// pre-emit self-check uses, per Principle VI -- neither entry point depends on
// the other), then keeps ONLY its `whole-unit-copy` failures.
//
// Scope boundary: `checkOpLegality` in compose ALSO reports illegal-op failures
// (`compose-forbids-verbatim` / `compose-forbids-cut`) -- those are
// `check-op-obligations.ts`'s concern (check ordering step 2), NOT this check's,
// so they are filtered out here. This check reports exclusively whole-unit
// copies, each naming the offending edition unit + the beat it copies.
//
// Compose-only (D21): mode `revise` has no whole-unit no-copy rule (a revise
// verbatim op is LEGAL and deliberately byte-exact), so this check is a no-op --
// `applicable: false`, never a failure. Pure and deterministic: no I/O, no
// re-derivation -- the caller derives source + edition units (via `deriveUnits`)
// and passes them in, matching every other `fidelity/check-*.ts` module.

import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger } from '@/schema/ledger.ts';
import { checkOpLegality } from '@/policy/op-legality.ts';
import type { OpLegalityFailureKind } from '@/policy/op-legality.ts';

/** Result of the `no_copy` check (contract step 5, data-model.md). */
export interface NoCopyResult {
  ok: boolean;
  /** False for mode `revise` (default when `mode` is absent): a no-op, never a failure. */
  applicable: boolean;
  failures: string[];
}

/**
 * Verify no `represented`/`merged` destination edition unit is byte-identical to
 * a complete source beat it represents -- compose mode only (R4).
 *
 * @param ledger       the coverage ledger (its `mode` and `coverage` fields).
 * @param sourceUnits  the derived source beats, for resolving `source_unit` refs.
 * @param editionUnits the derived edition units, for resolving `edition_units` refs.
 */
export function checkNoCopy(
  ledger: CoverageLedger,
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
): NoCopyResult {
  // D6 (AUDIT-06): NO `?? 'revise'` fail-open default. `loadLedger` always
  // stamps `mode`; an unstamped ledger reaching here is a caller defect, not a
  // compose edition to silently skip as a revise no-op. Fail LOUD.
  if (ledger.mode === undefined) {
    throw new Error('coverage ledger has no mode stamp; cannot judge whole-unit no-copy');
  }
  const mode = ledger.mode;
  if (mode !== 'compose') {
    return { ok: true, applicable: false, failures: [] };
  }

  const result = checkOpLegality(mode, ledger.coverage, sourceUnits, editionUnits);
  const failures = result.failures
    .filter((failure) => isNoCopyConcern(failure.kind))
    .map((failure) => failure.message);
  return { ok: failures.length === 0, applicable: true, failures };
}

/**
 * AUDIT-20260730-46: partition `checkOpLegality`'s failures by the TYPED `kind`
 * union with an EXHAUSTIVENESS GUARD, not a bare string filter. `no_copy` owns
 * exactly `whole-unit-copy`; every other kind is another check's concern
 * (illegal-op -> `check-op-obligations.ts` step 2; revise-verbatim-drift ->
 * `checkVerbatim`; op-without-destination -> op-obligations' structural gate).
 * The `assertNever` default makes a future op-legality kind a COMPILE error here
 * -- it can no longer be SILENTLY swallowed by falling through the old filter.
 */
function isNoCopyConcern(kind: OpLegalityFailureKind): boolean {
  switch (kind) {
    case 'whole-unit-copy':
      return true;
    case 'compose-forbids-verbatim':
    case 'compose-forbids-cut':
    case 'revise-verbatim-drift':
    case 'op-without-destination':
      return false;
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`check-no-copy: unclassified op-legality failure kind: ${String(value)}`);
}

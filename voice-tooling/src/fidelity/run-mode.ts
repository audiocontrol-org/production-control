// T026 support helpers for `@/fidelity/run.ts` (spec 006 US5): the mode-aware
// pieces of the fidelity pipeline, split out of `run.ts` to keep that file
// within the project's file-size guideline (see CLAUDE.md).
//
// Two cohesive responsibilities live here:
//  1. `readDeclaredMode` — the lightweight (pre-structural-validation) read of
//     the ledger's own `mode`, needed because mode-agreement is sequenced
//     FIRST (contracts/fidelity-mode-agreement.md check ordering step 1),
//     strictly before `ledger_structure` validates the ledger. It mirrors
//     `run-support.ts`'s `readDeclaredSourceHash`: best-effort, defaulting to
//     `revise` (data-model.md "Mode" — absent `mode` reads as `revise`).
//  2. `applyComposeEditionChecks` — the compose-only edition-side checks
//     (`edition_grounding` + `no_copy`, contract ordering steps 4/5), an
//     INDEPENDENT invocation of the shared pure policies (Principle VI). Each
//     contributes a named `failed` check ONLY on a real compose violation, so
//     neither ever appears in a passing revise report.

import { parse as parseYamlText } from 'yaml';
import { isRecord } from '@/util/is-record.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger, Mode } from '@/schema/ledger.ts';
import { isMode } from '@/schema/ledger.ts';
import { checkEditionGrounding } from '@/fidelity/check-edition-grounding.ts';
import { checkNoCopy } from '@/fidelity/check-no-copy.ts';
import { failed, type CheckResult } from '@/fidelity/report.ts';

/**
 * Best-effort read of the ledger's `mode` directly from its raw YAML, WITHOUT
 * running full structural validation (`checkLedgerStructure`) — mode-agreement
 * is checked strictly BEFORE ledger_structure (contract step 1), so it must not
 * depend on the ledger being otherwise well-formed. Defaults to `revise` when
 * `mode` is absent (data-model.md "Mode": absent → revise, pre-006 backward
 * compatibility) or when the YAML does not yet parse / carries an invalid value
 * — in which case `ledger_structure` decides that fault later; this read only
 * needs a mode to compare an independently-supplied `requested_mode` against.
 */
export function readDeclaredMode(ledgerYaml: string): Mode {
  let parsed: unknown;
  try {
    parsed = parseYamlText(ledgerYaml);
  } catch {
    return 'revise';
  }
  if (!isRecord(parsed)) {
    return 'revise';
  }
  const mode = parsed['mode'];
  return typeof mode === 'string' && isMode(mode) ? mode : 'revise';
}

/**
 * Apply the compose-only edition-side checks (contracts/fidelity-mode-agreement.md
 * check ordering steps 4 & 5), mutating `checks`/`failures` in place.
 *
 * `checkEditionGrounding` and `checkNoCopy` both read the ledger's own `mode`
 * and are no-ops (`applicable: false`) for revise, so both calls are
 * unconditional. Each is an INDEPENDENT invocation of the shared pure policy
 * (`@/policy/grounding.ts` / `@/policy/op-legality.ts`) the producer's pre-emit
 * self-check also calls — neither entry point depends on the other (Principle
 * VI). A failure contributes a named check (`failed`) and folds its failures
 * into `failures`, withholding the pass — present-and-`failed` ONLY on a real
 * compose violation, so it never appears in a passing revise report.
 */
export function applyComposeEditionChecks(
  checks: Record<string, CheckResult>,
  failures: string[],
  ledger: CoverageLedger,
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): void {
  const groundingResult = checkEditionGrounding(ledger, editionUnits, sourceUnits);
  if (groundingResult.applicable && !groundingResult.ok) {
    checks['edition_grounding'] = failed(
      'one or more edition units are not exhaustively/exclusively grounded; see failures[]',
    );
    failures.push(...groundingResult.failures);
  }

  const noCopyResult = checkNoCopy(ledger, sourceUnits, editionUnits);
  if (noCopyResult.applicable && !noCopyResult.ok) {
    checks['no_copy'] = failed(
      'one or more edition units are whole-unit copies of a source beat; see failures[]',
    );
    failures.push(...noCopyResult.failures);
  }
}

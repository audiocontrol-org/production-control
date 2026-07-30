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
import type { LoadedLedger, Mode } from '@/schema/ledger.ts';
import { isMode } from '@/schema/ledger.ts';
import { checkEditionGrounding } from '@/fidelity/check-edition-grounding.ts';
import { checkNoCopy } from '@/fidelity/check-no-copy.ts';
import { checkOpenQuestionFabrication } from '@/fidelity/check-open-question-fabrication.ts';
import { failed, passed, notRun, type CheckResult } from '@/fidelity/report.ts';

/**
 * The ledger's `mode` plus its PROVENANCE (AUDIT-09): `declared` is true only
 * when the ledger bytes ACTUALLY carried a valid `mode:` field, false when the
 * value was defaulted in (`revise`, pre-006 backward compatibility) or the YAML
 * did not yet parse. Mode-agreement uses `declared` so an affirmative `matched`
 * is never claimed against a value the ledger never stated.
 */
export interface DeclaredMode {
  mode: Mode;
  declared: boolean;
}

/**
 * Best-effort read of the ledger's `mode` directly from its raw YAML, WITHOUT
 * running full structural validation (`checkLedgerStructure`) — mode-agreement
 * is checked strictly BEFORE ledger_structure (contract step 1), so it must not
 * depend on the ledger being otherwise well-formed. Defaults to `revise` (with
 * `declared: false`) when `mode` is absent (data-model.md "Mode": absent →
 * revise, pre-006 backward compatibility) or when the YAML does not yet parse /
 * carries an invalid value — in which case `ledger_structure` decides that fault
 * later; this read only needs a mode (and its provenance) to compare an
 * independently-supplied `requested_mode` against.
 *
 * Invariant: `declared` is true IFF a valid `mode:` was present in the bytes —
 * so a defaulted `revise` and an explicitly-declared `revise` are DISTINGUISHABLE
 * downstream (the AUDIT-09 overclaim this closes).
 */
export function readDeclaredMode(ledgerYaml: string): DeclaredMode {
  let parsed: unknown;
  try {
    parsed = parseYamlText(ledgerYaml);
  } catch {
    return { mode: 'revise', declared: false };
  }
  if (!isRecord(parsed)) {
    return { mode: 'revise', declared: false };
  }
  const mode = parsed['mode'];
  if (typeof mode === 'string' && isMode(mode)) {
    return { mode, declared: true };
  }
  return { mode: 'revise', declared: false };
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
 * VI).
 *
 * Invariant (AUDIT-13/-16): each check emits pass-side EVIDENCE, never silence.
 * A `passed` result is written on a clean COMPOSE evaluation, an explicit
 * `not-run` ("revise: not applicable") when the mode makes the check
 * inapplicable, and `failed` on a real compose violation (which also folds its
 * messages into `failures`, withholding the pass). So the report distinguishes
 * THREE states a consumer must not conflate: "checked & clean" (`passed`),
 * "not applicable because the ledger is revise" (`not-run`), and — via the
 * mode-mismatch abort list in `run.ts` — "aborted before it could run"
 * (`aborted`). Absence would have collapsed all three into one unverifiable
 * silence; it no longer occurs on any decided path that reaches here.
 */
export function applyComposeEditionChecks(
  checks: Record<string, CheckResult>,
  failures: string[],
  ledger: LoadedLedger,
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): void {
  const groundingResult = checkEditionGrounding(ledger, editionUnits, sourceUnits);
  if (!groundingResult.applicable) {
    checks['edition_grounding'] = notRun('revise: edition grounding not applicable');
  } else if (groundingResult.ok) {
    checks['edition_grounding'] = passed({ units: editionUnits.length });
  } else {
    checks['edition_grounding'] = failed(
      'one or more edition units are not exhaustively/exclusively grounded; see failures[]',
    );
    failures.push(...groundingResult.failures);
  }

  const noCopyResult = checkNoCopy(ledger, sourceUnits, editionUnits);
  if (!noCopyResult.applicable) {
    checks['no_copy'] = notRun('revise: whole-unit no-copy not applicable');
  } else if (noCopyResult.ok) {
    checks['no_copy'] = passed({ units: editionUnits.length });
  } else {
    checks['no_copy'] = failed(
      'one or more edition units are whole-unit copies of a source beat; see failures[]',
    );
    failures.push(...noCopyResult.failures);
  }

  // AUDIT-02: the DESTINATION-side open-question marker check -- an edition may
  // not INVENT an `[OPEN-QUESTION: ...]` marker the spine never declared (a
  // fabricated unresolved-question claim about the source). Same three-state
  // pass-side-evidence discipline as its siblings above (passed / not-run /,
  // via run.ts's abort list, aborted).
  const fabricationResult = checkOpenQuestionFabrication(ledger, sourceUnits, editionUnits);
  if (!fabricationResult.applicable) {
    checks['open_question_fabrication'] = notRun(
      'revise: open-question marker fabrication not applicable',
    );
  } else if (fabricationResult.ok) {
    checks['open_question_fabrication'] = passed({ checked: fabricationResult.checked });
  } else {
    checks['open_question_fabrication'] = failed(
      'one or more edition open-question markers are not present in the spine (fabricated); see failures[]',
    );
    failures.push(...fabricationResult.failures);
  }
}

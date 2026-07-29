// T018 (spec 006, US2): the producer PRE-EMIT self-check
// (contracts/voice-compose-cli.md "Producer pre-emit self-check").
//
// Before `emitEdition` writes anything, the producer verifies its own just-
// composed edition against the shared edition-side grounding policy. This is an
// INDEPENDENT invocation of the SAME pure `@/policy/grounding.ts#checkGrounding`
// the `voice fidelity` validator invokes -- neither entry point imports or
// depends on the other (Principle VI / R8). The producer's success therefore
// grants the validator NOTHING: the validator re-derives units and re-runs the
// policy itself, so a self-check that passed here can still be refused there if
// the two derivations disagree. That independence is the whole point -- this
// module deliberately does NOT import `@/fidelity/check-edition-grounding.ts`
// (the validator's wrapper); it calls the shared policy straight.
//
// Pure and deterministic: the caller (revise/cli.ts) derives the edition + source
// units and passes them (plus the built ledger's resolved grounding records) in;
// this module does no I/O. On any violation it returns a named refusal result;
// the caller REFUSES loudly (throws) BEFORE any write (Principle V).
//
// Mode scoping: grounding is compose-only. For `revise` this is a no-op today --
// the seam is left here for T023's revise verbatim-drift pre-emit self-check,
// which will add its own check to this module WITHOUT the two verbs sharing a
// code path.

import type { SourceUnit } from '@/units/derive.ts';
import type { GroundingRecord } from '@/schema/ledger.ts';
import type { ProducerMode } from '@/revise/prompt/types.ts';
import { checkGrounding } from '@/policy/grounding.ts';

/** Result of the producer's pre-emit self-check: `ok` gates the write; `refusals` name every violation. */
export interface PreflightResult {
  ok: boolean;
  /** Named refusal messages (each names its offending unit); empty when `ok`. */
  refusals: string[];
}

/**
 * Run the producer's pre-emit self-check over the just-composed edition.
 *
 * @param mode         the producer verb's fixed mode (compose runs grounding;
 *                     revise is a no-op here -- seam for T023).
 * @param grounding    the built ledger's resolved grounding records (compose).
 * @param editionUnits the derived edition units the model wrote.
 * @param sourceUnits  the derived source beats, for resolving grounded `beats`.
 */
export function runPreflight(
  mode: ProducerMode,
  grounding: readonly GroundingRecord[] | undefined,
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): PreflightResult {
  if (mode !== 'compose') {
    // revise: no grounding preflight (grounding is compose-only). T023 will add
    // the verbatim-drift self-check here without coupling the two verbs.
    return { ok: true, refusals: [] };
  }

  const result = checkGrounding(grounding ?? [], editionUnits, sourceUnits);
  return {
    ok: result.ok,
    refusals: result.failures.map((failure) => failure.message),
  };
}

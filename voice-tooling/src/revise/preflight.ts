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
// Mode scoping: grounding + no-copy are compose-only. For `revise` (T023,
// US4/TASK-50) the pre-emit self-check is verbatim byte-exactness -- its own
// branch here, invoking the same shared op-legality predicate the validator
// runs, WITHOUT the two verbs sharing a code path.

import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageEntry, GroundingRecord } from '@/schema/ledger.ts';
import type { ProducerMode } from '@/revise/prompt/types.ts';
import { checkGrounding } from '@/policy/grounding.ts';
import { checkOpLegality } from '@/policy/op-legality.ts';

/** Result of the producer's pre-emit self-check: `ok` gates the write; `refusals` name every violation. */
export interface PreflightResult {
  ok: boolean;
  /** Named refusal messages (each names its offending unit); empty when `ok`. */
  refusals: string[];
}

/**
 * Run the producer's pre-emit self-check over the just-composed edition.
 *
 * For compose this is TWO independent invocations of the shared pure policies
 * the validator also runs (Principle VI): edition-side grounding
 * (`@/policy/grounding.ts`) AND whole-unit no-copy (`@/policy/op-legality.ts`,
 * spec 006 US3 R4). The producer refuses a whole-unit copy BEFORE emit, named,
 * writing nothing -- the same refusal the validator would issue at step 5,
 * caught here at the source.
 *
 * @param mode         the producer verb's fixed mode (compose runs grounding +
 *                     no-copy; revise runs the verbatim byte-exactness self-
 *                     check via the shared op-legality predicate, T023).
 * @param grounding    the built ledger's resolved grounding records (compose).
 * @param coverage     the built ledger's coverage entries (for no-copy).
 * @param editionUnits the derived edition units the model wrote.
 * @param sourceUnits  the derived source beats, for resolving grounded `beats`.
 */
export function runPreflight(
  mode: ProducerMode,
  grounding: readonly GroundingRecord[] | undefined,
  coverage: readonly CoverageEntry[],
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): PreflightResult {
  if (mode !== 'compose') {
    // revise (T023, US4/TASK-50): the ONLY pre-emit self-check for revise is
    // verbatim byte-exactness -- an INDEPENDENT invocation of the shared pure
    // `@/policy/op-legality.ts#checkOpLegality('revise', ...)` predicate the
    // fidelity validator also runs (Principle VI). A `verbatim` op whose
    // destination drifted from its source unit is refused HERE, named with its
    // `sha256:` content hash, BEFORE any write (Principle V). `represented`/
    // `merged` revise ops stay legal -- op-legality only reports drift for
    // `verbatim`. Grounding + no-copy remain compose-only (below), untouched.
    const legality = checkOpLegality('revise', coverage, sourceUnits, editionUnits);
    const refusals = legality.failures
      .filter((failure) => failure.kind === 'revise-verbatim-drift')
      .map((failure) => failure.message);
    return { ok: refusals.length === 0, refusals };
  }

  const refusals: string[] = [];

  const grounded = checkGrounding(grounding ?? [], editionUnits, sourceUnits, coverage);
  refusals.push(...grounded.failures.map((failure) => failure.message));

  // Whole-unit no-copy (R4): keep ONLY op-legality's `whole-unit-copy` failures.
  // The `compose-forbids-verbatim`/`-cut` kinds cannot arise here -- `buildEdition`
  // only ever emits `represented`/`merged`/`cut` from the model's coverage and
  // never a verbatim in compose -- but filtering keeps this check honestly scoped
  // to no-copy regardless.
  const legality = checkOpLegality('compose', coverage, sourceUnits, editionUnits);
  refusals.push(
    ...legality.failures
      .filter((failure) => failure.kind === 'whole-unit-copy')
      .map((failure) => failure.message),
  );

  return { ok: refusals.length === 0, refusals };
}

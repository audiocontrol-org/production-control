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
import type { OpLegalityFailure } from '@/policy/op-legality.ts';

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
  // AUDIT-20260730-42: EXPLICIT, exhaustive mode dispatch -- never `mode !==
  // 'compose'` (dispatch-by-negation), which would silently hand a future
  // `ProducerMode` the weakest (revise) self-check. A new mode is a COMPILE error
  // here (`assertNever`), forcing its write-gate to be decided deliberately.
  switch (mode) {
    case 'compose':
      return composePreflight(grounding, coverage, editionUnits, sourceUnits);
    case 'revise':
      return revisePreflight(coverage, editionUnits, sourceUnits);
    default:
      return assertNever(mode);
  }
}

/**
 * The REVISE pre-emit self-check (T023, US4/TASK-50): an INDEPENDENT invocation
 * of the shared pure `@/policy/op-legality.ts#checkOpLegality('revise', ...)`
 * predicate the fidelity validator also runs (Principle VI).
 *
 * AUDIT-20260730-43: this branch is EXHAUSTIVE over `OpLegalityFailureKind` --
 * the same hardening the compose branch got in round 2. The pre-fix branch
 * `.filter`ed to ONLY `revise-verbatim-drift` and silently dropped every other
 * kind, so an `op-without-destination` (a `represented`/`merged` revise entry
 * that lands nowhere -- an undeclared cut, FG-A2/AUDIT-34) escaped the write
 * gate. Now EVERY failure the revise policy reports is routed through
 * `reviseOpLegalityRefusal`, whose `assertNever` makes a future unhandled kind a
 * COMPILE error rather than a silent drop.
 */
function revisePreflight(
  coverage: readonly CoverageEntry[],
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): PreflightResult {
  const legality = checkOpLegality('revise', coverage, sourceUnits, editionUnits);
  const refusals: string[] = [];
  for (const failure of legality.failures) {
    const refusal = reviseOpLegalityRefusal(failure);
    if (refusal !== undefined) {
      refusals.push(refusal);
    }
  }
  return { ok: refusals.length === 0, refusals };
}

/**
 * The COMPOSE pre-emit self-check: TWO independent invocations of the shared
 * pure policies the validator also runs (Principle VI) -- edition-side grounding
 * AND whole-unit no-copy / op-legality.
 *
 * Op-legality (D1, AUDIT-11/12/19): EVERY failure `checkOpLegality('compose',
 * ...)` reports is a pre-emit refusal -- illegal-op (`compose-forbids-verbatim`,
 * `compose-forbids-cut`), undeclared-cut (`op-without-destination`), AND
 * whole-unit-copy (R4). They are pushed via an EXHAUSTIVE switch over
 * `OpLegalityFailureKind`, so a future unhandled kind is a COMPILE error
 * (`assertNever`), never a silent drop.
 */
function composePreflight(
  grounding: readonly GroundingRecord[] | undefined,
  coverage: readonly CoverageEntry[],
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): PreflightResult {
  const refusals: string[] = [];

  const grounded = checkGrounding(grounding ?? [], editionUnits, sourceUnits, coverage);
  refusals.push(...grounded.failures.map((failure) => failure.message));

  const legality = checkOpLegality('compose', coverage, sourceUnits, editionUnits);
  for (const failure of legality.failures) {
    refusals.push(composeOpLegalityRefusal(failure));
  }

  return { ok: refusals.length === 0, refusals };
}

/**
 * Every compose op-legality failure gates the write. This switch is EXHAUSTIVE
 * over `OpLegalityFailureKind` (D1): each kind maps to its refusal message, and
 * the `assertNever` default makes a future unhandled kind a compile error rather
 * than a silently dropped illegal op. `revise-verbatim-drift` is a revise-only
 * kind `checkOpLegality('compose', ...)` never emits; it is handled here anyway
 * so that if a future change ever makes it reachable in compose it still refuses.
 */
function composeOpLegalityRefusal(failure: OpLegalityFailure): string {
  switch (failure.kind) {
    case 'compose-forbids-verbatim':
    case 'compose-forbids-cut':
    case 'whole-unit-copy':
    case 'revise-verbatim-drift':
    // AUDIT-34: an undeclared cut (`op-without-destination`) is illegal in
    // compose (it bypasses the no-cut invariant) -- it gates the write like any
    // other op-legality failure.
    case 'op-without-destination':
      return failure.message;
    default:
      return assertNever(failure.kind);
  }
}

/**
 * AUDIT-20260730-43: classify EVERY revise op-legality failure kind explicitly.
 * A kind ILLEGAL in revise returns its refusal message (gating the write); a kind
 * that is legal / not-applicable in revise returns `undefined` with a documented
 * reason (NOT a silent drop -- the disposition is reviewed and exhaustive). The
 * `assertNever` default makes a future unhandled kind a COMPILE error here.
 *
 * `checkOpLegality('revise', ...)` only ever EMITS `revise-verbatim-drift` and
 * `op-without-destination`; the compose-only kinds are enumerated so the union is
 * covered and their revise disposition is stated, not inferred.
 */
function reviseOpLegalityRefusal(failure: OpLegalityFailure): string | undefined {
  switch (failure.kind) {
    case 'revise-verbatim-drift':
    // AUDIT-34/FG-A2: an undeclared cut (a non-`cut` op that lands nowhere) is
    // illegal in revise too -- it sidesteps the cut-requires-reason obligation.
    case 'op-without-destination':
      return failure.message;
    case 'compose-forbids-verbatim':
    case 'compose-forbids-cut':
    case 'whole-unit-copy':
      // Compose-only kinds. `checkOpLegality('revise', ...)` never emits these:
      // `verbatim` is LEGAL in revise (so byte-identity carry-over is legal too,
      // and the whole-unit-copy sweep is compose-only), and the compose-forbids-*
      // kinds are compose-scoped. If one ever appeared it would be a policy-layer
      // bug, not a revise write-gate violation, so it does NOT gate the write --
      // stated explicitly rather than dropped by an untyped filter.
      return undefined;
    default:
      return assertNever(failure.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`voice-revise: unhandled op-legality failure kind: ${String(value)}`);
}

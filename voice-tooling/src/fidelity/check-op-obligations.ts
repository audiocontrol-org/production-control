// T013: the per-op mechanical obligation -- the adversarial core (contract
// step 4, data-model.md "closed operation set" table, FR-012/013/017/018/022,
// D8/D12/D22).
//
// This check CORROBORATES the producer's DECLARED mapping and NEVER infers a
// "better" one (FR-018, D22): it resolves each entry's declared source_unit and
// declared edition_units exactly as written and checks the op's mechanical
// obligation against THOSE declared destinations only. A destination that sits
// at an editorially "wrong" location but carries the required payload still
// passes -- that is the deliberate trust-boundary guarantee, not an oversight.
//
// Pure and deterministic: no I/O, no re-derivation. The caller derives source
// units and edition units (via `deriveUnits`) and passes them in. Obligation
// failures are RETURNED, never thrown; failures are ordered by ledger
// `coverage` order for determinism.

import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger, CoverageEntry, Mode, UnitRef } from '@/schema/ledger.ts';
import { checkOpLegality } from '@/policy/op-legality.ts';
import { extractPayload } from '@/payload/extract.ts';
import type { UnitPayload } from '@/payload/extract.ts';
import { consumeAgainstRemaining, consumeAcrossDestinations } from '@/payload/match.ts';
import type { RemainingSupply } from '@/payload/match.ts';
import { buildDestinationSupplies, entryDestinationSupplies } from '@/fidelity/destination-supply.ts';

/**
 * The KIND of obligation a failure belongs to (AUDIT-20260726-23). Downstream
 * report classification switches on this ENUM rather than regex-matching the
 * human-facing `message` (whose interpolated payload item -- a quoted span, a
 * citation, a lexicon term -- could contain a word like "numeric" and flip the
 * wrong named check). `message` is retained verbatim for the errors[]/failures[]
 * a human reads.
 */
export type OpFailureKind =
  | 'quote'
  | 'citation'
  | 'numeric'
  | 'lexicon'
  | 'verbatim'
  | 'destination'
  | 'structural'
  /**
   * An op whose DISPOSITION is illegal in the ledger's declared mode (spec 006
   * US3): a `verbatim` or `cut` op in compose. Distinct from `verbatim` (a
   * revise byte-identity fault) -- this is "this op may not appear in this mode
   * at all", judged by `@/policy/op-legality.ts`. Maps to the `op_obligations`
   * catch-all downstream, so it withholds the verdict like any structural fault.
   */
  | 'illegal-op'
  /**
   * A declared `[OPEN-QUESTION: ...]` marker (R7/FR-013, T027) whose exact
   * bytes did not survive into the entry's declared destination(s) -- the same
   * shortfall shape as a dropped citation or numeral, just a distinct payload
   * kind. Maps to the `op_obligations` catch-all downstream.
   */
  | 'open-question-marker';

/** A single op-obligation failure: its structured kind plus the human message. */
export interface OpFailure {
  kind: OpFailureKind;
  message: string;
}

/** Result of the `op_obligations` check (contract step 4, D8). */
export interface OpObligationResult {
  ok: boolean;
  failures: OpFailure[];
  opCounts: { verbatim: number; represented: number; merged: number; cut: number };
  payloadChecked: {
    quotes: number;
    citations: number;
    numerics: number;
    lexiconTerms: number;
    openQuestionMarkers: number;
  };
  /**
   * Count of non-cut entries whose SOURCE unit yields NO extractable payload
   * (empty across all kinds) -- the D12/FR-022 report-only signal. These entries
   * still pass; the count is surfaced for the operator to judge as weak evidence.
   */
  uncorroboratedUnits: number;
  /** True iff a non-empty lexicon was supplied (drives `lexicon`'s not-run state, D11). */
  lexiconApplicable: boolean;
}

/** The five payload kinds, in the order shortfalls are reported. */
const PAYLOAD_KINDS = [
  'quotes',
  'citations',
  'numerics',
  'lexiconTerms',
  'openQuestionMarkers',
] as const;
type PayloadKind = (typeof PAYLOAD_KINDS)[number];

/** Human-legible singular label per payload kind, for failure messages. */
const KIND_LABEL: Record<PayloadKind, string> = {
  quotes: 'quote',
  citations: 'citation',
  numerics: 'numeric',
  lexiconTerms: 'lexicon term',
  openQuestionMarkers: 'open-question marker',
};

/** Structured failure kind per payload kind (AUDIT-20260726-23). */
const FAILURE_KIND_BY_PAYLOAD: Record<PayloadKind, OpFailureKind> = {
  quotes: 'quote',
  citations: 'citation',
  numerics: 'numeric',
  lexiconTerms: 'lexicon',
  openQuestionMarkers: 'open-question-marker',
};

/**
 * Check every coverage entry's op against its declared destinations (D8).
 *
 * @param ledger The structurally-valid coverage ledger (post `loadLedger`).
 * @param sourceUnits Source units re-derived from the supplied source draft.
 * @param editionUnits Edition units re-derived from the artifact body (D7).
 * @param lexicon Optional declared lexicon; when non-empty, `lexiconApplicable`
 *   is true and lexicon terms participate in payload survival.
 */
export function checkOpObligations(
  ledger: CoverageLedger,
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
  lexicon?: readonly string[],
): OpObligationResult {
  const sourceByKey = indexUnits(sourceUnits);
  const editionByKey = indexUnits(editionUnits);
  const destinationOwners = buildDestinationOwners(ledger.coverage);

  // The invariant (AUDIT-20260728-04/-14; AUDIT-20260726-17). Build ONE mutable
  // remaining-supply multiset PER DISTINCT DESTINATION UNIT referenced by a
  // non-cut entry (keyed by unitRefKey), each seeded with THAT unit's extracted
  // payload exactly once. There is no component/union-find pooling: each entry
  // is corroborated ONLY by the destination units IT declared (fixes -04), and a
  // destination named twice by one entry is still ONE unit contributing its
  // supply once (fixes -14). Because the per-unit supplies are SHARED and
  // decremented in place, a single destination occurrence consumed by one entry
  // is unavailable to a later entry that declares the same destination unit --
  // preserving the merged cross-unit constraint (AUDIT-20260726-17). Verbatim
  // spends its destination's supply too (a separate pre-pass below), so a
  // represented/merged sibling sharing it cannot be discharged by the verbatim
  // copy's bytes (AUDIT-20260727-03).
  const remainingByDest = buildDestinationSupplies(ledger.coverage, editionByKey, lexicon);

  const failures: OpFailure[] = [];
  const opCounts = { verbatim: 0, represented: 0, merged: 0, cut: 0 };
  const payloadChecked = {
    quotes: 0,
    citations: 0,
    numerics: 0,
    lexiconTerms: 0,
    openQuestionMarkers: 0,
  };
  let uncorroboratedUnits = 0;

  // T020 (spec 006 US3, contracts/fidelity-mode-agreement.md step 2): mode-aware
  // illegal-disposition gate. In COMPOSE, a `verbatim` or `cut` op is an ILLEGAL
  // disposition -- delegate that judgment to the shared, pure
  // `@/policy/op-legality.ts#checkOpLegality` (the SAME policy the producer's
  // pre-emit self-check calls, Principle VI) and fold ONLY its
  // `compose-forbids-verbatim` / `compose-forbids-cut` failures in here. The
  // other op-legality kinds are deliberately NOT folded: whole-unit-copy is
  // `check-no-copy.ts`'s concern (step 5), and revise verbatim byte-exactness is
  // the `checkVerbatim` obligation below. REVISE is UNCHANGED -- op-legality
  // yields no illegal-op failures for it.
  //
  // D6 (AUDIT-06): NO `?? 'revise'` fail-open default. `loadLedger` always
  // stamps `mode` (defaulting to revise for pre-006 bytes), so a `CoverageLedger`
  // reaching this gate MUST carry one; an unstamped ledger is a caller defect,
  // not a compose edition to be silently waved through as revise. Fail LOUD --
  // the exact "fallbacks are bug factories" shape the finding names, in the one
  // direction the feature exists to prevent.
  if (ledger.mode === undefined) {
    throw new Error('coverage ledger has no mode stamp; cannot judge op legality');
  }
  const mode: Mode = ledger.mode;

  // D11 (AUDIT-08): the open-question-marker byte-survival obligation (R7/FR-013)
  // is COMPOSE-SCOPED, mirroring `lexiconApplicable`. In revise a marker is
  // ordinary prose a revision may legitimately RESOLVE by deleting, so it carries
  // no survival obligation; the source payload's markers are masked out below so
  // a dropped marker never withholds a revise verdict (with no report field to
  // explain the refusal). Compose keeps the full obligation.
  const openQuestionApplicable = mode === 'compose';
  for (const failure of checkOpLegality(mode, ledger.coverage, sourceUnits, editionUnits).failures) {
    if (failure.kind === 'compose-forbids-verbatim' || failure.kind === 'compose-forbids-cut') {
      failures.push({ kind: 'illegal-op', message: failure.message });
    }
  }

  // AUDIT-20260727-03: verbatim's obligation is byte IDENTITY -- it spends the
  // ENTIRE declared destination unit, so that destination's payload must NOT
  // remain available to corroborate any OTHER source unit that shares it. Consume
  // each BYTE-EQUAL verbatim destination's payload here, in a SEPARATE pre-pass,
  // so it is withdrawn from that destination's shared supply before ANY
  // represented/merged entry claims it -- regardless of ledger order.
  ledger.coverage.forEach((entry) => {
    // In compose, `verbatim` is an illegal disposition (folded above); it never
    // legitimately spends a destination's supply, so it takes no part in the
    // shared-supply consumption pre-pass.
    if (entry.op !== 'verbatim' || mode === 'compose') {
      return;
    }
    const destRefs = entry.edition_units ?? [];
    if (destRefs.length !== 1) {
      return; // arity fault -- reported by checkVerbatim in the main loop
    }
    const [destRef] = destRefs;
    if (destRef === undefined) {
      return;
    }
    const destKey = unitRefKey(destRef);
    const destContent = editionByKey.get(destKey);
    if (destContent === undefined) {
      return; // unresolved destination -- supplies nothing; the not-found stands
    }
    const sourceContent = sourceByKey.get(unitRefKey(entry.source_unit));
    if (sourceContent === undefined || sourceContent !== destContent) {
      // source-not-found / byte-mismatch -- both reported in the main loop; a
      // NON-verbatim (mismatched) destination is not "spent" by an identity copy.
      return;
    }
    const remaining = remainingByDest.get(destKey);
    if (remaining !== undefined) {
      consumeAgainstRemaining(remaining, extractPayload(destContent, lexicon));
    }
  });

  ledger.coverage.forEach((entry, index) => {
    opCounts[entry.op] += 1;

    // T020: an illegal compose disposition (`verbatim`/`cut`) was already refused
    // via checkOpLegality above; do not additionally run its per-op mechanical
    // obligation (which would double-report, or spuriously pass a byte-exact
    // compose verbatim). Revise never reaches this guard.
    if (mode === 'compose' && (entry.op === 'verbatim' || entry.op === 'cut')) {
      return;
    }

    const sourceContent = sourceByKey.get(unitRefKey(entry.source_unit));
    if (sourceContent === undefined) {
      // A ref that resolves to no source unit is T012's accounting concern;
      // here we record it, and skip payload for it (nothing to extract from).
      failures.push({
        kind: 'structural',
        message: `op obligation: entry source unit ${refStr(entry.source_unit)} not found`,
      });
      return;
    }

    if (entry.op === 'cut') {
      // No destination obligation; cut is excluded from payload accounting.
      return;
    }

    // Non-cut: extract the SOURCE payload once -- feeds payloadChecked, the
    // uncorroborated signal, and (for represented/merged) survival. D11
    // (AUDIT-08): in revise, mask out open-question markers so they carry NO
    // required-byte obligation (compose-scoped, mirroring the lexicon gate).
    const rawSourcePayload = extractPayload(sourceContent, lexicon);
    const sourcePayload: UnitPayload = openQuestionApplicable
      ? rawSourcePayload
      : { ...rawSourcePayload, openQuestionMarkers: [] };
    for (const kind of PAYLOAD_KINDS) {
      payloadChecked[kind] += sourcePayload[kind].length;
    }
    if (isEmptyPayload(sourcePayload)) {
      uncorroboratedUnits += 1;
    }

    // AUDIT-20260726-19: a non-cut entry with no declared destination could
    // otherwise "survive" trivially against an empty union -- dropping prose by
    // labelling it `represented`/`merged` with no destinations. loadLedger
    // guards this upstream; re-affirm defensively (symmetric to verbatim/merged
    // arity) for a ledger built by other means.
    const destRefs = entry.edition_units ?? [];
    if (destRefs.length === 0) {
      failures.push({
        kind: 'structural',
        message: `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=${entry.op}: non-cut entry declares no destination`,
      });
      return;
    }

    // Resolve the declared destinations exactly as written (corroborate, D22).
    let anyDestMissing = false;
    for (const destRef of destRefs) {
      if (!editionByKey.has(unitRefKey(destRef))) {
        anyDestMissing = true;
        failures.push({
          kind: 'destination',
          message: `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=${entry.op}: declared destination ${refStr(destRef)} not found in edition`,
        });
      }
    }

    if (entry.op === 'verbatim') {
      checkVerbatim(entry, destRefs, editionByKey, anyDestMissing, sourceContent, failures);
    } else {
      // represented / merged: the source payload must survive within THIS
      // entry's OWN declared destination units' shared remaining supply. Skip
      // when a destination is unresolved -- an incomplete declared set cannot be
      // fairly corroborated (the missing-destination failure stands, and the
      // resolved subset is attributed for KIND downstream in classify-op-failures).
      if (!anyDestMissing) {
        const supplies = entryDestinationSupplies(entry, remainingByDest);
        checkGroupedSurvival(entry, supplies, sourcePayload, failures);
      }
      if (entry.op === 'merged') {
        checkMergedSharedDestination(entry, index, destinationOwners, failures);
      }
    }
  });

  return {
    ok: failures.length === 0,
    failures,
    opCounts,
    payloadChecked,
    uncorroboratedUnits,
    lexiconApplicable: lexicon !== undefined && lexicon.length > 0,
  };
}

/** verbatim: exactly one destination whose bytes equal the source bytes exactly. */
function checkVerbatim(
  entry: CoverageEntry,
  destRefs: readonly UnitRef[],
  editionByKey: Map<string, string>,
  anyDestMissing: boolean,
  sourceContent: string,
  failures: OpFailure[],
): void {
  // loadLedger guarantees exactly one destination; assert defensively for a
  // ledger built by other means.
  if (destRefs.length !== 1) {
    failures.push({
      kind: 'structural',
      message: `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=verbatim: expected exactly one destination, got ${destRefs.length}`,
    });
    return;
  }
  if (anyDestMissing) {
    // The single destination did not resolve; the not-found failure stands.
    return;
  }
  const [destRef] = destRefs;
  if (destRef === undefined) {
    return; // unreachable: length === 1 above
  }
  const destContent = editionByKey.get(unitRefKey(destRef));
  if (destContent !== undefined && destContent !== sourceContent) {
    failures.push({
      kind: 'verbatim',
      message: `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=verbatim: destination bytes differ from source unit bytes`,
    });
  }
}

/**
 * represented/merged: source payload survives (multiset) within THIS entry's own
 * declared destination units' SHARED remaining supplies, decrementing them in
 * place (AUDIT-20260728-04/-14, AUDIT-20260726-17).
 */
function checkGroupedSurvival(
  entry: CoverageEntry,
  supplies: readonly RemainingSupply[],
  sourcePayload: UnitPayload,
  failures: OpFailure[],
): void {
  const missingByKind = consumeAcrossDestinations(supplies, sourcePayload);
  // One failure per missing item, kinds in fixed order, items in source order.
  // Per-source attribution stays in the message (which source unit went unmet).
  for (const kind of PAYLOAD_KINDS) {
    for (const item of missingByKind[kind]) {
      failures.push({
        kind: FAILURE_KIND_BY_PAYLOAD[kind],
        message: `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=${entry.op}: ${KIND_LABEL[kind]} ${item} does not survive into declared destinations`,
      });
    }
  }
}

/**
 * merged additionally: at least one declared destination is ALSO named by
 * ANOTHER entry's `edition_units` (D8, the condition that makes `merged`
 * mechanically distinct from `represented`). loadLedger enforces this; we
 * re-affirm defensively for a ledger built by other means.
 */
function checkMergedSharedDestination(
  entry: CoverageEntry,
  index: number,
  owners: Map<string, Set<number>>,
  failures: OpFailure[],
): void {
  const shares = (entry.edition_units ?? []).some((destRef) => {
    const owningIndexes = owners.get(unitRefKey(destRef));
    if (owningIndexes === undefined) {
      return false;
    }
    return Array.from(owningIndexes).some((other) => other !== index);
  });
  if (!shares) {
    failures.push({
      kind: 'structural',
      message: `op obligation: op=merged entry for ${refStr(entry.source_unit)} shares no destination with another entry`,
    });
  }
}


// ---- helpers --------------------------------------------------------------

/** Map from `sha256:<hex>#<occurrence>` to a unit's `content`. */
function indexUnits(units: readonly SourceUnit[]): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const unit of units) {
    byKey.set(`sha256:${unit.contentHash}#${unit.occurrenceIndex}`, unit.content);
  }
  return byKey;
}

/** Map every declared destination ref -> the set of entry indexes that name it. */
function buildDestinationOwners(coverage: readonly CoverageEntry[]): Map<string, Set<number>> {
  const owners = new Map<string, Set<number>>();
  coverage.forEach((entry, index) => {
    for (const destRef of entry.edition_units ?? []) {
      const key = unitRefKey(destRef);
      const set = owners.get(key) ?? new Set<number>();
      set.add(index);
      owners.set(key, set);
    }
  });
  return owners;
}

function isEmptyPayload(payload: UnitPayload): boolean {
  return (
    payload.quotes.length === 0 &&
    payload.citations.length === 0 &&
    payload.numerics.length === 0 &&
    payload.lexiconTerms.length === 0 &&
    payload.openQuestionMarkers.length === 0
  );
}

/** Normalize a `UnitRef.hash` to carry the `sha256:` prefix, without double-prefixing. */
function normalizedHash(ref: UnitRef): string {
  return ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
}

/** Lookup key for a ledger `UnitRef`: `sha256:<hex>#<occurrence>`. */
function unitRefKey(ref: UnitRef): string {
  return `${normalizedHash(ref)}#${ref.occurrence}`;
}

/** Human-legible ref for failure messages: `(sha256:<hex>, occurrence N)`. */
function refStr(ref: UnitRef): string {
  return `(${normalizedHash(ref)}, occurrence ${ref.occurrence})`;
}

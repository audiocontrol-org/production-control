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
import type { CoverageLedger, CoverageEntry, UnitRef } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';
import type { UnitPayload } from '@/payload/extract.ts';
import { buildRemaining, consumeAgainstRemaining } from '@/payload/match.ts';
import type { RemainingSupply } from '@/payload/match.ts';

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
  | 'structural';

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
  payloadChecked: { quotes: number; citations: number; numerics: number; lexiconTerms: number };
  /**
   * Count of non-cut entries whose SOURCE unit yields NO extractable payload
   * (empty across all kinds) -- the D12/FR-022 report-only signal. These entries
   * still pass; the count is surfaced for the operator to judge as weak evidence.
   */
  uncorroboratedUnits: number;
  /** True iff a non-empty lexicon was supplied (drives `lexicon`'s not-run state, D11). */
  lexiconApplicable: boolean;
}

/** The four payload kinds, in the order shortfalls are reported. */
const PAYLOAD_KINDS = ['quotes', 'citations', 'numerics', 'lexiconTerms'] as const;
type PayloadKind = (typeof PAYLOAD_KINDS)[number];

/** Human-legible singular label per payload kind, for failure messages. */
const KIND_LABEL: Record<PayloadKind, string> = {
  quotes: 'quote',
  citations: 'citation',
  numerics: 'numeric',
  lexiconTerms: 'lexicon term',
};

/** Structured failure kind per payload kind (AUDIT-20260726-23). */
const FAILURE_KIND_BY_PAYLOAD: Record<PayloadKind, OpFailureKind> = {
  quotes: 'quote',
  citations: 'citation',
  numerics: 'numeric',
  lexiconTerms: 'lexicon',
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

  // AUDIT-20260726-17: group non-cut entries into connected components by
  // SHARED destination refs, then build ONE remaining-supply multiset per
  // component from the UNION of that component's (unique) destination-unit
  // payloads. Merged entries that share a destination consume that supply
  // ONCE across the whole group -- one destination occurrence can no longer
  // discharge two source obligations (the cross-unit false-clean). Verbatim
  // (byte-equality) and represented (its own destinations, usually a singleton
  // group) flow through the SAME grouped path so the invariant is structural.
  const rootByEntry = assignComponents(ledger.coverage);
  const remainingByRoot = buildComponentRemaining(ledger.coverage, rootByEntry, editionByKey, lexicon);

  const failures: OpFailure[] = [];
  const opCounts = { verbatim: 0, represented: 0, merged: 0, cut: 0 };
  const payloadChecked = { quotes: 0, citations: 0, numerics: 0, lexiconTerms: 0 };
  let uncorroboratedUnits = 0;

  // AUDIT-20260727-03: verbatim's obligation is byte IDENTITY -- it spends the
  // ENTIRE declared destination unit, so that destination's payload must NOT
  // remain available to corroborate any OTHER source unit in the same component.
  // buildComponentRemaining unions verbatim destinations into the shared supply
  // too, but verbatim is checked by byte-equality and never consumed -- so
  // pre-fix a represented/merged entry sharing a verbatim destination was
  // dischargeable by the verbatim copy's bytes, its own payload never needing to
  // appear elsewhere (the cross-unit false-clean AUDIT-20260726-17, via verbatim).
  // Consume each BYTE-EQUAL verbatim destination's payload here, in a SEPARATE
  // pre-pass, so it is withdrawn before ANY represented/merged entry claims it --
  // regardless of ledger order.
  ledger.coverage.forEach((entry, index) => {
    if (entry.op !== 'verbatim') {
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
    const destContent = editionByKey.get(unitRefKey(destRef));
    if (destContent === undefined) {
      return; // unresolved destination -- supplies nothing; the not-found stands
    }
    const sourceContent = sourceByKey.get(unitRefKey(entry.source_unit));
    if (sourceContent === undefined || sourceContent !== destContent) {
      // source-not-found / byte-mismatch -- both reported in the main loop; a
      // NON-verbatim (mismatched) destination is not "spent" by an identity copy.
      return;
    }
    const remaining = componentRemaining(remainingByRoot, rootByEntry, index);
    consumeAgainstRemaining(remaining, extractPayload(destContent, lexicon));
  });

  ledger.coverage.forEach((entry, index) => {
    opCounts[entry.op] += 1;

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
    // uncorroborated signal, and (for represented/merged) survival.
    const sourcePayload = extractPayload(sourceContent, lexicon);
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
      // represented / merged: payload must survive across the SHARED component
      // supply. Skip when a destination is unresolved -- an incomplete declared
      // set cannot be fairly corroborated (the missing-destination failure stands).
      if (!anyDestMissing) {
        const remaining = componentRemaining(remainingByRoot, rootByEntry, index);
        checkGroupedSurvival(entry, remaining, sourcePayload, failures);
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
 * represented/merged: source payload survives (multiset) against the group's
 * SHARED remaining supply, decrementing it in place (AUDIT-20260726-17).
 */
function checkGroupedSurvival(
  entry: CoverageEntry,
  remaining: RemainingSupply,
  sourcePayload: UnitPayload,
  failures: OpFailure[],
): void {
  const missingByKind = consumeAgainstRemaining(remaining, sourcePayload);
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


// ---- grouping (AUDIT-20260726-17) -----------------------------------------

/**
 * Union-find over the NON-cut coverage entries: two entries are in the same
 * connected component iff they (transitively) share a declared destination
 * ref. Returns a map from each non-cut entry index to its component root.
 */
function assignComponents(coverage: readonly CoverageEntry[]): Map<number, number> {
  const parent = new Map<number, number>();
  coverage.forEach((entry, index) => {
    if (entry.op !== 'cut') {
      parent.set(index, index);
    }
  });

  const find = (start: number): number => {
    let root = start;
    for (;;) {
      const next = parent.get(root);
      if (next === undefined) {
        throw new Error(`op obligation: union-find root missing for entry index ${start}`);
      }
      if (next === root) {
        return root;
      }
      root = next;
    }
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };

  const entriesByDest = new Map<string, number[]>();
  coverage.forEach((entry, index) => {
    if (entry.op === 'cut') {
      return;
    }
    for (const destRef of entry.edition_units ?? []) {
      const key = unitRefKey(destRef);
      const indexes = entriesByDest.get(key) ?? [];
      indexes.push(index);
      entriesByDest.set(key, indexes);
    }
  });
  for (const indexes of entriesByDest.values()) {
    const [first, ...rest] = indexes;
    if (first === undefined) {
      continue;
    }
    for (const other of rest) {
      union(first, other);
    }
  }

  const rootByEntry = new Map<number, number>();
  coverage.forEach((entry, index) => {
    if (entry.op !== 'cut') {
      rootByEntry.set(index, find(index));
    }
  });
  return rootByEntry;
}

/**
 * Build ONE `RemainingSupply` per component root from the UNION of that
 * component's UNIQUE resolved destination-unit payloads. A destination named by
 * several entries in the group contributes its supply exactly once; unresolved
 * destinations contribute nothing (their per-entry not-found failure stands).
 */
function buildComponentRemaining(
  coverage: readonly CoverageEntry[],
  rootByEntry: Map<number, number>,
  editionByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
): Map<number, RemainingSupply> {
  const destKeysByRoot = new Map<number, Set<string>>();
  coverage.forEach((entry, index) => {
    if (entry.op === 'cut') {
      return;
    }
    const root = rootByEntry.get(index);
    if (root === undefined) {
      return;
    }
    const keys = destKeysByRoot.get(root) ?? new Set<string>();
    for (const destRef of entry.edition_units ?? []) {
      keys.add(unitRefKey(destRef));
    }
    destKeysByRoot.set(root, keys);
  });

  const remainingByRoot = new Map<number, RemainingSupply>();
  for (const [root, destKeys] of destKeysByRoot) {
    const destPayloads: UnitPayload[] = [];
    for (const key of destKeys) {
      const content = editionByKey.get(key);
      if (content === undefined) {
        continue; // unresolved destination -- supplies nothing
      }
      destPayloads.push(extractPayload(content, lexicon));
    }
    remainingByRoot.set(root, buildRemaining(destPayloads));
  }
  return remainingByRoot;
}

/** Resolve a non-cut entry's shared component supply; fail loud if absent. */
function componentRemaining(
  remainingByRoot: Map<number, RemainingSupply>,
  rootByEntry: Map<number, number>,
  index: number,
): RemainingSupply {
  const root = rootByEntry.get(index);
  if (root === undefined) {
    throw new Error(`op obligation: no component assigned for entry index ${index}`);
  }
  const remaining = remainingByRoot.get(root);
  if (remaining === undefined) {
    throw new Error(`op obligation: no remaining supply built for component root ${root}`);
  }
  return remaining;
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
    payload.lexiconTerms.length === 0
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

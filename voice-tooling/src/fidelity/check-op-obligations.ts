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
import { unionPayload, payloadSurvives } from '@/payload/match.ts';

/** Result of the `op_obligations` check (contract step 4, D8). */
export interface OpObligationResult {
  ok: boolean;
  failures: string[];
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

  const failures: string[] = [];
  const opCounts = { verbatim: 0, represented: 0, merged: 0, cut: 0 };
  const payloadChecked = { quotes: 0, citations: 0, numerics: 0, lexiconTerms: 0 };
  let uncorroboratedUnits = 0;

  ledger.coverage.forEach((entry, index) => {
    opCounts[entry.op] += 1;

    const sourceContent = sourceByKey.get(unitRefKey(entry.source_unit));
    if (sourceContent === undefined) {
      // A ref that resolves to no source unit is T012's accounting concern;
      // here we record it, and skip payload for it (nothing to extract from).
      failures.push(`op obligation: entry source unit ${refStr(entry.source_unit)} not found`);
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

    // Resolve the declared destinations exactly as written (corroborate, D22).
    const destRefs = entry.edition_units ?? [];
    const destContents: string[] = [];
    let anyDestMissing = false;
    for (const destRef of destRefs) {
      const destContent = editionByKey.get(unitRefKey(destRef));
      if (destContent === undefined) {
        anyDestMissing = true;
        failures.push(
          `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=${entry.op}: declared destination ${refStr(destRef)} not found in edition`,
        );
        continue;
      }
      destContents.push(destContent);
    }

    if (entry.op === 'verbatim') {
      checkVerbatim(entry, destRefs, destContents, anyDestMissing, sourceContent, failures);
    } else {
      // represented / merged: payload must survive across the destination union.
      // Skip when a destination is unresolved -- an incomplete declared set
      // cannot be fairly corroborated (the missing-destination failure stands).
      if (!anyDestMissing) {
        checkPayloadSurvival(entry, destContents, sourcePayload, lexicon, failures);
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
  destContents: readonly string[],
  anyDestMissing: boolean,
  sourceContent: string,
  failures: string[],
): void {
  // loadLedger guarantees exactly one destination; assert defensively for a
  // ledger built by other means.
  if (destRefs.length !== 1) {
    failures.push(
      `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=verbatim: expected exactly one destination, got ${destRefs.length}`,
    );
    return;
  }
  if (anyDestMissing) {
    // The single destination did not resolve; the not-found failure stands.
    return;
  }
  const destContent = destContents[0];
  if (destContent !== sourceContent) {
    failures.push(
      `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=verbatim: destination bytes differ from source unit bytes`,
    );
  }
}

/** represented/merged: source payload survives (multiset) across the destination union. */
function checkPayloadSurvival(
  entry: CoverageEntry,
  destContents: readonly string[],
  sourcePayload: UnitPayload,
  lexicon: readonly string[] | undefined,
  failures: string[],
): void {
  const union = unionPayload(destContents.map((content) => extractPayload(content, lexicon)));
  const survival = payloadSurvives(sourcePayload, union);
  if (survival.ok) {
    return;
  }
  // One failure per missing item, kinds in fixed order, items in source order.
  for (const kind of PAYLOAD_KINDS) {
    for (const item of survival.missingByKind[kind]) {
      failures.push(
        `op obligation: entry for source unit ${refStr(entry.source_unit)}, op=${entry.op}: ${KIND_LABEL[kind]} ${item} does not survive into declared destinations`,
      );
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
  failures: string[],
): void {
  const shares = (entry.edition_units ?? []).some((destRef) => {
    const owningIndexes = owners.get(unitRefKey(destRef));
    if (owningIndexes === undefined) {
      return false;
    }
    return Array.from(owningIndexes).some((other) => other !== index);
  });
  if (!shares) {
    failures.push(
      `op obligation: op=merged entry for ${refStr(entry.source_unit)} shares no destination with another entry`,
    );
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

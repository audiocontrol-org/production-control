// AUDIT-20260730-02: the DESTINATION-side open-question marker check (spec 006,
// R7/FR-013), the FABRICATION-direction counterpart to the survival obligation
// in `@/fidelity/check-op-obligations.ts`.
//
// Marker SURVIVAL (source -> edition) is a source-subset-of-destination
// containment check, so it cannot see a marker the EDITION invented that the
// spine never declared -- an overclaim that puts an unresolved-question claim in
// the spine's mouth about what the evidence left open (a trust-boundary event, a
// dropped marker merely degrades the edition). This check closes that direction:
// every `[OPEN-QUESTION: ...]` marker present in the edition MUST be byte-present
// in the spine, else a named refusal.
//
// Byte-presence is compared over `@/payload/extract.ts`'s EXTRACTED markers on
// BOTH sides (citation-masked, bracket-aware), so a marker faithfully preserved
// with its nested citation matches, and a nested citation that itself differs is
// the citation multiset's concern (`checkCitations`), not a false fabrication.
//
// Compose-only (D21, mirroring `check-no-copy.ts`): in revise a marker is
// ordinary prose a revision may legitimately author or resolve, so this check is
// a no-op -- `applicable: false`, never a failure. Pure and deterministic: no
// I/O, no re-derivation -- the caller derives source + edition units (via
// `deriveUnits`) and passes them in.

import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';

/** Result of the `open_question_fabrication` check (compose only). */
export interface OpenQuestionFabricationResult {
  ok: boolean;
  /** False for mode `revise` (default when `mode` is absent): a no-op, never a failure. */
  applicable: boolean;
  failures: string[];
  /** Count of DISTINCT edition markers verified against the spine (compose only). */
  checked: number;
}

/**
 * Verify every open-question marker in the EDITION is byte-present in the spine
 * -- compose mode only (R7/FR-013, AUDIT-02).
 *
 * @param ledger       the coverage ledger (its `mode` field gates applicability).
 * @param sourceUnits  the derived spine beats (the marker's required origin).
 * @param editionUnits the derived edition units to scan for fabricated markers.
 */
export function checkOpenQuestionFabrication(
  ledger: CoverageLedger,
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
): OpenQuestionFabricationResult {
  // D6 (AUDIT-06): NO `?? 'revise'` fail-open default. `loadLedger` always
  // stamps `mode`; an unstamped ledger reaching here is a caller defect, not a
  // compose edition to silently skip as a revise no-op. Fail LOUD.
  if (ledger.mode === undefined) {
    throw new Error(
      'coverage ledger has no mode stamp; cannot judge open-question marker fabrication',
    );
  }
  if (ledger.mode !== 'compose') {
    return { ok: true, applicable: false, failures: [], checked: 0 };
  }

  // AUDIT-33: compare markers as MULTISETS (count-sensitive), not sets. A set
  // comparison let an edition that repeats one spine-declared marker N times pass
  // (byte-present, and 1-of-1 subset of N-of-edition) -- but the surplus copies
  // are INVENTED unresolved-question claims the spine never made. Fabrication is
  // therefore: an edition marker whose occurrence COUNT exceeds the spine's count
  // (the absent-marker case is just count 0 in the spine).
  const spineCounts = countMarkers(sourceUnits);
  const editionCounts = countMarkers(editionUnits);

  const failures: string[] = [];
  // Iterate DISTINCT edition markers so there is one refusal per fabricated
  // marker (mirrors `checkCitations`'s per-distinct reporting granularity),
  // while the COMPARISON itself is count-sensitive.
  for (const [marker, editionCount] of editionCounts) {
    const spineCount = spineCounts.get(marker) ?? 0;
    if (editionCount > spineCount) {
      const surplus = editionCount - spineCount;
      failures.push(
        `open-question marker preservation: edition emits marker ${marker} ${editionCount} time(s) ` +
          `but the spine declares it ${spineCount} time(s) ` +
          `(fabrication: ${surplus} invented cop${surplus === 1 ? 'y' : 'ies'})`,
      );
    }
  }

  return { ok: failures.length === 0, applicable: true, failures, checked: editionCounts.size };
}

/** Count each `[OPEN-QUESTION: ...]` marker's occurrences across the given units (multiset). */
function countMarkers(units: readonly SourceUnit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unit of units) {
    for (const marker of extractPayload(unit.content).openQuestionMarkers) {
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }
  }
  return counts;
}

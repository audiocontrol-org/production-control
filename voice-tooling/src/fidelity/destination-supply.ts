// T013 support, split out at T027 (spec 006 Polish) to keep
// `@/fidelity/check-op-obligations.ts` within the project's file-size
// guideline (see CLAUDE.md): the per-destination-unit shared payload-supply
// builder (AUDIT-20260728-04/-14, AUDIT-20260726-17).
//
// Build ONE mutable remaining-supply multiset PER DISTINCT DESTINATION UNIT
// referenced by a non-cut entry, each seeded with THAT unit's extracted
// payload exactly once. There is no component/union-find pooling: each entry
// is corroborated ONLY by the destination units IT declared, and a
// destination named twice by one entry is still ONE unit contributing its
// supply once. Because the per-unit supplies are SHARED and decremented in
// place, a single destination occurrence consumed by one entry is
// unavailable to a later entry that declares the same destination unit --
// preserving the merged cross-unit constraint.

import type { CoverageEntry } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';
import { buildRemaining } from '@/payload/match.ts';
import type { RemainingSupply } from '@/payload/match.ts';
import { normalizeHash, unitRefKey } from '@/fidelity/run-support.ts';

/**
 * Build ONE mutable `RemainingSupply` per DISTINCT destination unit referenced
 * by any non-cut entry, keyed by `unitRefKey` and seeded with THAT unit's
 * extracted payload exactly once. A destination named by several entries (or
 * named twice by one entry) still yields a single shared supply for that unit --
 * there is no union-find pooling across entries. Unresolved destinations are
 * omitted (they supply nothing; their per-entry not-found failure stands).
 */
export function buildDestinationSupplies(
  coverage: readonly CoverageEntry[],
  editionByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
  markerObligationInForce: boolean,
): Map<string, RemainingSupply> {
  const byKey = new Map<string, RemainingSupply>();
  for (const entry of coverage) {
    if (entry.op === 'cut') {
      continue;
    }
    for (const destRef of entry.edition_units ?? []) {
      const key = unitRefKey(destRef);
      if (byKey.has(key)) {
        continue;
      }
      const content = editionByKey.get(key);
      if (content === undefined) {
        continue; // unresolved destination -- supplies nothing
      }
      // AUDIT-20260730-23: destination supplies MUST be extracted under the SAME
      // marker-scope as the source payload consumed against them, or a
      // marker-interior numeral would extract asymmetrically (source vs dest) and
      // the multiset survival check would false-pass/false-fail.
      byKey.set(key, buildRemaining([extractPayload(content, lexicon, { markerObligationInForce })]));
    }
  }
  return byKey;
}

/**
 * Resolve THIS entry's OWN declared destination units to their shared remaining
 * supplies, DEDUPED by unit (a destination named twice is one unit -- fixes
 * AUDIT-20260728-14). Callers reach this only when every declared destination
 * resolves, so a missing supply would be a builder invariant break -- fail loud.
 */
export function entryDestinationSupplies(
  entry: CoverageEntry,
  remainingByDest: Map<string, RemainingSupply>,
): RemainingSupply[] {
  const seen = new Set<string>();
  const supplies: RemainingSupply[] = [];
  for (const destRef of entry.edition_units ?? []) {
    const key = unitRefKey(destRef);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const supply = remainingByDest.get(key);
    if (supply === undefined) {
      throw new Error(
        `op obligation: no remaining supply built for declared destination ` +
          `(${normalizeHash(destRef.hash)}, occurrence ${destRef.occurrence})`,
      );
    }
    supplies.push(supply);
  }
  return supplies;
}

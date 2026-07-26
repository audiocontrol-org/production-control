// T014: multiset payload matching (FR-021, contract step 5, R4/D11).
//
// Matching is byte-exact, case-sensitive, and MULTISET: each source-side
// occurrence must be discharged by a DISTINCT destination-side occurrence. One
// destination occurrence can never satisfy two source obligations — this is the
// property a document-level set check silently loses (a term present once in the
// edition would "corroborate" ten source occurrences), and it is the primary
// false-clean risk this module exists to prevent.

import type { UnitPayload } from '@/payload/extract.ts';

/** The four payload kinds, matched independently. */
type PayloadKind = 'quotes' | 'citations' | 'numerics' | 'lexiconTerms';

/**
 * MULTISET containment: does `dest` contain every element of `source` with at
 * least the same multiplicity?
 *
 * Algorithm: build a frequency map of `dest`, then walk `source` in order,
 * decrementing the matching count for each element. An element with no remaining
 * count is a shortfall and is pushed to `missing` (so an item short by k copies
 * appears k times in `missing`, in source document order).
 *
 * Why NOT sort-and-compare: sorting both sides and comparing can be made to
 * respect multiplicity, but it destroys source document order for the shortfall
 * report and invites the subtler bug of comparing as SETS (deduped) — which
 * would call source `["7","7"]` against dest `["7"]` a match. The frequency-map
 * decrement makes "distinct destination occurrence per source occurrence"
 * explicit and keeps `missing` in source order.
 */
export function survivesMultiset(
  source: readonly string[],
  dest: readonly string[],
): { ok: boolean; missing: string[] } {
  const remaining = new Map<string, number>();
  for (const item of dest) {
    remaining.set(item, (remaining.get(item) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const item of source) {
    const count = remaining.get(item) ?? 0;
    if (count > 0) {
      remaining.set(item, count - 1);
    } else {
      missing.push(item);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Concatenate each field across the destination units (the destination UNION),
 * preserving order and multiplicity. This is the multiset over which a source
 * unit's payload survival is checked (unit-local, across an entry's declared
 * destinations).
 */
export function unionPayload(payloads: readonly UnitPayload[]): UnitPayload {
  const union: UnitPayload = {
    quotes: [],
    citations: [],
    numerics: [],
    lexiconTerms: [],
  };
  for (const payload of payloads) {
    union.quotes.push(...payload.quotes);
    union.citations.push(...payload.citations);
    union.numerics.push(...payload.numerics);
    union.lexiconTerms.push(...payload.lexiconTerms);
  }
  return union;
}

/**
 * Run `survivesMultiset` per payload kind and aggregate. `ok` is true only when
 * every kind survives; `missingByKind` names the shortfall for each kind (empty
 * arrays where that kind survived).
 */
export function payloadSurvives(
  sourcePayload: UnitPayload,
  destUnion: UnitPayload,
): { ok: boolean; missingByKind: Record<PayloadKind, string[]> } {
  const quotes = survivesMultiset(sourcePayload.quotes, destUnion.quotes);
  const citations = survivesMultiset(sourcePayload.citations, destUnion.citations);
  const numerics = survivesMultiset(sourcePayload.numerics, destUnion.numerics);
  const lexiconTerms = survivesMultiset(
    sourcePayload.lexiconTerms,
    destUnion.lexiconTerms,
  );
  return {
    ok: quotes.ok && citations.ok && numerics.ok && lexiconTerms.ok,
    missingByKind: {
      quotes: quotes.missing,
      citations: citations.missing,
      numerics: numerics.missing,
      lexiconTerms: lexiconTerms.missing,
    },
  };
}

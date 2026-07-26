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

/** The four payload kinds in fixed order, for iterating a whole payload. */
const PAYLOAD_KINDS: readonly PayloadKind[] = ['quotes', 'citations', 'numerics', 'lexiconTerms'];

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
 * A MUTABLE per-kind frequency map of destination supply still available to
 * discharge source obligations. Built ONCE per shared-destination group (see
 * `buildRemaining`) and decremented as each member entry's source payload is
 * matched against it (see `consumeAgainstRemaining`) — this is what makes one
 * destination occurrence dischargeable by at most ONE source occurrence ACROSS
 * a whole group, closing the cross-unit false-clean (AUDIT-20260726-17).
 */
export type RemainingSupply = Record<PayloadKind, Map<string, number>>;

/**
 * Build a shared `RemainingSupply` from the UNION of a group's destination-unit
 * payloads, per kind (order is irrelevant to a frequency map; multiplicity is
 * preserved). The caller passes each UNIQUE destination unit's payload exactly
 * once so a destination referenced by several entries in the group contributes
 * its supply only once.
 */
export function buildRemaining(destPayloads: readonly UnitPayload[]): RemainingSupply {
  const remaining: RemainingSupply = {
    quotes: new Map(),
    citations: new Map(),
    numerics: new Map(),
    lexiconTerms: new Map(),
  };
  for (const payload of destPayloads) {
    for (const kind of PAYLOAD_KINDS) {
      for (const item of payload[kind]) {
        remaining[kind].set(item, (remaining[kind].get(item) ?? 0) + 1);
      }
    }
  }
  return remaining;
}

/**
 * Decrement one source unit's payload against the SHARED `remaining` supply,
 * MUTATING it, and return the per-kind shortfall (source items with no remaining
 * supply, in source document order — an item short by k copies appears k times).
 * Because `remaining` is shared across a group and mutated in place, a later
 * member entry sees only the supply earlier members did not consume.
 */
export function consumeAgainstRemaining(
  remaining: RemainingSupply,
  sourcePayload: UnitPayload,
): Record<PayloadKind, string[]> {
  const missing: Record<PayloadKind, string[]> = {
    quotes: [],
    citations: [],
    numerics: [],
    lexiconTerms: [],
  };
  for (const kind of PAYLOAD_KINDS) {
    for (const item of sourcePayload[kind]) {
      const count = remaining[kind].get(item) ?? 0;
      if (count > 0) {
        remaining[kind].set(item, count - 1);
      } else {
        missing[kind].push(item);
      }
    }
  }
  return missing;
}

/**
 * Run multiset survival per payload kind against a destination union and
 * aggregate. `ok` is true only when every kind survives; `missingByKind` names
 * the shortfall for each kind (empty arrays where that kind survived).
 *
 * Expressed in terms of `buildRemaining`/`consumeAgainstRemaining` so the
 * single-destination case is literally the singleton-group case of the shared
 * consumption path — ONE multiset-survival source of truth (AUDIT-20260726-17).
 */
export function payloadSurvives(
  sourcePayload: UnitPayload,
  destUnion: UnitPayload,
): { ok: boolean; missingByKind: Record<PayloadKind, string[]> } {
  const remaining = buildRemaining([destUnion]);
  const missingByKind = consumeAgainstRemaining(remaining, sourcePayload);
  const ok = PAYLOAD_KINDS.every((kind) => missingByKind[kind].length === 0);
  return { ok, missingByKind };
}

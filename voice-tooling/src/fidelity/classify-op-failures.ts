// T016 failure classification for `@/fidelity/run.ts`: bucketing
// `checkOpObligations`'s flat failure strings (and unresolved-destination
// entries it cannot label by kind) under the ONE named payload check (of the
// ten in the coverage report) each belongs to. Split out of `run.ts` to keep
// that file within the project's file-size guideline (see CLAUDE.md).

import type { CoverageLedger, UnitRef } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';
import type { UnitPayload } from '@/payload/extract.ts';
import { payloadSurvives, unionPayload } from '@/payload/match.ts';
import { normalizeHash, unitRefKey } from '@/fidelity/run-support.ts';
import type { OpFailure, OpFailureKind } from '@/fidelity/check-op-obligations.ts';

/** The four named payload checks a payload-kind failure can be attributed to. */
export type PayloadCheckName = 'verbatim_quotes' | 'citations' | 'numeric_literals' | 'lexicon';

/**
 * Every named check an op-obligation failure can flip: the four payload checks
 * plus the `op_obligations` CATCH-ALL for kinds that map to no single payload
 * check (verbatim byte-identity, destination-accounting, structural). The verdict
 * derives from the named-check map ALONE (AUDIT-20260728-28), so EVERY failure
 * must flip SOME check here -- there is no `failures.length` side-channel.
 */
export type NamedCheck = PayloadCheckName | 'op_obligations';

/**
 * Named-check attribution per STRUCTURED op-failure kind (AUDIT-20260726-23,
 * AUDIT-20260728-28). `checkOpObligations` returns each failure with a `kind`
 * enum, so bucketing switches on that kind and NEVER regex-matches the
 * human-facing `message` (whose interpolated payload item -- a quoted span, a
 * citation, a lexicon term -- could contain a word like "numeric" and flip the
 * wrong named check, the exact prose-matching defect this replaces).
 *
 * The map is TOTAL over `OpFailureKind` (not `Partial`): quote/citation/numeric/
 * lexicon map to their payload checks; verbatim (byte identity), destination (an
 * unresolved edition ref carries no payload kind), and structural (arity, no
 * shared destination, empty destination, source not found) all map to the
 * `op_obligations` catch-all. Totality is the invariant: a future `OpFailureKind`
 * added without a mapping is a COMPILE error here, so no failure kind can ever
 * silently flip no check and let a `passed` verdict coexist with a failure
 * (AUDIT-20260727-18/-29, AUDIT-20260728-28).
 */
const CHECK_FOR_KIND: Record<OpFailureKind, NamedCheck> = {
  quote: 'verbatim_quotes',
  citation: 'citations',
  numeric: 'numeric_literals',
  lexicon: 'lexicon',
  verbatim: 'op_obligations',
  destination: 'op_obligations',
  structural: 'op_obligations',
  // An illegal compose disposition (verbatim/cut in compose, spec 006 US3) maps
  // to the catch-all: it is not a payload shortfall but a mode-legality fault,
  // and flipping this named check withholds the verdict.
  'illegal-op': 'op_obligations',
  // A dropped open-question marker (R7/FR-013, T027) has no dedicated named
  // check in the ten-check vocabulary -- like verbatim/destination/structural,
  // it maps to the `op_obligations` catch-all so the verdict is still withheld.
  'open-question-marker': 'op_obligations',
};

/**
 * Bucket every structured op-obligation failure under the named check it belongs
 * to, switching on `OpFailure.kind` (AUDIT-20260726-23). Because the map is total
 * and includes the `op_obligations` catch-all, EVERY failure flips some named
 * check -- no payload or structural obligation failure can silently vanish
 * without withholding the verdict (AUDIT-20260728-28).
 */
export function classifyOpFailures(failures: readonly OpFailure[]): Set<NamedCheck> {
  const affected = new Set<NamedCheck>();
  for (const failure of failures) {
    affected.add(CHECK_FOR_KIND[failure.kind]);
  }
  return affected;
}

/** Human-legible singular label per payload kind, matching
 * `check-op-obligations.ts`'s own `KIND_LABEL` (duplicated locally so the
 * synthesized "destination unresolved" diagnostics below read identically to
 * that module's "does not survive into declared destinations" messages). */
const KIND_LABEL = {
  quotes: 'quote',
  citations: 'citation',
  numerics: 'numeric',
  lexiconTerms: 'lexicon term',
} as const;
const KIND_TO_CHECK: Record<keyof typeof KIND_LABEL, PayloadCheckName> = {
  quotes: 'verbatim_quotes',
  citations: 'citations',
  numerics: 'numeric_literals',
  lexiconTerms: 'lexicon',
};
/** The payload kinds, explicitly typed so iteration needs no `Object.keys` assertion. */
const PAYLOAD_KINDS: readonly (keyof typeof KIND_LABEL)[] = [
  'quotes',
  'citations',
  'numerics',
  'lexiconTerms',
];

/**
 * Find every ledger entry whose declared destination(s) do NOT resolve to an
 * actually-derived edition unit (e.g. a byte-level edit changed the
 * destination's content-derived identity), and classify WHICH named payload
 * check(s) that entry's failure belongs to, by inspecting the entry's op and
 * its own source content's payload kinds. Also pushes a clarifying,
 * kind-specific diagnostic into `failures` for each such entry (the raw
 * `checkOpObligations` "not found in edition" string is already in `failures`
 * too — this supplements it, it does not replace it).
 *
 * An unresolved `edition_units` reference is ALWAYS a failure (AUDIT-20260728-24):
 * the ledger names an edition unit that does not exist. `checkOpObligations`
 * already records that as a `destination`-kind failure (which classifies to the
 * `op_obligations` catch-all and withholds the verdict); this function
 * SUPPLEMENTS it with clarifying, kind-specific human diagnostics -- it never
 * suppresses it.
 *
 * A `verbatim` entry's unresolved destination is a byte-identity fault; a
 * clarifying diagnostic is pushed and the entry flips `op_obligations`.
 *
 * For a `represented`/`merged` entry, survival is evaluated against the union of
 * its RESOLVED destinations ONLY (AUDIT-20260727-28), and PURELY for KIND
 * attribution: a payload item is reported as "does not survive" ONLY when it is
 * genuinely absent from every resolved destination -- never merely because a
 * sibling reference is dangling. When the payload DOES survive across the
 * resolved destinations, or there is no resolved destination at all (ZERO
 * resolve -- the paragraph is simply absent), NO "the payload survives ..."
 * blessing is emitted (AUDIT-20260728-24): the sole reported fault is the
 * unresolved reference, which flips the `op_obligations` catch-all so the verdict
 * is withheld regardless of payload.
 */
export function findUnresolvedDestinationChecks(
  ledger: CoverageLedger,
  sourceByKey: Map<string, string>,
  editionByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
  failures: string[],
): Set<NamedCheck> {
  const affected = new Set<NamedCheck>();

  for (const entry of ledger.coverage) {
    if (entry.op === 'cut') {
      continue;
    }
    const destRefs = entry.edition_units ?? [];
    const anyUnresolved = destRefs.some((ref: UnitRef) => !editionByKey.has(unitRefKey(ref)));
    if (!anyUnresolved) {
      continue;
    }

    const srcRefLabel = `(${normalizeHash(entry.source_unit.hash)}, occurrence ${entry.source_unit.occurrence})`;

    if (entry.op === 'verbatim') {
      affected.add('op_obligations');
      failures.push(
        `op obligation: entry for source unit ${srcRefLabel}, op=verbatim: declared destination is absent from the edition -- its bytes no longer match any edition unit (byte mismatch)`,
      );
      continue;
    }

    // AUDIT-20260727-28: a payload item "does not survive" ONLY when it is absent
    // from the union of the entry's RESOLVED destinations -- not merely because
    // SOME sibling reference is dangling. Compute survival against the resolved
    // union only, and report a "does not survive" for genuinely-missing items
    // alone. This is KIND ATTRIBUTION for the human report; it NEVER suppresses
    // the unresolved-reference failure (AUDIT-20260728-24), which fires below.
    const content = sourceByKey.get(unitRefKey(entry.source_unit));
    const payload = content !== undefined ? extractPayload(content, lexicon) : undefined;
    const resolvedDestPayloads: UnitPayload[] = [];
    for (const ref of destRefs) {
      const destContent = editionByKey.get(unitRefKey(ref));
      if (destContent !== undefined) {
        resolvedDestPayloads.push(extractPayload(destContent, lexicon));
      }
    }

    let reportedGenuineShortfall = false;
    // Attribute genuinely-missing payload items to their named checks. With SOME
    // destinations resolved this is survival against the resolved subset; with
    // ZERO resolved (the union is empty) every payload item is genuinely missing
    // (it survives nowhere among the declared destinations), which is honest --
    // NOT the fabricated non-survival AUDIT-20260727-28 guards against (that was
    // reporting missing while it survives in a RESOLVED sibling). The blessing
    // -24 forbids is the ELSE branch below, never this genuine-shortfall path.
    if (payload !== undefined) {
      const { missingByKind } = payloadSurvives(payload, unionPayload(resolvedDestPayloads));
      for (const kind of PAYLOAD_KINDS) {
        if (kind === 'lexiconTerms' && !(lexicon !== undefined && lexicon.length > 0)) {
          continue;
        }
        for (const item of missingByKind[kind]) {
          affected.add(KIND_TO_CHECK[kind]);
          reportedGenuineShortfall = true;
          failures.push(
            `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: ${KIND_LABEL[kind]} ${item} does not survive into declared destinations (destination unresolved)`,
          );
        }
      }
    }
    if (!reportedGenuineShortfall) {
      // No genuine resolved-subset shortfall to attribute (the payload survives
      // in the resolved subset, there is no extractable payload, or ZERO
      // destinations resolve). The unresolved destination REFERENCE is itself the
      // fault (AUDIT-20260728-24) -- named honestly WITHOUT any "the payload
      // survives" blessing that would bless an entry whose paragraph is simply
      // absent. It flips `op_obligations` so the verdict is withheld regardless of
      // payload (the `destination`-kind failure `checkOpObligations` recorded
      // classifies there too -- this supplements it with a clearer message).
      affected.add('op_obligations');
      failures.push(
        `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: a declared destination reference does not resolve to an edition unit`,
      );
    }
  }

  return affected;
}

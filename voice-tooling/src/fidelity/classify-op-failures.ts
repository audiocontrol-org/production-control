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

/** The four named payload checks a failure can be attributed to. */
export type PayloadCheckName = 'verbatim_quotes' | 'citations' | 'numeric_literals' | 'lexicon';

/**
 * Named-check attribution per STRUCTURED op-failure kind (AUDIT-20260726-23).
 * `checkOpObligations` returns each failure with a `kind` enum, so bucketing
 * switches on that kind and NEVER regex-matches the human-facing `message`
 * (whose interpolated payload item -- a quoted span, a citation, a lexicon
 * term -- could contain a word like "numeric" and flip the wrong named check,
 * the exact prose-matching defect this replaces). `destination` (a "not found"
 * destination carries no payload kind) is classified per-entry instead (see
 * `findUnresolvedDestinationChecks`); `structural` failures (arity, no shared
 * destination, empty destination, source not found) attribute to no single
 * named payload check.
 */
const CHECK_FOR_KIND: Partial<Record<OpFailureKind, PayloadCheckName>> = {
  quote: 'verbatim_quotes',
  verbatim: 'verbatim_quotes',
  citation: 'citations',
  numeric: 'numeric_literals',
  lexicon: 'lexicon',
};

/**
 * Bucket every structured op-obligation failure under the named payload
 * check(s) it belongs to, switching on `OpFailure.kind` (AUDIT-20260726-23).
 * Together with `findUnresolvedDestinationChecks` (which handles unresolved
 * destinations per-entry), this ensures no payload obligation failure can
 * silently vanish without flipping a named check to `failed`.
 */
export function classifyOpFailures(failures: readonly OpFailure[]): Set<PayloadCheckName> {
  const affected = new Set<PayloadCheckName>();
  for (const failure of failures) {
    const check = CHECK_FOR_KIND[failure.kind];
    if (check !== undefined) {
      affected.add(check);
    }
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
 * A `verbatim` entry's unresolved destination is always classified under
 * `verbatim_quotes` regardless of payload (verbatim's obligation is byte
 * identity, not a specific payload kind).
 *
 * For a `represented`/`merged` entry, survival is evaluated against the union of
 * its RESOLVED destinations only (AUDIT-20260727-28): a payload item is reported
 * as "does not survive" ONLY when it is genuinely absent from every resolved
 * destination -- never merely because a sibling reference is dangling. When the
 * payload DOES survive across the resolved destinations (or there is no
 * extractable payload at all), the sole fault is the unresolved destination
 * REFERENCE, which is named as such and falls back to `verbatim_quotes` (there
 * is no dedicated named check for edition-side destination accounting in the
 * ten-check schema).
 */
export function findUnresolvedDestinationChecks(
  ledger: CoverageLedger,
  sourceByKey: Map<string, string>,
  editionByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
  failures: string[],
): Set<PayloadCheckName> {
  const affected = new Set<PayloadCheckName>();

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
      affected.add('verbatim_quotes');
      failures.push(
        `op obligation: entry for source unit ${srcRefLabel}, op=verbatim: declared destination is absent from the edition -- its bytes no longer match any edition unit (byte mismatch)`,
      );
      continue;
    }

    // AUDIT-20260727-28: distinguish two genuinely different faults that the
    // pre-fix code conflated. A payload item "does not survive" ONLY when it is
    // absent from the union of the entry's RESOLVED destinations -- not merely
    // because SOME sibling destination reference is dangling. Pre-fix, ANY
    // unresolved reference caused EVERY source payload item to be reported as
    // "does not survive", fabricating a survival failure even when the payload
    // demonstrably survives in a resolved sibling destination (the false-clean
    // INVERSION). Here we compute survival against the resolved union only, and
    // report a "does not survive" for the genuinely-missing items alone.
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
      // The entry's payload (if any) DOES survive across the resolved
      // destinations -- the only fault is the unresolved destination REFERENCE
      // itself (a `destination`/structural fault already reported verbatim by
      // `checkOpObligations`). Name THAT accurately rather than fabricating a
      // survival failure; there is no dedicated named check for edition-side
      // destination accounting in the ten-check schema, so it attributes to
      // `verbatim_quotes` (see this function's doc comment). The verdict is
      // additionally withheld structurally by `withholdVerdictOnUnclassifiedFailures`.
      affected.add('verbatim_quotes');
      failures.push(
        `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: a declared destination reference does not resolve to an edition unit (the payload survives across the resolved destinations; the unresolved reference is the fault)`,
      );
    }
  }

  return affected;
}

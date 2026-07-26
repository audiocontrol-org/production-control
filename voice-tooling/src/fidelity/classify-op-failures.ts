// T016 failure classification for `@/fidelity/run.ts`: bucketing
// `checkOpObligations`'s flat failure strings (and unresolved-destination
// entries it cannot label by kind) under the ONE named payload check (of the
// ten in the coverage report) each belongs to. Split out of `run.ts` to keep
// that file within the project's file-size guideline (see CLAUDE.md).

import type { CoverageLedger, UnitRef } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';
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
 * identity, not a specific payload kind). A `represented`/`merged` entry
 * with NO extractable payload at all also falls back to `verbatim_quotes` —
 * there is no dedicated named check for edition-side destination accounting
 * in the ten-check schema, and this case is otherwise unreachable given the
 * fixtures this validator has been proven against.
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

    const content = sourceByKey.get(unitRefKey(entry.source_unit));
    const payload = content !== undefined ? extractPayload(content, lexicon) : undefined;
    let matchedAny = false;
    if (payload !== undefined) {
      for (const kind of PAYLOAD_KINDS) {
        if (kind === 'lexiconTerms' && !(lexicon !== undefined && lexicon.length > 0)) {
          continue;
        }
        for (const item of payload[kind]) {
          affected.add(KIND_TO_CHECK[kind]);
          matchedAny = true;
          failures.push(
            `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: ${KIND_LABEL[kind]} ${item} does not survive into declared destinations (destination unresolved)`,
          );
        }
      }
    }
    if (!matchedAny) {
      // No extractable payload at all: there is no dedicated named check for
      // edition-side destination accounting in the ten-check schema, so this
      // falls back to `verbatim_quotes` (see this function's doc comment).
      affected.add('verbatim_quotes');
      failures.push(
        `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: declared destination is absent from the edition -- its content no longer matches any edition unit`,
      );
    }
  }

  return affected;
}

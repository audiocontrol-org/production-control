// T015: citation no-fabrication + allow-list resolution, and the D14
// quote-dialect conditional (contract steps 5-6, FR-023/024, data-model D13/D14).
//
// `checkOpObligations` (T013) already corroborates that a non-`cut` source
// unit's citations SURVIVE into their declared destinations (multiset,
// unit-local). That leaves two citation-specific guarantees survival alone
// does NOT cover, both document-level and both about the EDITION's markers
// rather than the source's:
//
// - **No fabrication (FR-023)**: an edition must never contain a citation
//   marker that never appeared anywhere in the source. Survival checking
//   alone cannot catch this -- a marker invented out of thin air has no
//   source occurrence to fail to survive.
// - **Allow-list resolution (FR-023)**: every edition citation marker must
//   resolve within the frontmatter `citation_allowlist`. `checkLedgerStructure`
//   / `checkSourceCitationAllowlist` (T011) already confirms the SOURCE's own
//   citations are all allow-listed; this module checks the EDITION's markers
//   against that same allow-list.
//
// Deliberately NOT checked here: that every source citation reappears in the
// edition. A `cut` source unit's citations legitimately vanish (R4/D13), so
// document-level set equality is explicitly rejected -- only an
// edition-subset-of-source check (plus allow-list membership) is performed.

import { extractPayload } from '@/payload/extract.ts';

/** Result of the citation no-fabrication + allow-list check (contract step 6). */
export interface CitationCheckResult {
  ok: boolean;
  failures: string[];
  /** Count of DISTINCT edition citation markers verified. */
  checked: number;
  /** Always the literal `'multiset'` -- labels this as the same matching family as T013/T014's payload checks, even though the no-fabrication/allow-list obligations here are set-membership tests (see module doc comment for why document-level set EQUALITY is not required). */
  mode: 'multiset';
}

/**
 * Check the edition's citation markers against the source (no fabrication)
 * and against the declared allow-list (resolution), both document-level
 * (FR-023). Does NOT require every source citation to reappear in the edition
 * -- a `cut` unit's citations are allowed to disappear (D13); only the
 * reverse (nothing in the edition that isn't in the source, and everything in
 * the edition is allow-listed) is enforced here.
 *
 * @param sourceBody Source content with frontmatter already stripped by the caller.
 * @param editionBody Edition content with frontmatter already stripped by the caller.
 * @param sourceAllowlist The source's declared `citation_allowlist` (frontmatter).
 */
export function checkCitations(
  sourceBody: string,
  editionBody: string,
  sourceAllowlist: readonly string[],
): CitationCheckResult {
  const sourceCitations = extractPayload(sourceBody).citations;
  const editionCitations = extractPayload(editionBody).citations;

  const sourceSet = new Set(sourceCitations);
  const allowlistSet = new Set(sourceAllowlist);
  const distinctEditionMarkers = dedupeInOrder(editionCitations);

  const failures: string[] = [];
  for (const marker of distinctEditionMarkers) {
    if (!sourceSet.has(marker)) {
      failures.push(
        `citation preservation: edition contains citation ${marker} absent from the source (fabrication)`,
      );
    }
    if (!allowlistSet.has(marker)) {
      failures.push(
        `citation preservation: edition citation ${marker} does not resolve within the frontmatter allow-list`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    checked: distinctEditionMarkers.length,
    mode: 'multiset',
  };
}

/** Preserve first-occurrence document order while removing repeats. */
function dedupeInOrder(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// ---- D14: the quote-dialect conditional -----------------------------------
//
// FR-024: quote-bank identity/transformation semantics apply ONLY when a
// quote bank is an ACTUAL declared input of the target; otherwise the
// obligation is the simpler exact-block preservation. A voice edition's v1
// path never declares a quote bank as input (spec.md Edge Cases: "a voice
// edition is prose with no quote bank declared as input: quoted-span checks
// use exact-block preservation, NOT quote-bank identity semantics") -- so
// `quoteBankDeclared` is always `false` on the v1 path, and quote survival is
// exactly the exact-block preservation T013/T014's `quotes` payload already
// performs. `quote-bank-identity` is named here ONLY so the conditional is
// honest about the OTHER branch existing, not as a second implemented path:
// quote-bank identity/transformation semantics couple to the deferred
// asset-bank capability and have no implementation on this validator.
// `assertQuoteDialectSupported` is the fail-loud guard a caller (T016) uses
// to refuse that branch outright rather than silently falling back to
// exact-block (which would be the WRONG dialect for a declared quote bank,
// not merely an unimplemented one).

/** The two quote-fidelity dialects a target could in principle declare (D14). */
export type QuoteDialect = 'exact-block' | 'quote-bank-identity';

/**
 * Resolve which quote-fidelity dialect a target's obligation is, per FR-024.
 * `quoteBankDeclared` MUST be `false` for every v1 voice-edition target (no
 * quote bank is ever a declared input on this path); the `true` branch is
 * named for completeness and is NOT exercised by this validator -- see
 * `assertQuoteDialectSupported`.
 */
export function resolveQuoteObligation(quoteBankDeclared: boolean): QuoteDialect {
  return quoteBankDeclared ? 'quote-bank-identity' : 'exact-block';
}

/**
 * Fail-loud guard: refuse to proceed when the resolved dialect is
 * `quote-bank-identity`, since that semantics couples to the deferred
 * asset-bank capability and has no implementation in v1. Callers MUST invoke
 * this alongside `resolveQuoteObligation` rather than silently treating a
 * declared quote bank as exact-block (a false pass on the wrong dialect,
 * exactly the false-clean failure mode this feature is built to avoid).
 *
 * @throws Error naming the deferred asset-bank coupling when `quoteBankDeclared` is true.
 */
export function assertQuoteDialectSupported(quoteBankDeclared: boolean): void {
  if (quoteBankDeclared) {
    throw new Error(
      'quote-bank identity semantics require the deferred asset-bank capability; not available in v1 — declare no quote-bank input',
    );
  }
}

// T016 support helpers for `@/fidelity/run.ts`: source-unit indexing, the
// lightweight (pre-structural-validation) `source.hash` read, the two
// report-only recomputations (D12's uncorroborated-units count, and the
// numeric/citation-marker overlap correction), and frontmatter/allow-list
// parsing for the SOURCE document. Split out of `run.ts` to keep that file
// within the project's file-size guideline (see CLAUDE.md).

import { parse as parseYamlText } from 'yaml';
import { isRecord } from '@/util/is-record.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger, UnitRef } from '@/schema/ledger.ts';
import {
  extractFrontmatterBlock,
  parseCitationAllowlist,
} from '@/fidelity/check-ledger-structure.ts';
import { extractPayload } from '@/payload/extract.ts';

/** Matches a footnote-style citation marker, mirroring `payload/extract.ts`'s
 * own `CITATION_RE` (duplicated locally — see `countProseNumerics`). */
const CITATION_MARKER_PATTERN = /\[\^[^\]\s]+\]/g;

/**
 * Best-effort read of `source.hash` directly from the ledger's raw YAML,
 * WITHOUT running full structural validation (`checkLedgerStructure`) —
 * source_hash is checked strictly before ledger_structure (D15), so it must
 * not depend on the ledger being otherwise well-formed. Returns `undefined`
 * when the YAML doesn't parse, or `source.hash` isn't a string, in which case
 * the caller treats this as a `ledger_structure` failure instead (a
 * schema-malformed ledger is a decided failure, never cannot-decide).
 */
export function readDeclaredSourceHash(ledgerYaml: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = parseYamlText(ledgerYaml);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const sourceField = parsed['source'];
  if (!isRecord(sourceField)) {
    return undefined;
  }
  const hash = sourceField['hash'];
  return typeof hash === 'string' ? hash : undefined;
}

// ---- source-unit indexing (mirrors check-op-obligations.ts's private map) --

export function normalizeHash(hash: string): string {
  return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
}

export function unitRefKey(ref: UnitRef): string {
  return `${normalizeHash(ref.hash)}#${ref.occurrence}`;
}

export function indexSourceUnits(units: readonly SourceUnit[]): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const unit of units) {
    byKey.set(`sha256:${unit.contentHash}#${unit.occurrenceIndex}`, unit.content);
  }
  return byKey;
}

// ---- report-only recomputations (D12, and the numeric/citation overlap) ---

/**
 * Count of numeric literals across every non-cut entry's SOURCE content,
 * EXCLUDING any digit run that is actually a citation marker's own label
 * (e.g. the "1" inside `[^1]`). `payload/extract.ts`'s `NUMERIC_RE` and
 * `CITATION_RE` scan independently, so a digit-labeled footnote marker like
 * `[^1]` is legitimately extracted as BOTH a citation AND a numeric literal —
 * correct for `check-op-obligations.ts`'s survival bookkeeping (both sides of
 * a destination carry the same marker, so it never causes a false failure),
 * but misleading as the coverage report's `numeric_literals.checked` count: a
 * footnote label is not a free-standing numeral in the prose, and double-
 * booking the same span under two payload kinds overstates what was checked.
 * This does not alter pass/fail semantics (the `numeric_literals` PASS/FAIL
 * state still reads directly off `checkOpObligations`'s own failures) — it
 * only corrects the displayed count.
 */
export function countProseNumerics(
  ledger: CoverageLedger,
  sourceByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
): number {
  let count = 0;
  for (const entry of ledger.coverage) {
    if (entry.op === 'cut') {
      continue;
    }
    const content = sourceByKey.get(unitRefKey(entry.source_unit));
    if (content === undefined) {
      continue;
    }
    const withoutCitationMarkers = content.replace(CITATION_MARKER_PATTERN, '');
    count += extractPayload(withoutCitationMarkers, lexicon).numerics.length;
  }
  return count;
}

/**
 * Count of `represented`/`merged` entries whose SOURCE unit yields no
 * extractable payload at all (D12/FR-022) — deliberately excludes `verbatim`
 * (proven by byte match, not payload survival) and `cut` (no destination
 * obligation), unlike `checkOpObligations`'s own `uncorroboratedUnits` field.
 */
export function countUncorroboratedUnits(
  ledger: CoverageLedger,
  sourceByKey: Map<string, string>,
  lexicon: readonly string[] | undefined,
): number {
  let count = 0;
  for (const entry of ledger.coverage) {
    if (entry.op !== 'represented' && entry.op !== 'merged') {
      continue;
    }
    const content = sourceByKey.get(unitRefKey(entry.source_unit));
    if (content === undefined) {
      continue;
    }
    const payload = extractPayload(content, lexicon);
    const isEmpty =
      payload.quotes.length === 0 &&
      payload.citations.length === 0 &&
      payload.numerics.length === 0 &&
      payload.lexiconTerms.length === 0;
    if (isEmpty) {
      count += 1;
    }
  }
  return count;
}

// ---- frontmatter stripping / allow-list parsing (mirrors check-ledger-structure.ts) --

export function stripFrontmatterBody(text: string): string {
  const block = extractFrontmatterBlock(text);
  return block === undefined ? text : block.body;
}

export function parseSourceCitationAllowlist(sourceText: string): string[] {
  const block = extractFrontmatterBlock(sourceText);
  return block === undefined ? [] : parseCitationAllowlist(block.yamlText);
}

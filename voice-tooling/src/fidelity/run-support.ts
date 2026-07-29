// T016 support helpers for `@/fidelity/run.ts`: source-unit indexing, the
// lightweight (pre-structural-validation) `source.hash` read, D12's
// uncorroborated-units count, and frontmatter/allow-list parsing for the
// SOURCE document. Split out of `run.ts` to keep that file within the
// project's file-size guideline (see CLAUDE.md).

import { parse as parseYamlText } from 'yaml';
import { isRecord } from '@/util/is-record.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger, UnitRef } from '@/schema/ledger.ts';
import {
  extractFrontmatterBlock,
  parseCitationAllowlist,
} from '@/fidelity/check-ledger-structure.ts';
import { extractPayload } from '@/payload/extract.ts';
import { aborted, type CheckResult } from '@/fidelity/report.ts';

// ---- generic run() helpers (moved from run.ts at T027 to keep it within the
// project's file-size guideline; see CLAUDE.md) -----------------------------

/**
 * Mark every check in `names` as `aborted` because an EARLIER check (`abortedBy`)
 * failed and the deterministic sequence never reached them (contract check
 * ordering) -- see `@/fidelity/report.ts`'s `aborted` state doc for why this is
 * a first-class discriminated state rather than a `not-run` with a flag.
 */
export function markAborted(
  checks: Record<string, CheckResult>,
  names: readonly string[],
  abortedBy: string,
): void {
  for (const name of names) {
    checks[name] = aborted(`aborted: ${abortedBy} failed`);
  }
}

/** Render a caught value's message, whether or not it is an `Error`. */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

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

// ---- report-only recomputation (D12) --------------------------------------

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
      payload.lexiconTerms.length === 0 &&
      payload.openQuestionMarkers.length === 0;
    if (isEmpty) {
      count += 1;
    }
  }
  return count;
}

// ---- open-question marker declaration (R7/FR-013, T027) -------------------

/**
 * Whether the SOURCE declares at least one `[OPEN-QUESTION: ...]` marker
 * (R7/FR-013) -- scanned across every derived source unit's own content,
 * independent of which units a ledger entry happens to cover. Drives the
 * report's `open_question_markers` trust-boundary field: `'enforced'` only
 * when this returns `true` (the mechanical marker-survival guarantee -- via
 * `@/payload/extract.ts`'s `openQuestionMarkers` payload field -- is actually
 * ACTIVE for this spine), never a claim that some marker syntax OTHER than
 * the declared one was checked.
 */
export function sourceDeclaresOpenQuestionMarker(sourceUnits: readonly SourceUnit[]): boolean {
  return sourceUnits.some((unit) => extractPayload(unit.content).openQuestionMarkers.length > 0);
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

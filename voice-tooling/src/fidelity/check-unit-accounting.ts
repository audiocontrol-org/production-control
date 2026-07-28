import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger, UnitRef } from '@/schema/ledger.ts';

/**
 * Result of the `unit_accounting` check (contract step 3, FR-017, SC-001,
 * data-model.md "Structural validity rules"): every source unit DERIVED from
 * the supplied source draft must have EXACTLY ONE ledger `coverage` entry
 * naming it, and every ledger entry must name a source unit that actually
 * exists.
 */
export interface UnitAccountingResult {
  ok: boolean;
  failures: string[];
  total: number;
}

/**
 * Confirm every derived source unit carries exactly one ledger disposition,
 * and every ledger entry names a real derived source unit (SC-001). Pure and
 * deterministic: no I/O, no re-derivation -- the caller re-derives source
 * units via `deriveUnits` and passes them in. Does not throw for accounting
 * failures -- a cannot-DERIVE condition (e.g. invalid UTF-8) is the caller's
 * concern, not this function's; this function only reasons about units it
 * has already been handed.
 *
 * Failure order is deterministic: missing/duplicate dispositions in source
 * document order (the order `sourceUnits` was given in), followed by
 * unknown-source-unit ledger entries in ledger `coverage` order.
 */
export function checkUnitAccounting(
  sourceUnits: readonly SourceUnit[],
  ledger: CoverageLedger,
): UnitAccountingResult {
  const failures: string[] = [];

  const entryCountByUnitKey = new Map<string, number>();
  for (const entry of ledger.coverage) {
    const key = unitRefKey(entry.source_unit);
    entryCountByUnitKey.set(key, (entryCountByUnitKey.get(key) ?? 0) + 1);
  }

  const sourceUnitKeys = new Set<string>();
  for (const unit of sourceUnits) {
    const key = sourceUnitKey(unit);
    sourceUnitKeys.add(key);
    const entryCount = entryCountByUnitKey.get(key) ?? 0;

    if (entryCount === 0) {
      failures.push(
        `unit accounting: source unit (hash ${normalizedHash(unit)}, occurrence ${unit.occurrenceIndex}) has no ledger entry`,
      );
    } else if (entryCount > 1) {
      // Defensive: loadLedger already refuses duplicate dispositions, but a
      // caller could hand this function a ledger built by other means.
      failures.push(
        `unit accounting: source unit (hash ${normalizedHash(unit)}, occurrence ${unit.occurrenceIndex}) has ${entryCount} ledger entries, expected exactly one`,
      );
    }
  }

  for (const entry of ledger.coverage) {
    const key = unitRefKey(entry.source_unit);
    if (!sourceUnitKeys.has(key)) {
      failures.push(
        `unit accounting: ledger entry references unknown source unit (hash ${normalizeRefHash(entry.source_unit)}, occurrence ${entry.source_unit.occurrence})`,
      );
    }
  }

  return { ok: failures.length === 0, failures, total: sourceUnits.length };
}

/** `sha256:<hex>` form of a derived source unit's bare-hex `contentHash`. */
function normalizedHash(unit: SourceUnit): string {
  return `sha256:${unit.contentHash}`;
}

/** Stable identity key for a derived source unit: normalized hash + occurrence. */
function sourceUnitKey(unit: SourceUnit): string {
  return `${normalizedHash(unit)} ${unit.occurrenceIndex}`;
}

/** Ensure a ledger `UnitRef.hash` carries the `sha256:` prefix, without double-prefixing. */
function normalizeRefHash(ref: UnitRef): string {
  return ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
}

/** Stable identity key for a ledger `UnitRef`: normalized hash + occurrence. */
function unitRefKey(ref: UnitRef): string {
  return `${normalizeRefHash(ref)} ${ref.occurrence}`;
}

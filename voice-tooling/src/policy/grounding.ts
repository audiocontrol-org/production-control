import type { SourceUnit } from '@/units/derive.ts';
import type { GroundingRecord, UnitRef } from '@/schema/ledger.ts';

/**
 * Shared, PURE edition-side grounding accounting policy (spec 006 R8,
 * data-model.md "Edition-side grounding accounting", contracts/
 * voice-compose-cli.md Refusals). ONE source of truth imported by BOTH the
 * producer pre-emit self-check (revise/preflight.ts) and the fidelity validator
 * (fidelity/run.ts) -- neither entry point depends on the other, so shared
 * normative logic never becomes self-certification (Principle VI).
 *
 * The reverse accounting: the source-directed ledger says where every beat
 * GOES; grounding says where every composed edition unit CAME FROM. Because a
 * source-directed ledger silently permits invented prose (a paragraph with no
 * beat behind it), grounding must be both EXHAUSTIVE and EXCLUSIVE:
 *
 *   - EXHAUSTIVE: every derived edition unit has exactly one grounding record.
 *   - EXCLUSIVE:  no edition unit has more than one record; no record names an
 *                 edition unit absent from the derived edition (dangling record).
 *   - grounded references resolve: a `grounded` record's `beats` each name a
 *                 real derived source unit (dangling beat otherwise).
 *
 * This module does NOT judge semantic support (whether the prose is actually
 * warranted by its beats) -- that is reported not-checkable. It never throws
 * for a policy violation; it returns named, structured failures (matching the
 * fidelity/ result style: `{ ok, failures }` with each failure carrying a
 * structured `kind` plus a human-readable `message`).
 */

export type GroundingFailureKind = 'unaccounted' | 'duplicate' | 'dangling-record' | 'dangling-beat';

export interface GroundingFailure {
  kind: GroundingFailureKind;
  message: string;
}

export interface GroundingResult {
  ok: boolean;
  failures: GroundingFailure[];
}

/**
 * Verify the grounding records exhaustively and exclusively account for the
 * derived edition units, and that every grounded beat resolves to a real source
 * unit. Pure and deterministic: no I/O, no re-derivation -- the caller
 * re-derives edition + source units (via `deriveUnits`) and passes them in.
 *
 * Failure order is deterministic: unaccounted/duplicate failures in edition
 * document order (the order `editionUnits` was given in), followed by
 * dangling-record then dangling-beat failures in `groundingRecords` order.
 *
 * @param groundingRecords the ledger's grounding records (compose only).
 * @param editionUnits     the derived edition units to account for.
 * @param sourceUnits      the derived source beats, for resolving `beats` refs.
 */
export function checkGrounding(
  groundingRecords: readonly GroundingRecord[],
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
): GroundingResult {
  const failures: GroundingFailure[] = [];

  // Count records per edition-unit key.
  const recordCountByKey = new Map<string, number>();
  for (const record of groundingRecords) {
    const key = unitRefKey(record.edition_unit);
    recordCountByKey.set(key, (recordCountByKey.get(key) ?? 0) + 1);
  }

  // EXHAUSTIVE + EXCLUSIVE (duplicate), walked in edition document order.
  const editionKeys = new Set<string>();
  for (const unit of editionUnits) {
    const key = sourceUnitKey(unit);
    editionKeys.add(key);
    const count = recordCountByKey.get(key) ?? 0;
    if (count === 0) {
      failures.push({
        kind: 'unaccounted',
        message: `grounding: edition unit (${unitLabel(unit)}) has no grounding record`,
      });
    } else if (count > 1) {
      failures.push({
        kind: 'duplicate',
        message: `grounding: edition unit (${unitLabel(unit)}) has ${count} records`,
      });
    }
  }

  // EXCLUSIVE (dangling record): a record naming a unit not in the edition.
  for (const record of groundingRecords) {
    if (!editionKeys.has(unitRefKey(record.edition_unit))) {
      failures.push({
        kind: 'dangling-record',
        message: `grounding: record references unknown edition unit (${refLabel(record.edition_unit)})`,
      });
    }
  }

  // grounded beats resolve to real source units.
  const sourceKeys = new Set<string>();
  for (const unit of sourceUnits) {
    sourceKeys.add(sourceUnitKey(unit));
  }
  for (const record of groundingRecords) {
    if (record.basis !== 'grounded') {
      continue;
    }
    for (const beat of record.beats ?? []) {
      if (!sourceKeys.has(unitRefKey(beat))) {
        failures.push({
          kind: 'dangling-beat',
          message: `grounding: grounded record for edition unit (${refLabel(
            record.edition_unit,
          )}) references unknown beat (${refLabel(beat)})`,
        });
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

// ---- identity helpers (reuse units/derive.ts contentHash identity) ---------

/** `sha256:<hex>, occurrence N` label for a derived unit (fidelity/ style). */
function unitLabel(unit: SourceUnit): string {
  return `sha256:${unit.contentHash}, occurrence ${unit.occurrenceIndex}`;
}

/** `sha256:<hex>, occurrence N` label for a ledger `UnitRef`. */
function refLabel(ref: UnitRef): string {
  const hash = ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
  return `${hash}, occurrence ${ref.occurrence}`;
}

/** Identity key for a derived unit: normalized hash + occurrence. */
function sourceUnitKey(unit: SourceUnit): string {
  return `sha256:${unit.contentHash} ${unit.occurrenceIndex}`;
}

/** Identity key for a ledger `UnitRef`: normalized hash + occurrence. */
function unitRefKey(ref: UnitRef): string {
  const hash = ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
  return `${hash} ${ref.occurrence}`;
}

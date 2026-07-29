import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageEntry, Mode, UnitRef } from '@/schema/ledger.ts';

/**
 * Shared, PURE, mode-scoped op-legality policy (spec 006 R8, data-model.md
 * "CoverageEntry (EXTENDED -- mode-scoped legality)", contracts/
 * voice-compose-cli.md Refusals). ONE source of truth imported by BOTH the
 * producer pre-emit self-check (revise/preflight.ts) and the fidelity validator
 * (fidelity/run.ts) -- neither entry point depends on the other, so shared
 * normative logic never becomes self-certification (Principle VI).
 *
 * This module judges ONLY op legality per mode. It does NOT check unit
 * accounting, payload/citation survival, or grounding -- those are separate
 * checks. It never throws for a policy violation; it returns named, structured
 * failures (matching the fidelity/ result style: `{ ok, failures }` with each
 * failure carrying a structured `kind` plus a human-readable `message`).
 *
 * Legality (data-model.md table):
 *   op           revise                                  compose
 *   verbatim     legal (destination byte-exact, TASK-50) ILLEGAL
 *   represented  legal                                   legal
 *   merged       legal                                   legal
 *   cut          legal (requires reason)                 ILLEGAL (v1)
 * Plus (compose only, R4): no `represented`/`merged` destination edition unit
 * may be normalized-byte-identical to a complete source beat it represents.
 *
 * "Normalized-byte-identical" reuses the SAME identity the rest of the system
 * uses: a derived unit's `contentHash` (sha256 of its exact bytes, computed by
 * units/derive.ts and keyed by units/identity.ts). Two units are identical iff
 * their content hashes are equal -- no new normalization is invented here.
 */

export type OpLegalityFailureKind =
  | 'compose-forbids-verbatim'
  | 'compose-forbids-cut'
  | 'whole-unit-copy'
  | 'revise-verbatim-drift';

export interface OpLegalityFailure {
  kind: OpLegalityFailureKind;
  message: string;
}

export interface OpLegalityResult {
  ok: boolean;
  failures: OpLegalityFailure[];
}

/**
 * Judge every coverage entry's op against the given mode's legality rules.
 * Pure and deterministic: no I/O, no re-derivation. The caller re-derives the
 * source beats + edition units (via `deriveUnits`) and passes them in.
 *
 * Failure order is deterministic and follows `coverage` order: for each entry,
 * its illegal-op failure (if any) precedes its whole-unit-copy failures (in
 * `edition_units` order), which precede its verbatim-drift failure.
 *
 * @param mode      the producer operation the ledger declares.
 * @param coverage  the coverage entries (already structurally validated).
 * @param sourceUnits  the derived source beats, for resolving `source_unit` refs.
 * @param editionUnits the derived edition units, for resolving `edition_units` refs.
 */
export function checkOpLegality(
  mode: Mode,
  coverage: readonly CoverageEntry[],
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
): OpLegalityResult {
  const sourceByKey = indexUnits(sourceUnits);
  const editionByKey = indexUnits(editionUnits);
  const failures: OpLegalityFailure[] = [];

  coverage.forEach((entry, index) => {
    if (mode === 'compose') {
      if (entry.op === 'verbatim') {
        failures.push({
          kind: 'compose-forbids-verbatim',
          message: `compose-mode forbids verbatim: coverage entry ${index}`,
        });
      } else if (entry.op === 'cut') {
        failures.push({
          kind: 'compose-forbids-cut',
          message: `compose-mode forbids cut: coverage entry ${index}`,
        });
      } else {
        collectWholeUnitCopies(entry, sourceByKey, editionByKey, failures);
      }
      return;
    }

    // revise
    if (entry.op === 'verbatim') {
      collectVerbatimDrift(entry, sourceByKey, editionByKey, failures);
    }
  });

  return { ok: failures.length === 0, failures };
}

/**
 * R4 whole-unit no-copy: for a `represented`/`merged` compose entry, no
 * destination edition unit may be byte-identical (same `contentHash`) to the
 * complete source beat it represents. Refs that do not resolve to a real
 * derived unit are an accounting concern (checked elsewhere), not a copy, so
 * they are skipped here.
 */
function collectWholeUnitCopies(
  entry: CoverageEntry,
  sourceByKey: ReadonlyMap<string, SourceUnit>,
  editionByKey: ReadonlyMap<string, SourceUnit>,
  failures: OpLegalityFailure[],
): void {
  const beat = sourceByKey.get(unitRefKey(entry.source_unit));
  if (beat === undefined) {
    return;
  }
  for (const destRef of entry.edition_units ?? []) {
    const dest = editionByKey.get(unitRefKey(destRef));
    if (dest === undefined) {
      continue;
    }
    if (dest.contentHash === beat.contentHash) {
      failures.push({
        kind: 'whole-unit-copy',
        message: `whole-unit copy: edition unit (${unitLabel(dest)}) is byte-identical to beat (${unitLabel(
          beat,
        )})`,
      });
    }
  }
}

/**
 * TASK-50 predicate (revise): each `verbatim` op's destination must be
 * byte-exact to its source unit. Drift (destinations that resolve but whose
 * bytes differ) is refused, naming the unit. Unresolved refs are an accounting
 * concern (checked elsewhere), not drift, so they are skipped here.
 */
function collectVerbatimDrift(
  entry: CoverageEntry,
  sourceByKey: ReadonlyMap<string, SourceUnit>,
  editionByKey: ReadonlyMap<string, SourceUnit>,
  failures: OpLegalityFailure[],
): void {
  const beat = sourceByKey.get(unitRefKey(entry.source_unit));
  if (beat === undefined) {
    return;
  }
  for (const destRef of entry.edition_units ?? []) {
    const dest = editionByKey.get(unitRefKey(destRef));
    if (dest === undefined) {
      continue;
    }
    if (dest.contentHash !== beat.contentHash) {
      failures.push({
        kind: 'revise-verbatim-drift',
        message: `revise verbatim drift: unit (${unitLabel(beat)}) destination differs from source`,
      });
    }
  }
}

// ---- identity helpers (reuse units/derive.ts contentHash identity) ---------

/** Index derived units by their `sha256:<hash> <occurrence>` identity key. */
function indexUnits(units: readonly SourceUnit[]): Map<string, SourceUnit> {
  const byKey = new Map<string, SourceUnit>();
  for (const unit of units) {
    byKey.set(sourceUnitKey(unit), unit);
  }
  return byKey;
}

/** `sha256:<hex>, occurrence N` label for a derived unit (fidelity/ style). */
function unitLabel(unit: SourceUnit): string {
  return `sha256:${unit.contentHash}, occurrence ${unit.occurrenceIndex}`;
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

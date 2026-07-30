import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageEntry, GroundingRecord, UnitRef } from '@/schema/ledger.ts';

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
 *   - grounded records CARRY beats: a `grounded` record with an empty/absent
 *                 `beats` list is invented prose self-labeled grounded (D5,
 *                 AUDIT-04/17) -- refused `grounded-without-beats`.
 *   - basis is ANCHORED to coverage (D8, AUDIT-21): `coverage` and `grounding`
 *                 are two views of the SAME beat<->edition mapping and must
 *                 agree, so `basis` is not an unfalsifiable self-label.
 *
 * This module does NOT judge semantic support (whether the prose is actually
 * warranted by its beats) -- that is reported not-checkable. It never throws
 * for a policy violation; it returns named, structured failures (matching the
 * fidelity/ result style: `{ ok, failures }` with each failure carrying a
 * structured `kind` plus a human-readable `message`).
 */

export type GroundingFailureKind =
  | 'unaccounted'
  | 'duplicate'
  | 'dangling-record'
  | 'dangling-beat'
  | 'grounded-without-beats'
  | 'basis-contradicts-coverage';

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
 * @param coverage         the ledger's coverage entries, for the D8 basis<->
 *                         coverage reconciliation (checkGrounding is only ever
 *                         called in compose context -- the revise producer path
 *                         never reaches it, and the validator gates it on
 *                         mode === 'compose' -- so reconciliation always runs).
 */
export function checkGrounding(
  groundingRecords: readonly GroundingRecord[],
  editionUnits: readonly SourceUnit[],
  sourceUnits: readonly SourceUnit[],
  coverage: readonly CoverageEntry[],
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

  // grounded records CARRY beats (D5, AUDIT-04/17), and those beats resolve to
  // real source units.
  //
  // INVARIANT: a `grounded` record asserts its edition unit came FROM named
  // source beats; a `grounded` record with zero beats therefore asserts prose
  // that came from nothing -- invented prose self-labeled grounded. The
  // universally-quantified `for (const beat of record.beats ?? [])` below is
  // vacuously satisfied when `beats` is empty/absent, so the emptiness must be
  // refused explicitly here. This policy is the ONE source of truth both the
  // producer preflight and the validator rest on, so it self-defends even
  // though the wire schema/parser also guard the field.
  const sourceKeys = new Set<string>();
  for (const unit of sourceUnits) {
    sourceKeys.add(sourceUnitKey(unit));
  }
  for (const record of groundingRecords) {
    if (record.basis !== 'grounded') {
      continue;
    }
    if ((record.beats?.length ?? 0) === 0) {
      failures.push({
        kind: 'grounded-without-beats',
        message: `grounding: grounded record for edition unit (${refLabel(
          record.edition_unit,
        )}) names no beats -- a grounded unit must cite the source beat(s) it came from`,
      });
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

  reconcileBasisAgainstCoverage(groundingRecords, coverage, failures);

  return { ok: failures.length === 0, failures };
}

/**
 * D8 (AUDIT-21) basis<->coverage reconciliation, compose only.
 *
 * INVARIANT: `coverage` and `grounding` are two views of the SAME beat<->
 * edition mapping, so they must agree -- `basis` is anchored, not an
 * unfalsifiable self-label. Concretely:
 *
 *   - FORWARD (coverage proves a beat lands): any edition unit named as a
 *     destination of a non-`cut` coverage entry demonstrably CARRIES that
 *     entry's source beat, so it MUST appear in grounding as `basis: 'grounded'`
 *     with that beat among its `beats`. It cannot claim `connective`/`framing`
 *     (which assert "not itself a beat") and thereby escape the grounded
 *     obligation. (A destination with NO grounding record at all is left to the
 *     EXHAUSTIVE `unaccounted` check above -- not re-reported here.)
 *   - REVERSE (grounding claims a beat): a `grounded` record's `beats` must be a
 *     SUBSET of the beats whose coverage names that unit -- a grounded record
 *     may not invent a beat->unit link coverage never declared.
 *
 * Refuses `basis-contradicts-coverage`, naming the offending unit + beat.
 */
function reconcileBasisAgainstCoverage(
  groundingRecords: readonly GroundingRecord[],
  coverage: readonly CoverageEntry[],
  failures: GroundingFailure[],
): void {
  // Which beats does coverage prove each destination unit carries?
  const coverageBeatsByDest = new Map<string, Set<string>>();
  // The declared (beat, dest) pairs, for the reverse subset check.
  const coveragePairs = new Set<string>();
  for (const entry of coverage) {
    if (entry.op === 'cut') {
      continue;
    }
    const beatKey = unitRefKey(entry.source_unit);
    for (const destRef of entry.edition_units ?? []) {
      const destKey = unitRefKey(destRef);
      const beats = coverageBeatsByDest.get(destKey) ?? new Set<string>();
      beats.add(beatKey);
      coverageBeatsByDest.set(destKey, beats);
      coveragePairs.add(pairKey(beatKey, destKey));
    }
  }

  // Which beats does grounding label each destination unit grounded on, and
  // does the destination have any grounding record at all?
  const groundedBeatsByDest = new Map<string, Set<string>>();
  const destsWithRecord = new Set<string>();
  for (const record of groundingRecords) {
    const destKey = unitRefKey(record.edition_unit);
    destsWithRecord.add(destKey);
    if (record.basis !== 'grounded') {
      continue;
    }
    const grounded = groundedBeatsByDest.get(destKey) ?? new Set<string>();
    for (const beat of record.beats ?? []) {
      grounded.add(unitRefKey(beat));
    }
    groundedBeatsByDest.set(destKey, grounded);
  }

  // FORWARD: each beat coverage proves a destination carries must be reflected
  // as a grounded beat on that destination.
  for (const [destKey, requiredBeats] of coverageBeatsByDest) {
    if (!destsWithRecord.has(destKey)) {
      continue; // absence is the `unaccounted` check's concern, not a contradiction.
    }
    const grounded = groundedBeatsByDest.get(destKey) ?? new Set<string>();
    for (const beatKey of requiredBeats) {
      if (!grounded.has(beatKey)) {
        failures.push({
          kind: 'basis-contradicts-coverage',
          message:
            `grounding: coverage proves edition unit (${keyLabel(destKey)}) carries beat ` +
            `(${keyLabel(beatKey)}), but grounding does not label it grounded on that beat`,
        });
      }
    }
  }

  // REVERSE: a grounded record may not claim a beat->unit link coverage never
  // declared.
  for (const record of groundingRecords) {
    if (record.basis !== 'grounded') {
      continue;
    }
    const destKey = unitRefKey(record.edition_unit);
    for (const beat of record.beats ?? []) {
      const beatKey = unitRefKey(beat);
      if (!coveragePairs.has(pairKey(beatKey, destKey))) {
        failures.push({
          kind: 'basis-contradicts-coverage',
          message:
            `grounding: grounded record claims edition unit (${keyLabel(destKey)}) came from beat ` +
            `(${keyLabel(beatKey)}), but no coverage entry maps that beat to it`,
        });
      }
    }
  }
}

function pairKey(beatKey: string, destKey: string): string {
  return `${beatKey} -> ${destKey}`;
}

/** Human-readable label for an identity key of the form `sha256:<hex> <occ>`. */
function keyLabel(key: string): string {
  const lastSpace = key.lastIndexOf(' ');
  if (lastSpace === -1) {
    return key;
  }
  return `${key.slice(0, lastSpace)}, occurrence ${key.slice(lastSpace + 1)}`;
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

/** Identity key for a derived unit: exact-byte contentHash + occurrence. */
function sourceUnitKey(unit: SourceUnit): string {
  return `sha256:${unit.contentHash} ${unit.occurrenceIndex}`;
}

/** Identity key for a ledger `UnitRef`: exact-byte contentHash + occurrence. */
function unitRefKey(ref: UnitRef): string {
  const hash = ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
  return `${hash} ${ref.occurrence}`;
}

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
 * may be byte-identical to a complete source beat it represents.
 *
 * Comparison basis: whole-unit no-copy AND revise verbatim byte-exactness are
 * decided by the derived unit's EXACT-BYTE `contentHash` (sha256 of the unit's
 * unnormalized bytes, from units/derive.ts) plus its `occurrenceIndex`. Two
 * units are "identical" iff their content hashes are equal. There is NO
 * within-unit byte normalization anywhere: the only normalization is unit
 * DERIVATION itself (leading-frontmatter strip, separator-run grouping, fence
 * handling in units/derive.ts), which produces the units -- it is not a second
 * canonicalizing pass over a unit's bytes. This is what R4's phrase "normalized
 * bytes" refers to (the derivation), not a per-unit canonicalization.
 *
 * WARNING: do NOT "fix" this to compare units/identity.ts `unitId`. `unitId`
 * binds the SOURCE identity (`encodeURIComponent(sourceIdentity):hash:occ`), so
 * a source beat and its edition destination -- derived under different source
 * identities -- would NEVER share a `unitId`, and the whole-unit-copy /
 * verbatim-drift checks would silently never match (false-clean). Cross-
 * document comparison here is correctly keyed on `contentHash` + occurrence.
 */

export type OpLegalityFailureKind =
  | 'compose-forbids-verbatim'
  | 'compose-forbids-cut'
  | 'whole-unit-copy'
  | 'revise-verbatim-drift'
  /**
   * An undeclared cut (AUDIT-20260730-34): a non-`cut` coverage entry whose
   * declared `edition_units` is EMPTY or ABSENT. Its beat is declared
   * represented/merged/verbatim yet lands NOWHERE -- a cut spelled differently.
   * Illegal in BOTH modes: it bypasses compose's no-cut invariant AND revise's
   * cut-requires-reason obligation with a one-token label change.
   */
  | 'op-without-destination';

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

  // Edition-unit identity keys already reported as a whole-unit copy, so the
  // exhaustive sweep below never double-reports a unit the pairwise check named.
  const reportedCopyKeys = new Set<string>();

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
      } else if (hasNoDestination(entry)) {
        failures.push(undeclaredCutFailure(entry, index));
      } else {
        collectWholeUnitCopies(entry, sourceByKey, editionByKey, failures, reportedCopyKeys);
      }
      return;
    }

    // revise
    if (entry.op !== 'cut' && hasNoDestination(entry)) {
      // AUDIT-34: an undeclared cut is illegal in revise too -- a `represented`/
      // `merged`/`verbatim` beat that lands nowhere sidesteps the cut-requires-
      // reason obligation. (A real `cut` legitimately declares no destination.)
      failures.push(undeclaredCutFailure(entry, index));
      return;
    }
    if (entry.op === 'verbatim') {
      collectVerbatimDrift(entry, sourceByKey, editionByKey, failures);
    }
  });

  if (mode === 'compose') {
    sweepWholeUnitCopies(sourceUnits, editionUnits, failures, reportedCopyKeys);
  }

  return { ok: failures.length === 0, failures };
}

/**
 * R4 whole-unit no-copy, PAIRWISE arm: for a `represented`/`merged` compose
 * entry, no destination edition unit it names may be byte-identical (same
 * `contentHash`) to the complete source beat it represents. Kept for its
 * clearer message (it names the specific coverage-declared beat/dest pair);
 * the exhaustive sweep below is the LOAD-BEARING arm. Refs that do not resolve
 * to a real derived unit are an accounting concern (checked elsewhere), not a
 * copy, so they are skipped here. Every dest reported here is recorded in
 * `reportedCopyKeys` so the sweep does not re-report it.
 */
function collectWholeUnitCopies(
  entry: CoverageEntry,
  sourceByKey: ReadonlyMap<string, SourceUnit>,
  editionByKey: ReadonlyMap<string, SourceUnit>,
  failures: OpLegalityFailure[],
  reportedCopyKeys: Set<string>,
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
    if (dest.contentHash === beat.contentHash && !isExemptFromNoCopy(beat)) {
      reportedCopyKeys.add(sourceUnitKey(dest));
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
 * R4 whole-unit no-copy, EXHAUSTIVE SWEEP (AUDIT-18) -- the LOAD-BEARING arm.
 *
 * INVARIANT: every DERIVED edition unit that byte-equals ANY complete derived
 * source beat is a whole-unit copy, regardless of how -- or whether -- coverage
 * declares it. The pairwise arm keys off `coverage.edition_units`, so a
 * byte-identical copy escapes it by being declared under a different beat, or
 * accounted for only on the grounding side (a unit no coverage entry names).
 * This sweep closes that hole by comparing the derived edition set against the
 * derived source set directly, trusting no declaration.
 *
 * BOUNDARY (R4): whole-unit byte-identity IS the deterministic copy line for a
 * SUBSTANTIVE-PROSE beat. A genuine re-voicing is never byte-identical to its
 * beat, so a substantive edition unit that byte-equals a substantive beat is --
 * by the rule's definition -- a copy, not a false positive.
 *
 * EXEMPTION (AUDIT-20260730-36/-39): the no-copy invariant applies ONLY to a
 * beat that is SUBSTANTIVE PROSE (has re-voiceable prose). A beat whose ENTIRE
 * content is REQUIRED-PAYLOAD-THAT-MUST-SURVIVE -- a marker-only
 * `[OPEN-QUESTION: ...]` beat, a bare citation, a markdown heading, or a
 * structural rule -- is EXEMPT (see `isExemptFromNoCopy`). Survival/structure
 * MANDATES those exact bytes (FR-013 for the marker; the document's structure
 * for a heading/rule), so there is nothing to re-voice: no-copy and marker-
 * survival would otherwise be mutually unsatisfiable and deadlock an honest
 * producer. The exemption is PURE-payload-only -- a marker or citation embedded
 * in re-voiceable prose leaves the beat substantive, so a verbatim copy of it
 * still fails. This is the invariant this module and `check-no-copy.ts` share.
 *
 * Units already named by the pairwise arm (in `reportedCopyKeys`) are skipped
 * so a coverage-declared copy is reported exactly once, with the clearer
 * pairwise message. Sweep failures are appended in edition document order.
 */
function sweepWholeUnitCopies(
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
  failures: OpLegalityFailure[],
  reportedCopyKeys: Set<string>,
): void {
  const beatByHash = new Map<string, SourceUnit>();
  for (const beat of sourceUnits) {
    if (!beatByHash.has(beat.contentHash)) {
      beatByHash.set(beat.contentHash, beat);
    }
  }
  for (const unit of editionUnits) {
    const key = sourceUnitKey(unit);
    if (reportedCopyKeys.has(key)) {
      continue;
    }
    const beat = beatByHash.get(unit.contentHash);
    if (beat === undefined) {
      continue;
    }
    if (isExemptFromNoCopy(beat)) {
      continue;
    }
    reportedCopyKeys.add(key);
    failures.push({
      kind: 'whole-unit-copy',
      message: `whole-unit copy: edition unit (${unitLabel(unit)}) is byte-identical to beat (${unitLabel(
        beat,
      )})`,
    });
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

// ---- undeclared-cut + no-copy-exemption predicates ------------------------

/** A non-`cut` entry with an empty/absent declared destination set (AUDIT-34). */
function hasNoDestination(entry: CoverageEntry): boolean {
  return (entry.edition_units ?? []).length === 0;
}

/** The `op-without-destination` failure for an undeclared-cut entry. */
function undeclaredCutFailure(entry: CoverageEntry, index: number): OpLegalityFailure {
  return {
    kind: 'op-without-destination',
    message:
      `undeclared cut: coverage entry ${index} (op '${entry.op}') declares no edition_units ` +
      `destination -- a non-cut op that lands nowhere is a cut in disguise`,
  };
}

/**
 * Open-question marker (R7/FR-013) and citation-marker recognizers, kept in sync
 * (by `.source`) with `@/payload/extract.ts` so "what must survive" here matches
 * "what is required payload" there without a runtime dependency on that module.
 */
const OPEN_QUESTION_RE = /\[OPEN-QUESTION:(?:[^\[\]]|\[[^\[\]]*\])*\]/g;
const CITATION_RE = /\[\^[^\]\s]+\]|\[[A-Z][A-Z0-9]*-[A-Z0-9-]+\]/g;
/** ATX markdown heading: up to three leading spaces, 1-6 `#`, a space, content. */
const HEADING_RE = /^ {0,3}#{1,6}\s+\S/;
/** Thematic break / structural rule: a run of `-`, `*`, or `_` (>=3), alone. */
const THEMATIC_BREAK_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/**
 * NO-COPY EXEMPTION (AUDIT-20260730-36/-39). A beat is EXEMPT from the whole-unit
 * no-copy rule -- its bytes are MANDATED, not chosen, so it cannot be "copied" --
 * iff it is NOT substantive prose. Concretely, a beat is exempt when it is one
 * of, after trimming surrounding whitespace:
 *
 *   - REQUIRED-PAYLOAD-ONLY: removing every `[OPEN-QUESTION: ...]` marker and
 *     every citation marker leaves only whitespace (a marker-only beat, a bare
 *     citation, or a combination). These bytes must survive byte-exact (FR-013 /
 *     citation survival), so re-voicing them is forbidden -- exempting them is
 *     the only way no-copy and survival are jointly satisfiable.
 *   - A single-line markdown HEADING (`## ...`): a structural label whose bytes
 *     are the document's structure, not re-voiceable prose.
 *   - A single-line THEMATIC BREAK / structural rule (`---`, `***`, `___`).
 *
 * The exemption is PURE-payload/structure-only: a marker or citation embedded in
 * prose that could be re-voiced (`Prose. [OPEN-QUESTION: ...]`) leaves
 * re-voiceable bytes behind, so the beat stays SUBSTANTIVE and a verbatim copy
 * of it is still a `whole-unit-copy` violation.
 */
function isExemptFromNoCopy(beat: SourceUnit): boolean {
  const trimmed = beat.content.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const isSingleLine = !trimmed.includes('\n');
  if (isSingleLine && (HEADING_RE.test(trimmed) || THEMATIC_BREAK_RE.test(trimmed))) {
    return true;
  }
  const withoutRequiredPayload = trimmed
    .replace(new RegExp(OPEN_QUESTION_RE.source, OPEN_QUESTION_RE.flags), '')
    .replace(new RegExp(CITATION_RE.source, CITATION_RE.flags), '');
  return withoutRequiredPayload.trim().length === 0;
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

/** Identity key for a derived unit: exact-byte contentHash + occurrence. */
function sourceUnitKey(unit: SourceUnit): string {
  return `sha256:${unit.contentHash} ${unit.occurrenceIndex}`;
}

/** Identity key for a ledger `UnitRef`: exact-byte contentHash + occurrence. */
function unitRefKey(ref: UnitRef): string {
  const hash = ref.hash.startsWith('sha256:') ? ref.hash : `sha256:${ref.hash}`;
  return `${hash} ${ref.occurrence}`;
}

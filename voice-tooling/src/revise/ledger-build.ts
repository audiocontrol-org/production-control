import { stringify as stringifyYaml } from 'yaml';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageEntry, CoverageLedger, GroundingRecord, Mode, UnitRef } from '@/schema/ledger.ts';
import type { ModelGroundingEntry, ModelReviseOutput } from '@/revise/protocol.ts';

/**
 * TASK-29: build the ledgered edition from the model's INDEX-BASED coverage.
 *
 * The model declared which of the edition units it wrote each source unit lands
 * in (0-based indices). This provider derives the source units and the edition
 * units MECHANICALLY (the exact same `deriveUnits` the `voice fidelity`
 * validator uses) and turns those declared indices into the hash-keyed
 * `UnitRef`s a `CoverageLedger` carries -- so the model never has to compute a
 * sha256 it cannot compute.
 *
 * spec 006 (T011) adds the `mode` stamp and, for `mode: 'compose'`, the same
 * index-to-hash resolution applied to the model's `grounding` declaration
 * (`@/revise/protocol.ts`'s `ModelGroundingEntry[]`): a `grounding[i].edition_unit`
 * index resolves against the DERIVED EDITION units (same array `coverage`'s
 * `edition_units` indices resolve against), and a `grounding[i].beats[j]` index
 * resolves against the DERIVED SOURCE units (the beats -- same array `coverage`'s
 * `source_unit` resolves against). `mode: 'revise'` never carries grounding
 * (contracts/coverage-ledger-additions.md); the model returning one anyway is
 * refused loudly rather than silently dropped.
 *
 * The built edition is a frontmatter carrier: a leading `---` ... `---` block
 * whose top-level `ledger:` key holds the serialized ledger (the exact shape
 * `extractLedgerYaml` -- `@/fidelity/check-ledger-structure.ts` -- expects),
 * followed by `model.edition` verbatim. Because `deriveUnits` strips a single
 * leading frontmatter block first (FR-011/D6.2), prepending this ledger block
 * does NOT perturb the body's units: the edition units the validator re-derives
 * are the same ones the declared indices referenced.
 */

/** A fixed local label for the edition when deriving its units (occurrence is per-document). */
const EDITION_IDENTITY = 'voice-revise:edition';

export interface BuildEditionArgs {
  readonly sourceText: string;
  readonly sourceIdentity: string;
  readonly voiceIdentity: string;
  readonly voiceHash: string;
  readonly sourceHash: string;
  readonly model: ModelReviseOutput;
  /** The producer operation to stamp on the built ledger (spec 006 T011). */
  readonly mode: Mode;
}

/**
 * Build the ledgered edition text from the model's output.
 *
 * @throws Error naming the defect when the model's coverage count does not
 *   match the derived source-unit count, an `edition_units` index is out of
 *   range for the edition units the model wrote, a validated invariant (cut
 *   reason / non-cut destinations) is somehow absent, `mode` is `'compose'`
 *   and the model declared no (or an empty) `grounding`, `mode` is `'revise'`
 *   and the model declared a `grounding` anyway, or a `grounding` entry's
 *   `edition_unit`/`beats` index is out of range.
 */
/**
 * The built edition text PLUS the mechanically-derived units and ledger the
 * producer's pre-emit self-check (`@/revise/preflight.ts`, spec 006 T018) needs
 * -- so it can re-run the shared grounding policy over the SAME units and
 * grounding records this build resolved, without re-deriving them itself.
 */
export interface BuiltEdition {
  readonly editionText: string;
  readonly ledger: CoverageLedger;
  readonly sourceUnits: readonly SourceUnit[];
  readonly editionUnits: readonly SourceUnit[];
}

export function buildEdition(args: BuildEditionArgs): BuiltEdition {
  const sourceUnits = deriveUnits(args.sourceText, args.sourceIdentity);
  const editionUnits = deriveUnits(args.model.edition, EDITION_IDENTITY);

  if (args.model.coverage.length !== sourceUnits.length) {
    fail(
      `model declared ${args.model.coverage.length} coverage entr` +
        `${args.model.coverage.length === 1 ? 'y' : 'ies'} but the source derives to ` +
        `${sourceUnits.length} unit${sourceUnits.length === 1 ? '' : 's'} -- coverage must ` +
        'carry exactly one entry per source unit, in order',
    );
  }

  const coverage: CoverageEntry[] = args.model.coverage.map((declared, index) => {
    const sourceUnit = sourceUnits[index];
    if (sourceUnit === undefined) {
      fail(`internal error: no source unit at index ${index}`);
    }
    const sourceRef = unitRefOf(sourceUnit);

    if (declared.op === 'cut') {
      if (declared.reason === undefined || declared.reason.trim().length === 0) {
        fail(`coverage[${index}]: op 'cut' requires a non-empty reason`);
      }
      return {
        source_unit: sourceRef,
        op: 'cut',
        reason: declared.reason,
        ...(declared.treatment !== undefined ? { treatment: declared.treatment } : {}),
      };
    }

    const declaredIndices = declared.edition_units;
    if (declaredIndices === undefined || declaredIndices.length === 0) {
      fail(`coverage[${index}]: op '${declared.op}' requires at least one edition_units index`);
    }
    const editionRefs = declaredIndices.map((editionIndex) => {
      const editionUnit = editionUnits[editionIndex];
      if (editionUnit === undefined) {
        fail(
          `coverage[${index}]: edition_units index ${editionIndex} is out of range -- the model ` +
            `wrote ${editionUnits.length} edition unit${editionUnits.length === 1 ? '' : 's'}`,
        );
      }
      return unitRefOf(editionUnit);
    });

    return {
      source_unit: sourceRef,
      op: declared.op,
      edition_units: editionRefs,
      ...(declared.treatment !== undefined ? { treatment: declared.treatment } : {}),
    };
  });

  const grounding = resolveGrounding(args.mode, args.model.grounding, sourceUnits, editionUnits);

  const ledger: CoverageLedger = {
    version: 1,
    source: { identity: args.sourceIdentity, hash: args.sourceHash },
    voice: { identity: args.voiceIdentity, hash: args.voiceHash },
    mode: args.mode,
    coverage,
    ...(grounding !== undefined ? { grounding } : {}),
  };

  const ledgerYaml = stringifyYaml({ ledger });
  const editionText = `---\n${ledgerYaml}---\n${args.model.edition}`;
  return { editionText, ledger, sourceUnits, editionUnits };
}

/**
 * Resolve the model's index-based `grounding` declaration into hash-keyed
 * `GroundingRecord[]`, mode-scoped exactly as `contracts/coverage-ledger-
 * additions.md` requires: `'compose'` STAMPS a non-empty, resolved
 * `GroundingRecord[]`; `'revise'` OMITS grounding entirely (undefined) and
 * refuses loudly if the model declared one anyway -- grounding is compose-only.
 *
 * `edition_unit` indices resolve against `editionUnits` (the model's own
 * written edition, same array `coverage`'s `edition_units` indices use);
 * `beats` indices resolve against `sourceUnits` (the beats, same array
 * `coverage`'s `source_unit` uses).
 */
function resolveGrounding(
  mode: Mode,
  declared: ModelGroundingEntry[] | undefined,
  sourceUnits: readonly SourceUnit[],
  editionUnits: readonly SourceUnit[],
): GroundingRecord[] | undefined {
  if (mode === 'revise') {
    if (declared !== undefined) {
      fail(
        "mode 'revise' forbids a grounding declaration -- grounding is compose-only " +
          '(contracts/coverage-ledger-additions.md)',
      );
    }
    return undefined;
  }

  // compose
  if (declared === undefined || declared.length === 0) {
    fail("mode 'compose' requires a non-empty grounding declaration but the model declared none");
  }

  return declared.map((entry, index) => {
    const editionUnit = editionUnits[entry.edition_unit];
    if (editionUnit === undefined) {
      fail(
        `grounding[${index}]: edition_unit index ${entry.edition_unit} is out of range -- the ` +
          `model wrote ${editionUnits.length} edition unit${editionUnits.length === 1 ? '' : 's'}`,
      );
    }

    const beats = entry.beats?.map((beatIndex) => {
      const beatUnit = sourceUnits[beatIndex];
      if (beatUnit === undefined) {
        fail(
          `grounding[${index}]: beats index ${beatIndex} is out of range -- the source derives ` +
            `to ${sourceUnits.length} unit${sourceUnits.length === 1 ? '' : 's'}`,
        );
      }
      return unitRefOf(beatUnit);
    });

    return {
      edition_unit: unitRefOf(editionUnit),
      basis: entry.basis,
      ...(beats !== undefined ? { beats } : {}),
    };
  });
}

/** A derived unit's hash-keyed `UnitRef` (bare-hex `contentHash` -> `sha256:<hex>`). */
function unitRefOf(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function fail(message: string): never {
  throw new Error(`voice-revise: ${message}`);
}

import { stringify as stringifyYaml } from 'yaml';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageEntry, CoverageLedger, UnitRef } from '@/schema/ledger.ts';
import type { ModelReviseOutput } from '@/revise/protocol.ts';

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
}

/**
 * Build the ledgered edition text from the model's output.
 *
 * @throws Error naming the defect when the model's coverage count does not
 *   match the derived source-unit count, or an `edition_units` index is out of
 *   range for the edition units the model wrote, or a validated invariant
 *   (cut reason / non-cut destinations) is somehow absent.
 */
export function buildEdition(args: BuildEditionArgs): { editionText: string } {
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

  const ledger: CoverageLedger = {
    version: 1,
    source: { identity: args.sourceIdentity, hash: args.sourceHash },
    voice: { identity: args.voiceIdentity, hash: args.voiceHash },
    coverage,
  };

  const ledgerYaml = stringifyYaml({ ledger });
  const editionText = `---\n${ledgerYaml}---\n${args.model.edition}`;
  return { editionText };
}

/** A derived unit's hash-keyed `UnitRef` (bare-hex `contentHash` -> `sha256:<hex>`). */
function unitRefOf(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function fail(message: string): never {
  throw new Error(`voice-revise: ${message}`);
}

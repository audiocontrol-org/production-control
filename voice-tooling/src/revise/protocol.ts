import { isRecord } from '@/util/is-record.ts';

/**
 * TASK-29: the MODEL PROTOCOL for `voice revise` (and, per spec 006 T010,
 * `voice compose`).
 *
 * A language model cannot compute the sha256 `content_hash` values a coverage
 * ledger references, so the model MUST NOT emit the ledger directly. Instead it
 * emits the revised edition BODY plus an INDEX-BASED coverage mapping (which is
 * a declaration it CAN make); the PROVIDER (`@/revise/ledger-build.ts`) derives
 * source + edition units mechanically and BUILDS the hash-keyed ledger from the
 * model's declared indices.
 *
 * spec 006 adds an INDEX-BASED `grounding` declaration alongside `coverage`,
 * for `voice compose` only (contracts/voice-compose-cli.md "Model protocol
 * (compose)"): for every edition unit the model wrote, which beats (if any) it
 * is grounded in. Exactly like `coverage`, the model declares 0-based INDICES
 * (it cannot compute the hash-keyed refs a ledger needs); this module validates
 * only the DECLARED SHAPE (int indices, closed `basis` enum, `beats`
 * present-non-empty iff `basis === 'grounded'`) -- resolving those indices into
 * hash-keyed `GroundingRecord[]` is `@/revise/ledger-build.ts`'s job, exactly as
 * it already resolves `coverage`'s indices. `voice revise` never declares
 * `grounding`; its absence from the model's JSON is fine and leaves
 * `ModelReviseOutput.grounding` `undefined`.
 *
 * This module owns ONLY the model-facing wire shape and its robust extraction +
 * validation. It has no knowledge of hashing, units, or ledgers.
 */

/** The closed op set the model may declare (mirrors `@/schema/ledger.ts`'s `Op`). */
const MODEL_OPS = ['verbatim', 'represented', 'merged', 'cut'] as const;
export type ModelOp = (typeof MODEL_OPS)[number];

/**
 * One coverage disposition as the MODEL declares it: an op plus, for a non-cut,
 * the 0-based indices of the edition units it lands in (indices into the
 * edition units the model wrote); for a cut, a non-empty reason.
 */
export interface ModelCoverageEntry {
  op: ModelOp;
  /** REQUIRED (>=1) for a non-cut op; ABSENT for cut. 0-based edition-unit indices. */
  edition_units?: number[];
  /** REQUIRED (non-empty) for cut; ABSENT otherwise. */
  reason?: string;
  /** Optional, non-normative editorial note. */
  treatment?: string;
}

/** The closed grounding-basis set the model may declare (mirrors `@/schema/ledger.ts`'s `GroundingBasis`). */
const MODEL_GROUNDING_BASES = ['grounded', 'connective', 'framing'] as const;
export type ModelGroundingBasis = (typeof MODEL_GROUNDING_BASES)[number];

/**
 * One grounding declaration as the MODEL declares it (compose only): the
 * 0-based index of the edition unit it describes, its basis, and -- iff
 * `basis === 'grounded'` -- the non-empty 0-based indices of the beats
 * (source units) it is grounded in.
 */
export interface ModelGroundingEntry {
  edition_unit: number;
  basis: ModelGroundingBasis;
  /** REQUIRED (>=1) iff basis === 'grounded'; ABSENT for connective/framing. */
  beats?: number[];
}

/** The full model output: the revised body plus one entry per source unit, in order. */
export interface ModelReviseOutput {
  /** The full revised markdown BODY (edition units separated by blank lines, D6). */
  edition: string;
  /** EXACTLY ONE entry per source unit, in source document order. */
  coverage: ModelCoverageEntry[];
  /**
   * OPTIONAL: compose-only, index-based grounding declaration, one entry per
   * edition unit the model wrote, in edition order. ABSENT for `voice revise`
   * (grounding is compose-only, contracts/voice-compose-cli.md).
   */
  grounding?: ModelGroundingEntry[];
}

/**
 * Robustly extract and validate the model's JSON output from its raw stdout.
 *
 * Extraction accepts either a ```json (or bare ```) fenced block OR a raw JSON
 * object embedded in surrounding prose (the first `{` through the last `}`).
 *
 * @throws Error naming the defect on: no JSON found, unparseable JSON, a
 *   non-object root, a missing/`edition` non-string, `coverage` not an array,
 *   an entry that is not an object, an op outside the closed set, a `cut`
 *   carrying `edition_units` or missing/empty `reason`, a non-cut missing/
 *   empty `edition_units` or carrying a `reason`, a `grounding` (when present)
 *   that is not an array, an entry that is not an object, a non-integer/
 *   negative `edition_unit`, a `basis` outside the closed set, a `grounded`
 *   entry missing/empty `beats` or a non-integer/negative beat index, or a
 *   non-`grounded` entry carrying `beats`.
 */
export function parseModelOutput(stdout: string): ModelReviseOutput {
  const jsonText = extractJson(stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    return fail(`model output is not valid JSON: ${describeError(cause)}`);
  }

  if (!isRecord(parsed)) {
    fail('model output must be a JSON object');
  }

  const edition = parsed['edition'];
  if (typeof edition !== 'string') {
    fail(`model output "edition" must be a string (got ${JSON.stringify(edition)})`);
  }

  const coverageValue = parsed['coverage'];
  if (!Array.isArray(coverageValue)) {
    fail(`model output "coverage" must be an array (got ${JSON.stringify(coverageValue)})`);
  }

  const coverage = coverageValue.map((entry, index) => parseCoverageEntry(entry, index));

  const groundingValue = parsed['grounding'];
  const grounding = groundingValue === undefined ? undefined : parseGroundingArray(groundingValue);

  return { edition, coverage, ...(grounding !== undefined ? { grounding } : {}) };
}

// ---- entry validation -----------------------------------------------------

function parseCoverageEntry(value: unknown, index: number): ModelCoverageEntry {
  const where = `coverage[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} must be an object (got ${JSON.stringify(value)})`);
  }

  const op = value['op'];
  if (typeof op !== 'string' || !isModelOp(op)) {
    fail(
      `${where}.op must be one of ${MODEL_OPS.join(', ')} (got ${JSON.stringify(op)})`,
    );
  }

  const treatmentValue = value['treatment'];
  if (treatmentValue !== undefined && typeof treatmentValue !== 'string') {
    fail(`${where}.treatment must be a string when present`);
  }

  const editionUnitsValue = value['edition_units'];
  const reasonValue = value['reason'];

  if (op === 'cut') {
    if (editionUnitsValue !== undefined) {
      fail(`${where}: op 'cut' must not carry edition_units`);
    }
    if (typeof reasonValue !== 'string' || reasonValue.trim().length === 0) {
      fail(`${where}: op 'cut' requires a non-empty reason`);
    }
    return {
      op,
      reason: reasonValue,
      ...(treatmentValue !== undefined ? { treatment: treatmentValue } : {}),
    };
  }

  // Non-cut: edition_units required (>=1), reason forbidden.
  if (reasonValue !== undefined) {
    fail(`${where}: op '${op}' must not carry a reason (reason is only valid for cut)`);
  }
  const editionUnits = parseEditionUnits(editionUnitsValue, where);
  return {
    op,
    edition_units: editionUnits,
    ...(treatmentValue !== undefined ? { treatment: treatmentValue } : {}),
  };
}

function parseEditionUnits(value: unknown, where: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      `${where}: a non-cut op requires a non-empty edition_units array of 0-based indices ` +
        `(got ${JSON.stringify(value)})`,
    );
  }
  return value.map((item, i) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
      fail(`${where}.edition_units[${i}] must be a non-negative integer (got ${JSON.stringify(item)})`);
    }
    return item;
  });
}

// ---- grounding validation (compose only; shape only, see module doc) -----

function parseGroundingArray(value: unknown): ModelGroundingEntry[] {
  if (!Array.isArray(value)) {
    fail(`model output "grounding" must be an array when present (got ${JSON.stringify(value)})`);
  }
  return value.map((entry, index) => parseGroundingEntry(entry, index));
}

function parseGroundingEntry(value: unknown, index: number): ModelGroundingEntry {
  const where = `grounding[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} must be an object (got ${JSON.stringify(value)})`);
  }

  const editionUnitValue = value['edition_unit'];
  if (
    typeof editionUnitValue !== 'number' ||
    !Number.isInteger(editionUnitValue) ||
    editionUnitValue < 0
  ) {
    fail(
      `${where}.edition_unit must be a non-negative integer (got ${JSON.stringify(editionUnitValue)})`,
    );
  }

  const basisValue = value['basis'];
  if (typeof basisValue !== 'string' || !isModelGroundingBasis(basisValue)) {
    fail(
      `${where}.basis must be one of ${MODEL_GROUNDING_BASES.join(', ')} (got ${JSON.stringify(basisValue)})`,
    );
  }

  const beatsValue = value['beats'];
  if (basisValue === 'grounded') {
    const beats = parseGroundingBeats(beatsValue, where);
    return { edition_unit: editionUnitValue, basis: basisValue, beats };
  }

  if (beatsValue !== undefined) {
    fail(`${where}: basis '${basisValue}' must not carry beats (beats is only valid for grounded)`);
  }
  return { edition_unit: editionUnitValue, basis: basisValue };
}

function parseGroundingBeats(value: unknown, where: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      `${where}: basis 'grounded' requires a non-empty beats array of 0-based indices ` +
        `(got ${JSON.stringify(value)})`,
    );
  }
  return value.map((item, i) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
      fail(`${where}.beats[${i}] must be a non-negative integer (got ${JSON.stringify(item)})`);
    }
    return item;
  });
}

function isModelGroundingBasis(value: string): value is ModelGroundingBasis {
  return (MODEL_GROUNDING_BASES as readonly string[]).includes(value);
}

// ---- JSON extraction ------------------------------------------------------

/**
 * Pull the JSON object text out of the model's stdout: prefer a fenced block
 * (```json ... ``` or ``` ... ```), else fall back to the first `{` through the
 * last `}`. Surrounding prose is ignored.
 */
function extractJson(stdout: string): string {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(stdout);
  if (fenced?.[1] !== undefined && fenced[1].trim().length > 0) {
    return fenced[1].trim();
  }
  const firstBrace = stdout.indexOf('{');
  const lastBrace = stdout.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    fail('model output contains no JSON object (expected a { ... } object or a ```json block)');
  }
  return stdout.slice(firstBrace, lastBrace + 1);
}

function isModelOp(value: string): value is ModelOp {
  return (MODEL_OPS as readonly string[]).includes(value);
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fail(message: string): never {
  throw new Error(`voice-revise: ${message}`);
}

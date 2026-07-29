import { parse as parseYamlText } from 'yaml';

/**
 * Carrier-independent coverage-ledger schema + single loader (D10, D21, FR-015,
 * FR-016). See specs/004-voice-editions/contracts/coverage-ledger-schema.md and
 * data-model.md § "Coverage ledger" for the authoritative field reference.
 *
 * `loadLedger` validates ONLY what is determinable from the ledger's own bytes
 * (D20): version, required fields, the closed op set, each op's mechanical
 * shape (`edition_units`/`reason` presence per op), duplicate dispositions, and
 * `merged`'s shared-destination condition. It deliberately does NOT check
 * anything that needs the source draft or edition (unit accounting against the
 * derived source, `source.hash` matching a supplied source, unknown-unit
 * detection) — those are fidelity-validator concerns (T011/T012).
 *
 * `mode` + `grounding` (spec 006, additive per D21) extend the same loader:
 * see specs/006-voice-compose-from-spine/contracts/coverage-ledger-additions.md
 * and data-model.md § "Mode" / "GroundingRecord" / "CoverageLedger (EXTENDED)".
 * Absent `mode` defaults to `revise` on read (backward compatibility with
 * pre-006 editions). Edition-side grounding accounting (exhaustive/exclusive,
 * beats resolving to real derived units) is a fidelity-validator concern
 * (check-edition-grounding.ts), not this loader's.
 */

const KNOWN_LEDGER_KEYS = ['version', 'source', 'voice', 'mode', 'coverage', 'grounding'];
const KNOWN_ENTRY_KEYS = ['source_unit', 'op', 'treatment', 'edition_units', 'reason'];

export type Op = 'verbatim' | 'represented' | 'merged' | 'cut';
export type Mode = 'compose' | 'revise';
export type GroundingBasis = 'grounded' | 'connective' | 'framing';

export interface UnitRef {
  hash: string;
  occurrence: number;
}

export interface CoverageEntry {
  source_unit: UnitRef;
  op: Op;
  /** Optional, explicitly non-normative editorial description (D8, D9). */
  treatment?: string;
  /** REQUIRED (>=1) for verbatim/represented/merged; absent/empty for cut. */
  edition_units?: UnitRef[];
  /** REQUIRED (trimmed non-empty) for cut; MUST be absent for the other three. */
  reason?: string;
  /** Additive extensibility (D21): unknown entry-level keys pass through untouched. */
  [extra: string]: unknown;
}

export interface GroundingRecord {
  edition_unit: UnitRef;
  basis: GroundingBasis;
  /** REQUIRED (>=1) iff basis === 'grounded'; absent for connective/framing. */
  beats?: UnitRef[];
}

export interface CoverageLedger {
  version: 1;
  source: { identity: string; hash: string };
  voice: { identity: string; hash: string };
  /**
   * Optional on the type so pre-006 construction sites that build a
   * `CoverageLedger` literal directly (not via `loadLedger`) are unaffected;
   * `loadLedger` itself always populates this, defaulting to 'revise' when
   * absent from the ledger bytes.
   */
  mode?: Mode;
  coverage: CoverageEntry[];
  /** REQUIRED+non-empty when mode === 'compose'; MUST be absent when mode === 'revise' (v1). */
  grounding?: GroundingRecord[];
  /** Additive extensibility (D21): unknown ledger-level keys pass through untouched. */
  [extra: string]: unknown;
}

/**
 * Parse and structurally validate a self-contained coverage-ledger YAML
 * document. Has no knowledge of where `yamlText` came from (D10) — v1's
 * caller extracts it from the edition's frontmatter; a later carrier would
 * extract the same string from a different location and call this function
 * unchanged.
 *
 * @throws Error naming the specific offending field/entry for every
 *   structural violation determinable from the ledger alone (D20).
 */
export function loadLedger(yamlText: string): CoverageLedger {
  const parsed = parseRawYaml(yamlText);
  const root = requireRecord(parsed, 'ledger');

  const version = root['version'];
  if (version !== 1) {
    fail(`version must be the literal 1 (got ${JSON.stringify(version)})`);
  }

  const sourceValue = requireField(root, 'source', 'source');
  const source = requireIdentityHash(sourceValue, 'source');

  const voiceValue = requireField(root, 'voice', 'voice');
  const voice = requireIdentityHash(voiceValue, 'voice');

  const coverageValue = requireField(root, 'coverage', 'coverage');
  if (!Array.isArray(coverageValue)) {
    fail('coverage must be a list');
  }
  const coverage = coverageValue.map((entry, index) => parseCoverageEntry(entry, index));

  checkNoDuplicateDisposition(coverage);
  checkMergedSharedDestination(coverage);

  const mode = parseMode(root['mode']);
  const grounding = parseGrounding(root['grounding'], mode);

  return {
    ...omitKnownKeys(root, KNOWN_LEDGER_KEYS),
    version: 1,
    source,
    voice,
    mode,
    coverage,
    ...(grounding !== undefined ? { grounding } : {}),
  };
}

// ---- mode + grounding parsing ---------------------------------------------

function parseMode(value: unknown): Mode {
  if (value === undefined) {
    return 'revise';
  }
  if (typeof value !== 'string' || !isMode(value)) {
    fail(`mode must be one of compose, revise (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseGrounding(value: unknown, mode: Mode): GroundingRecord[] | undefined {
  if (mode === 'revise') {
    if (value !== undefined) {
      fail(
        "mode 'revise' must not carry grounding (grounding is only valid for compose; v1 revise reverse-accounting is a later task)",
      );
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail("mode 'compose' requires a non-empty grounding list");
  }
  return value.map((entry, index) => parseGroundingRecord(entry, index));
}

function parseGroundingRecord(value: unknown, index: number): GroundingRecord {
  const path = `grounding[${index}]`;
  const record = requireRecord(value, path);

  const editionUnitValue = requireField(record, 'edition_unit', `${path}.edition_unit`);
  const editionUnit = parseUnitRef(editionUnitValue, `${path}.edition_unit`);

  const basisValue = record['basis'];
  if (typeof basisValue !== 'string') {
    fail(`${path}.basis must be a string (got ${JSON.stringify(basisValue)})`);
  }
  if (!isGroundingBasis(basisValue)) {
    fail(
      `${path}.basis must be one of grounded, connective, framing (got ${JSON.stringify(basisValue)})`,
    );
  }
  const basis = basisValue;

  const beatsValue = record['beats'];
  let beats: UnitRef[] | undefined;
  if (basis === 'grounded') {
    const list = parseUnitRefList(beatsValue ?? [], `${path}.beats`);
    if (list.length === 0) {
      fail(`${path}.beats must be non-empty when basis is 'grounded'`);
    }
    beats = list;
  } else if (beatsValue !== undefined) {
    fail(`${path}.beats must be absent when basis is '${basis}' (beats is only valid for grounded)`);
  }

  return {
    edition_unit: editionUnit,
    basis,
    ...(beats !== undefined ? { beats } : {}),
  };
}

// ---- entry-level parsing -------------------------------------------------

function parseCoverageEntry(value: unknown, index: number): CoverageEntry {
  const path = `coverage[${index}]`;
  const record = requireRecord(value, path);

  const sourceUnitValue = requireField(record, 'source_unit', `${path}.source_unit`);
  const sourceUnit = parseUnitRef(sourceUnitValue, `${path}.source_unit`);

  const opValue = record['op'];
  if (typeof opValue !== 'string') {
    fail(`${path}.op must be a string (got ${JSON.stringify(opValue)})`);
  }
  if (!isOp(opValue)) {
    fail(
      `${path}.op must be one of verbatim, represented, merged, cut (got ${JSON.stringify(opValue)})`,
    );
  }
  const op = opValue;

  const treatmentValue = record['treatment'];
  if (treatmentValue !== undefined && typeof treatmentValue !== 'string') {
    fail(`${path}.treatment must be a string when present`);
  }

  const reasonValue = record['reason'];
  const editionUnitsValue = record['edition_units'];

  let editionUnits: UnitRef[] | undefined;
  let reason: string | undefined;

  if (op === 'cut') {
    if (Array.isArray(editionUnitsValue) && editionUnitsValue.length > 0) {
      fail(`${path}: op 'cut' must not carry edition_units`);
    }
    if (!isNonEmptyTrimmed(reasonValue)) {
      fail(`${path}: op 'cut' requires a non-empty reason`);
    }
    reason = reasonValue;
  } else {
    if (reasonValue !== undefined) {
      fail(`${path}: op '${op}' must not carry a reason (reason is only valid for cut)`);
    }
    const units = parseUnitRefList(editionUnitsValue ?? [], `${path}.edition_units`);
    if (units.length === 0) {
      fail(`${path}: op '${op}' requires at least one edition_units entry`);
    }
    if (op === 'verbatim' && units.length !== 1) {
      fail(`${path}: op 'verbatim' requires exactly one edition_units entry (got ${units.length})`);
    }
    editionUnits = units;
  }

  return {
    ...omitKnownKeys(record, KNOWN_ENTRY_KEYS),
    source_unit: sourceUnit,
    op,
    ...(treatmentValue !== undefined ? { treatment: treatmentValue } : {}),
    ...(editionUnits !== undefined ? { edition_units: editionUnits } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

// ---- cross-entry checks ---------------------------------------------------

function checkNoDuplicateDisposition(coverage: readonly CoverageEntry[]): void {
  const seen = new Map<string, number>();
  coverage.forEach((entry, index) => {
    const key = unitRefKey(entry.source_unit);
    const priorIndex = seen.get(key);
    if (priorIndex !== undefined) {
      fail(
        `duplicate disposition: source_unit (hash ${entry.source_unit.hash}, occurrence ${entry.source_unit.occurrence}) is declared by both coverage[${priorIndex}] and coverage[${index}]`,
      );
    }
    seen.set(key, index);
  });
}

function checkMergedSharedDestination(coverage: readonly CoverageEntry[]): void {
  const owners = new Map<string, Set<number>>();
  coverage.forEach((entry, index) => {
    for (const unit of entry.edition_units ?? []) {
      const key = unitRefKey(unit);
      const owningIndexes = owners.get(key) ?? new Set<number>();
      owningIndexes.add(index);
      owners.set(key, owningIndexes);
    }
  });

  coverage.forEach((entry, index) => {
    if (entry.op !== 'merged') {
      return;
    }
    const hasSharedDestination = (entry.edition_units ?? []).some((unit) => {
      const owningIndexes = owners.get(unitRefKey(unit));
      if (owningIndexes === undefined) {
        return false;
      }
      return Array.from(owningIndexes).some((otherIndex) => otherIndex !== index);
    });
    if (!hasSharedDestination) {
      fail(
        `merged with no shared destination: coverage[${index}] (source_unit hash ${entry.source_unit.hash}, occurrence ${entry.source_unit.occurrence}) shares no edition_units destination with any other coverage entry`,
      );
    }
  });
}

// ---- primitive parsing / validation helpers -------------------------------

function parseRawYaml(yamlText: string): unknown {
  try {
    const parsed: unknown = parseYamlText(yamlText);
    return parsed;
  } catch (cause) {
    throw new Error(
      `Coverage ledger: invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

function requireIdentityHash(
  containerValue: unknown,
  containerPath: string,
): { identity: string; hash: string } {
  const record = requireRecord(containerValue, containerPath);
  const identity = requireNonEmptyStringField(record, 'identity', `${containerPath}.identity`);
  const hash = requireNonEmptyStringField(record, 'hash', `${containerPath}.hash`);
  return { identity, hash };
}

function parseUnitRef(value: unknown, path: string): UnitRef {
  const record = requireRecord(value, path);
  const hash = record['hash'];
  if (typeof hash !== 'string' || hash.length === 0) {
    fail(`${path}.hash must be a non-empty string`);
  }
  const occurrence = record['occurrence'];
  if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) {
    fail(`${path}.occurrence must be a non-negative integer`);
  }
  return { hash, occurrence };
}

function parseUnitRefList(value: unknown, path: string): UnitRef[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be a list`);
  }
  return value.map((item, index) => parseUnitRef(item, `${path}[${index}]`));
}

function requireField(container: Record<string, unknown>, key: string, path: string): unknown {
  const value = container[key];
  if (value === undefined) {
    fail(`missing required field: ${path}`);
  }
  return value;
}

function requireNonEmptyStringField(
  container: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = requireField(container, key, path);
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${path} must be a YAML mapping`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOp(value: string): value is Op {
  return value === 'verbatim' || value === 'represented' || value === 'merged' || value === 'cut';
}

/** Exported (spec 006 T025) so callers validating a `Mode`-typed wire field
 *  elsewhere (e.g. `fidelity/cli.ts`'s `ValidateRequest.requested_mode`) share
 *  this same closed-set check rather than re-declaring the enum. */
export function isMode(value: string): value is Mode {
  return value === 'compose' || value === 'revise';
}

function isGroundingBasis(value: string): value is GroundingBasis {
  return value === 'grounded' || value === 'connective' || value === 'framing';
}

function isNonEmptyTrimmed(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unitRefKey(ref: UnitRef): string {
  return `${ref.hash} ${ref.occurrence}`;
}

function omitKnownKeys(
  record: Record<string, unknown>,
  knownKeys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

function fail(message: string): never {
  throw new Error(`Coverage ledger: ${message}`);
}

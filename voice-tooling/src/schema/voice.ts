import { parse as parseYamlText } from 'yaml';

/**
 * Voice-document schema + loader (FR-003, FR-004, D17). See
 * specs/004-voice-editions/contracts/voice-document-schema.md and
 * data-model.md § "Voice document" for the authoritative field reference.
 *
 * ## No-author-imitation refusal (FR-004, D17)
 *
 * **A voice MUST be expressed as independently-useful traits and MUST NOT be a
 * named living author's identity.**
 *
 * This is a documented refusal, enforced by human authoring and review discipline,
 * not by a mechanical name-detection check. There is no isNamedAuthor() function
 * or name blocklist in this implementation — a blocklist would be incomplete and
 * would import the false precision that this design record explicitly rejects
 * everywhere else it could reach for heuristics or thresholds (see D6, D11, D12
 * in the design record).
 *
 * The refusal is stated here in this module's own documentation and MUST be
 * stated again in any tooling that authors or reviews a voice document. It is
 * enforced as prose a human reads before committing a voice, not as a mechanical
 * gate the schema can pass or fail. A voice document that smuggled in
 * "write like <named author>" as its purpose or an additional key would still
 * pass every schema check in this file — the schema is intentionally permissive
 * (additional keys, free-text fields) to preserve expressiveness. Stating the
 * refusal here, loudly, is the mitigation this design record chose.
 *
 * `loadVoice` validates ONLY what is determinable from the voice document's
 * bytes: version (checked FIRST), required-core fields present and non-empty,
 * and type shape (avoid must be a list of strings). It deliberately does NOT
 * check intent or attempt to detect author names.
 */

const KNOWN_VOICE_KEYS = [
  'version',
  'id',
  'label',
  'purpose',
  'narrator_distance',
  'evidence_posture',
  'sentence_movement',
  'paragraph_movement',
  'transitions',
  'emotional_temperature',
  'quote_handling',
  'avoid',
];

export interface VoiceDocument {
  version: 1;
  id: string;
  label: string;
  purpose: string;
  narrator_distance: string;
  evidence_posture: string;
  sentence_movement: string;
  paragraph_movement: string;
  transitions: string;
  emotional_temperature: string;
  quote_handling: string;
  avoid: string[];
  /** Additive extensibility (D17): unknown document-level keys pass through untouched. */
  [extra: string]: unknown;
}

/**
 * Parse and structurally validate a voice-document YAML string.
 *
 * @throws Error naming the specific offending field for every structural
 *   violation (version check, required-field check, type check).
 */
export function loadVoice(yamlText: string): VoiceDocument {
  const parsed = parseRawYaml(yamlText);
  const root = requireRecord(parsed, 'Voice document');

  // Version MUST be checked FIRST before reading any other field (D17, FR-003)
  const version = root['version'];
  if (version !== 1) {
    fail(`version must be the literal 1 (got ${JSON.stringify(version)})`);
  }

  // All required-core fields
  const id = requireNonEmptyStringField(root, 'id', 'id');
  const label = requireNonEmptyStringField(root, 'label', 'label');
  const purpose = requireNonEmptyStringField(root, 'purpose', 'purpose');
  const narratorDistance = requireNonEmptyStringField(
    root,
    'narrator_distance',
    'narrator_distance',
  );
  const evidencePosture = requireNonEmptyStringField(
    root,
    'evidence_posture',
    'evidence_posture',
  );
  const sentenceMovement = requireNonEmptyStringField(
    root,
    'sentence_movement',
    'sentence_movement',
  );
  const paragraphMovement = requireNonEmptyStringField(
    root,
    'paragraph_movement',
    'paragraph_movement',
  );
  const transitions = requireNonEmptyStringField(root, 'transitions', 'transitions');
  const emotionalTemperature = requireNonEmptyStringField(
    root,
    'emotional_temperature',
    'emotional_temperature',
  );
  const quoteHandling = requireNonEmptyStringField(
    root,
    'quote_handling',
    'quote_handling',
  );

  // avoid is required and must be a list of strings
  const avoidValue = requireField(root, 'avoid', 'avoid');
  if (!Array.isArray(avoidValue)) {
    fail('avoid must be a list');
  }
  const avoid: string[] = avoidValue.map((item, i) => {
    if (typeof item !== 'string') {
      fail(`avoid[${i}] must contain only strings (got ${JSON.stringify(item)})`);
    }
    return item;
  });

  return {
    ...omitKnownKeys(root, KNOWN_VOICE_KEYS),
    version: 1,
    id,
    label,
    purpose,
    narrator_distance: narratorDistance,
    evidence_posture: evidencePosture,
    sentence_movement: sentenceMovement,
    paragraph_movement: paragraphMovement,
    transitions,
    emotional_temperature: emotionalTemperature,
    quote_handling: quoteHandling,
    avoid,
  };
}

// ---- primitive parsing / validation helpers -------------------------------

function parseRawYaml(yamlText: string): unknown {
  try {
    const parsed: unknown = parseYamlText(yamlText);
    return parsed;
  } catch (cause) {
    throw new Error(
      `Voice document: invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
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
  throw new Error(`Voice document: ${message}`);
}

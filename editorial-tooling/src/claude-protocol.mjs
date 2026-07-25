// Wire protocol for the `claude` CLI model adapter (src/claude.mjs). Pure functions
// only: argv construction, response parsing, and model-identity extraction. No IO, no
// subprocess, no production-control import.
//
// TWO EXPLICIT PROTOCOLS, chosen by src/claude.mjs and never mixed:
//
//   1. STRUCTURED (the default `claude` command). The CLI is asked for a machine-owned
//      envelope with `--output-format json --json-schema <inline schema>`, and answers
//      with a JSON object whose `structured_output` field is the already-parsed,
//      schema-conforming payload. The CLI — not the model's prose — owns the JSON
//      encoding, so a passage full of guillemets or typographic quotes can no longer
//      corrupt the payload. (Observed production failure: on a French OCR source the
//      model hand-wrote `... espoir plus que jamais », "corrections": []}` — an
//      unterminated string — and JSON.parse threw mid-corpus.)
//
//   2. TOLERANT (any other, injected command). A stand-in binary supplied through
//      `QUOTE_MINER_MODEL_CMD` / `options.command` does not understand the structured
//      flags, so it is invoked with plain args and its stdout is parsed as a bare JSON
//      array of candidates, tolerating stray wrapping prose. This is the pre-existing
//      behaviour, preserved verbatim for the test/fake seam.
//
// Both protocols FAIL LOUD. Neither ever answers "no candidates" because it could not
// understand the response: an empty candidate list is a claim that the source had
// nothing quotable, and this module will not fabricate that claim.

import { normalizeCandidates } from './corrections.mjs';

/** The command the adapter treats as the real CLI, i.e. the structured-protocol path. */
export const DEFAULT_COMMAND = 'claude';

/** Args used on the TOLERANT path when the caller did not supply their own. */
export const TOLERANT_DEFAULT_ARGS = ['-p'];

/**
 * The response schema handed to `claude --json-schema`. It must be passed INLINE as an
 * argument: the CLI rejects a file path with "--json-schema is not valid JSON".
 */
export const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: candidateListSchema(),
  },
  required: ['candidates'],
};

/**
 * The schema for ONE list of candidates — a passage plus the corrections merely PROPOSED
 * for it. Built fresh on each call so a caller (e.g. the batch schema in
 * src/claude-agent-protocol.mjs) can nest it without sharing a mutable object graph.
 *
 * @returns {object}
 */
export function candidateListSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              before: { type: 'string' },
              after: { type: 'string' },
            },
            required: ['before', 'after'],
          },
        },
      },
      required: ['text', 'corrections'],
    },
  };
}

// THE SELECTION RULES LIVE HERE, ONCE. The per-source adapter states them in its prompt;
// the fan-out adapter states them in the instructions each subagent works from. Two
// adapters asking for passages under subtly different rules would produce two different
// corpora from the same sources, so neither is allowed its own copy.

/** Fidelity: the passage is COPIED, never authored. Callers append where to copy it from. */
export const FIDELITY_RULE = `For each selected passage, copy it EXACTLY as it appears in the source — verbatim, byte-for-byte, character-for-character, INCLUDING any OCR errors it contains. Do NOT paraphrase. Do NOT summarize. Do NOT correct spelling, punctuation, or whitespace in the passage itself. Do NOT add or remove any characters.`;

/** What a model may PROPOSE about OCR damage — and the narrow limits on it. */
export const CORRECTION_RULES = `The source may be OCR output and may contain scanning corruption. For each passage you may separately PROPOSE corrections for that corruption. A correction names the exact corrupt substring and its correct form; it does not change the passage you copied.

Rules for corrections:
- Propose a correction ONLY for evident OCR or typographic corruption: broken or run-together words, "m" that should be "in", "oi" that should be "of", "coiony" that should be "colony", mangled proper names, stray punctuation introduced by scanning.
- NEVER paraphrase, modernize, translate, reorder, expand abbreviations, or change meaning. Original spelling, capitalization, and period style are NOT errors and MUST be left alone.
- "before" MUST be copied exactly from the passage, character-for-character, and must be long enough to identify the corruption unambiguously.
- The "corrections" array may be empty. When in doubt, leave the text uncorrected.`;

/**
 * Argv for the STRUCTURED protocol.
 * @returns {string[]}
 */
export function structuredArgs() {
  return ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(CANDIDATE_SCHEMA)];
}

/**
 * Parse a `claude -p --output-format json` envelope.
 *
 * @param {string} stdout
 * @param {string} command names the producer, for error messages
 * @returns {{
 *   candidates: Array<{ text: string, corrections: Array<{ before: string, after: string }> }>,
 *   modelIdentity: string | null
 * }}
 */
export function parseStructuredResponse(stdout, command) {
  const trimmed = stdout.trim();
  const context = `claude model adapter: '${command}'`;

  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `${context}: could not parse the --output-format json envelope: ${err.message}. output: ${trimmed}`,
      { cause: err }
    );
  }

  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new Error(`${context}: the --output-format json envelope was not a JSON object: ${trimmed}`);
  }

  if (envelope.is_error === true) {
    throw new Error(`${context}: the envelope reported is_error. result: ${envelope.result ?? '(none)'}`);
  }

  const structured = envelope.structured_output;
  if (structured === undefined || structured === null) {
    throw new Error(
      `${context}: the envelope is missing 'structured_output'. keys: ${Object.keys(envelope).join(', ')}`
    );
  }
  if (typeof structured !== 'object' || Array.isArray(structured)) {
    throw new Error(`${context}: 'structured_output' was not an object: ${JSON.stringify(structured)}`);
  }

  const candidates = structured.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error(
      `${context}: 'structured_output.candidates' was missing or not an array: ${JSON.stringify(structured)}`
    );
  }

  return {
    candidates: normalizeCandidates(candidates, context),
    modelIdentity: resolveModelIdentity(envelope),
  };
}

/**
 * Parse a bare JSON array of candidates. Tries a strict parse first; if that fails,
 * tolerates stray wrapping text by extracting the substring from the first '[' to the
 * last ']'. Elements may be `{ text, corrections }` objects or plain strings (legacy
 * shape, normalized to zero corrections), and the two may be mixed.
 *
 * @param {string} stdout
 * @param {string} command
 * @returns {Array<{ text: string, corrections: Array<{ before: string, after: string }> }>}
 */
export function parseTolerantResponse(stdout, command) {
  const trimmed = stdout.trim();

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
      throw new Error(
        `claude model adapter: could not parse a JSON array from '${command}' output: ${trimmed}`
      );
    }
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch (err) {
      throw new Error(
        `claude model adapter: could not parse a JSON array from '${command}' output: ${err.message}. output: ${trimmed}`,
        { cause: err }
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `claude model adapter: '${command}' output was not a JSON array: ${trimmed}`
    );
  }

  return normalizeCandidates(parsed, `claude model adapter: '${command}'`);
}

/**
 * Extract the REAL model identity from an envelope's `modelUsage` map (FR-020 producer
 * drift): a key like `claude-opus-5[1m]` whose value carries `canonicalModel`. Prefers
 * `canonicalModel`; falls back to the key itself. When more than one model appears (a
 * run that delegated), the entry that produced the most output tokens wins, with a
 * lexicographic tie-break so the result is deterministic.
 *
 * Returns null when the envelope names no model — the caller must then keep the command
 * basename rather than invent an identity.
 *
 * @param {object} envelope
 * @returns {string | null}
 */
export function resolveModelIdentity(envelope) {
  const usage = envelope.modelUsage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return null;

  const keys = Object.keys(usage);
  if (keys.length === 0) return null;

  const outputTokensOf = (key) => {
    const value = usage[key];
    const tokens = typeof value === 'object' && value !== null ? value.outputTokens : undefined;
    return typeof tokens === 'number' ? tokens : 0;
  };

  const winner = keys.sort((a, b) => outputTokensOf(b) - outputTokensOf(a) || a.localeCompare(b))[0];

  const entry = usage[winner];
  if (typeof entry === 'object' && entry !== null && typeof entry.canonicalModel === 'string' && entry.canonicalModel.length > 0) {
    return entry.canonicalModel;
  }
  return winner;
}

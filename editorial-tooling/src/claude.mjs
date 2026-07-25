// The `claude` CLI model adapter (research.md R4) — the miner's IMPURE model call,
// and nothing else. It spawns the `claude` CLI (headless/print mode) with a selection
// prompt on stdin and parses the completion into candidate passage strings.
//
// Grounding, validation, and bank assembly are NOT this module's job (src/miner.mjs
// does that): the model here only POINTS at passages; the miner GROUNDS them by
// copying exact bytes from the source and OMITS anything that isn't an exact
// substring, so a slightly-off candidate is harmless.
//
// Injectable for testing (`options.command`/`options.args`/`options.spawnImpl`, or the
// `QUOTE_MINER_MODEL_CMD` env seam) so callers can run against a fake instead of the
// real `claude` CLI. An explicit identity override (`options.modelId` or the
// `QUOTE_MINER_MODEL_ID` env seam) lets an operator record which underlying model
// produced a bank (e.g. `claude-opus-4`) when the command name itself doesn't change.
// This module performs no IO beyond the one subprocess call and does not import
// production-control.

import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { normalizeCandidates } from './corrections.mjs';

/**
 * Build a model object bound to the `claude` CLI (or an injected override).
 *
 * `select()` resolves to candidates in the OBJECT shape
 * `{ text, corrections: [{ before, after }] }` — `text` is the passage as it appears in
 * the source (OCR damage included) and `corrections` are merely PROPOSED. The model
 * never controls the emitted bytes: the miner verifies each proposal against the
 * grounded source bytes and derives the presentation mechanically. A model that answers
 * with plain strings (the legacy shape) is normalized to zero corrections.
 *
 * @param {{ command?: string, args?: string[], spawnImpl?: typeof spawnSync, modelId?: string }} [options]
 * @returns {{
 *   id: string,
 *   select(sourceId: string, sourceText: string):
 *     Promise<Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>
 * }}
 */
export function claudeModel(options = {}) {
  const modelCmdOverride = process.env.QUOTE_MINER_MODEL_CMD;

  const command = modelCmdOverride
    ? (options.command ?? modelCmdOverride)
    : (options.command ?? 'claude');
  const args = modelCmdOverride ? (options.args ?? []) : (options.args ?? ['-p']);
  const spawnImpl = options.spawnImpl ?? spawnSync;

  // Stable model-identity string that flows into the miner's `tool.version`
  // (FR-020): a model change must surface as producer drift.
  //
  // AUDIT-21: `id` reflects the ACTUAL resolved command that will be spawned —
  // its basename — in every case, including when `command` was injected via
  // `options.command` without the `QUOTE_MINER_MODEL_CMD` env var set. This
  // is truthful (a bank mined by an alternate/injected binary must not be
  // stamped as the real `claude` CLI) but limited: a real model swap behind
  // a fixed `claude` command name (e.g. Opus vs Sonnet vs Haiku) does not
  // change the command's basename, so it is invisible unless the operator
  // supplies an explicit identity override. `QUOTE_MINER_MODEL_ID` (or
  // `options.modelId`) is that override and takes precedence over the
  // basename when set to a non-empty value.
  const modelIdOverride = process.env.QUOTE_MINER_MODEL_ID ?? options.modelId;
  const id = modelIdOverride ? modelIdOverride : basename(command);

  return {
    id,
    async select(sourceId, sourceText) {
      const prompt = buildPrompt(sourceId, sourceText);

      const res = spawnImpl(command, args, {
        input: prompt,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });

      if (res.error) {
        throw new Error(
          `claude model adapter: failed to spawn '${command}': ${res.error.message}`
        );
      }
      if (res.status !== 0) {
        throw new Error(
          `claude model adapter: '${command}' exited with status ${res.status}. stderr: ${res.stderr ?? ''}`
        );
      }

      return parseCandidates(res.stdout ?? '', command);
    },
  };
}

/**
 * Build the selection prompt: instructs the model to point at quotable passages,
 * copy them EXACTLY as they appear in the source (OCR damage included), and — for
 * evident OCR/typographic corruption only — POINT AT corrections it proposes. The
 * response is a bare JSON array of `{ text, corrections }` objects.
 *
 * @param {string} sourceId
 * @param {string} sourceText
 * @returns {string}
 */
function buildPrompt(sourceId, sourceText) {
  return `You are selecting quotable passages from a primary source document for a quote bank.

Source id: ${sourceId}

Read the source text below (delimited by <<<SOURCE and SOURCE) and select the most quotable passages: memorable, self-contained, and representative statements.

For each selected passage, copy it EXACTLY as it appears in the source — verbatim, byte-for-byte, character-for-character, INCLUDING any OCR errors it contains. Do NOT paraphrase. Do NOT summarize. Do NOT correct spelling, punctuation, or whitespace in the passage itself. Do NOT add or remove any characters. Copy the passage precisely as written in the source text below.

The source may be OCR output and may contain scanning corruption. For each passage you may separately PROPOSE corrections for that corruption. A correction names the exact corrupt substring and its correct form; it does not change the passage you copied.

Rules for corrections:
- Propose a correction ONLY for evident OCR or typographic corruption: broken or run-together words, "m" that should be "in", "oi" that should be "of", "coiony" that should be "colony", mangled proper names, stray punctuation introduced by scanning.
- NEVER paraphrase, modernize, translate, reorder, expand abbreviations, or change meaning. Original spelling, capitalization, and period style are NOT errors and MUST be left alone.
- "before" MUST be copied exactly from the passage, character-for-character, and must be long enough to identify the corruption unambiguously.
- The "corrections" array may be empty. When in doubt, leave the text uncorrected.

Output ONLY a JSON array of objects, with no prose, no explanation, no markdown code fence, and no commentary before or after it. The entire response must be valid JSON, in exactly this form:
[{"text": "the passage copied exactly from the source, including its OCR errors", "corrections": [{"before": "exact corrupt substring as it appears in the passage", "after": "the corrected form"}]}]

If no passage is worth selecting, output an empty JSON array: []

<<<SOURCE
${sourceText}
SOURCE`;
}

/**
 * Parse the model's stdout into candidate objects. Tries a strict parse first; if that
 * fails, tolerates stray wrapping text by extracting the substring from the first '['
 * to the last ']' and parsing that. Elements may be `{ text, corrections }` objects or
 * plain strings (legacy shape, normalized to zero corrections), and the two may be
 * mixed. Throws (never fabricates/omits-as-empty) if the result cannot be parsed as an
 * array of candidates.
 *
 * @param {string} stdout
 * @param {string} command
 * @returns {Array<{ text: string, corrections: Array<{ before: string, after: string }> }>}
 */
function parseCandidates(stdout, command) {
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

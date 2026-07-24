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
// real `claude` CLI. This module performs no IO beyond the one subprocess call and
// does not import production-control.

import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

/**
 * Build a model object bound to the `claude` CLI (or an injected override).
 *
 * @param {{ command?: string, args?: string[], spawnImpl?: typeof spawnSync }} [options]
 * @returns {{ id: string, select(sourceId: string, sourceText: string): Promise<string[]> }}
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
  const id = modelCmdOverride ? basename(command) : 'claude';

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
 * Build the selection prompt: instructs the model to point at quotable passages and
 * return them EXACTLY as they appear in the source, as a bare JSON array of strings.
 *
 * @param {string} sourceId
 * @param {string} sourceText
 * @returns {string}
 */
function buildPrompt(sourceId, sourceText) {
  return `You are selecting quotable passages from a primary source document for a quote bank.

Source id: ${sourceId}

Read the source text below (delimited by <<<SOURCE and SOURCE) and select the most quotable passages: memorable, self-contained, and representative statements.

For each selected passage, copy it EXACTLY as it appears in the source — verbatim, byte-for-byte, character-for-character. Do NOT paraphrase. Do NOT summarize. Do NOT correct spelling, punctuation, or whitespace. Do NOT add or remove any characters. Copy the passage precisely as written in the source text below.

Output ONLY a JSON array of strings, with no prose, no explanation, no markdown code fence, and no commentary before or after it. The entire response must be valid JSON, for example:
["first exact passage", "second exact passage"]

If no passage is worth selecting, output an empty JSON array: []

<<<SOURCE
${sourceText}
SOURCE`;
}

/**
 * Parse the model's stdout into a JSON array of strings. Tries a strict parse first;
 * if that fails, tolerates stray wrapping text by extracting the substring from the
 * first '[' to the last ']' and parsing that. Throws (never fabricates/omits-as-empty)
 * if the result still cannot be parsed as an array of strings.
 *
 * @param {string} stdout
 * @param {string} command
 * @returns {string[]}
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
        `claude model adapter: could not parse a JSON array from '${command}' output: ${err.message}. output: ${trimmed}`
      );
    }
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(
      `claude model adapter: '${command}' output was not a JSON array of strings: ${trimmed}`
    );
  }

  return parsed;
}

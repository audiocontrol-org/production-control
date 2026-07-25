// The `claude` CLI model adapter (research.md R4) — the miner's IMPURE model call,
// and nothing else. It spawns the `claude` CLI (headless/print mode) with a selection
// prompt on stdin and returns candidate passages.
//
// Grounding, validation, and bank assembly are NOT this module's job (src/miner.mjs
// does that): the model here only POINTS at passages; the miner GROUNDS them by
// copying exact bytes from the source and OMITS anything that isn't an exact
// substring, so a slightly-off candidate is harmless.
//
// TWO PROTOCOLS, chosen once at construction and never mixed (see
// src/claude-protocol.mjs for the wire details):
//
//   * DEFAULT / STRUCTURED — the resolved command's basename is `claude` and the caller
//     did not override argv. The CLI is asked for a machine-owned JSON envelope
//     (`--output-format json --json-schema <inline schema>`) and candidates are read
//     from `structured_output.candidates`. The CLI owns the JSON encoding, so the model
//     can no longer emit an unterminated string while hand-writing an array in prose.
//
//   * INJECTED / TOLERANT — any other command (the `QUOTE_MINER_MODEL_CMD` env seam,
//     `options.command`, or an explicit `options.args`). A stand-in binary does not
//     understand the structured flags, so it is invoked with plain args and its stdout
//     is parsed as a bare JSON array. This is the pre-existing behaviour, unchanged.
//
// RETRY: the model is stochastic, so a failed or malformed single response is often
// fine on a second attempt. Each `select()` call retries a bounded number of times
// (default 3 attempts total) on spawn error, non-zero exit, and unparseable/misshapen
// output. After the last attempt it THROWS, naming the attempt count and the last
// error — it never degrades to an empty candidate list, which would silently assert
// that the source had nothing quotable.
//
// NON-BLOCKING SPAWN (TASK-11): the subprocess is run with `spawn`, not `spawnSync` (see
// src/spawn.mjs), and `select()` awaits it. The injected `spawnImpl` seam keeps the
// spawnSync-shaped RESULT (`{ status, stdout, stderr, error }`); it is awaited, so a
// synchronous test fake returning that object plainly still works.
//
// A SECOND ADAPTER exists alongside this one: src/claude-agent.mjs asks ONE `claude`
// invocation to fan a whole BATCH of sources out to subagents. It shares this module's
// spawn (src/spawn.mjs), retry (src/retry.mjs), selection rules and identity resolution
// (src/claude-protocol.mjs); only the wire shape differs.
//
// This module performs no IO beyond the subprocess calls and does not import
// production-control.

import { basename } from 'node:path';
import {
  DEFAULT_COMMAND,
  TOLERANT_DEFAULT_ARGS,
  FIDELITY_RULE,
  CORRECTION_RULES,
  structuredArgs,
  parseStructuredResponse,
  parseTolerantResponse,
} from './claude-protocol.mjs';
import { spawnCapture, MAX_OUTPUT_BYTES } from './spawn.mjs';
import { withRetry, resolveMaxAttempts, resolveRetryDelayMs, defaultSleep } from './retry.mjs';

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
 * MODEL IDENTITY / ORDERING (AUDIT-21, FR-020). `id` is a getter, and it CHANGES:
 *   - before the first call it is the resolved command's basename (e.g. `claude`);
 *   - after the first successful STRUCTURED call it is the real model the CLI reported
 *     (e.g. `claude-opus-5`), so an Opus->Sonnet swap behind a fixed `claude` command
 *     surfaces as producer drift;
 *   - an explicit `options.modelId` / `QUOTE_MINER_MODEL_ID` wins at every point;
 *   - on the tolerant path it stays the command basename — an identity is never invented.
 * Callers that stamp provenance (bin/quote-miner.mjs -> `tool.version`) MUST therefore
 * read `model.id` / `model.resolvedId()` AFTER mining, not before.
 *
 * @param {{
 *   command?: string,
 *   args?: string[],
 *   spawnImpl?: (command: string, args: string[], options: object) =>
 *     { status: number | null, stdout: string, stderr: string, error?: Error } |
 *     Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>,
 *   modelId?: string,
 *   maxAttempts?: number,
 *   retryDelayMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void>
 * }} [options]
 * @returns {{
 *   id: string,
 *   resolvedId(): string,
 *   select(sourceId: string, sourceText: string):
 *     Promise<Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>
 * }}
 */
export function claudeModel(options = {}) {
  const modelCmdOverride = process.env.QUOTE_MINER_MODEL_CMD;

  const command = modelCmdOverride
    ? (options.command ?? modelCmdOverride)
    : (options.command ?? DEFAULT_COMMAND);

  // The structured flags only make sense against the real CLI. An operator who points
  // the adapter at a stand-in binary — or who dictates argv outright — gets the
  // tolerant protocol, because a bare command understands neither flag.
  const structured = basename(command) === DEFAULT_COMMAND && options.args === undefined;

  const args =
    options.args ??
    (structured ? structuredArgs() : modelCmdOverride ? [] : TOLERANT_DEFAULT_ARGS);

  const spawnImpl = options.spawnImpl ?? spawnCapture;
  const maxAttempts = resolveMaxAttempts(options.maxAttempts);
  const retryDelayMs = resolveRetryDelayMs(options.retryDelayMs);
  const sleepImpl = options.sleepImpl ?? defaultSleep;

  // Explicit operator escape hatch; outranks everything below.
  const rawOverride = process.env.QUOTE_MINER_MODEL_ID ?? options.modelId;
  const modelIdOverride = rawOverride ? rawOverride : null;

  // Learned from the CLI envelope on the first successful structured call. Null until
  // then — and null forever on the tolerant path, where the CLI reports no identity.
  let resolvedIdentity = null;

  const identity = () => modelIdOverride ?? resolvedIdentity ?? basename(command);

  return {
    get id() {
      return identity();
    },

    /** The same value as `id`; a method for callers that want the read to be obviously late. */
    resolvedId() {
      return identity();
    },

    async select(sourceId, sourceText) {
      const prompt = buildPrompt(sourceId, sourceText, structured);

      return withRetry({
        maxAttempts,
        retryDelayMs,
        sleepImpl,
        attempt: () =>
          attemptSelect({ command, args, prompt, spawnImpl, structured, onIdentity }),
        describeFailure: (attempts, lastError) =>
          `claude model adapter: source '${sourceId}': the model call failed after ${attempts} attempt(s). ` +
          `last error: ${lastError.message}`,
      });
    },
  };

  function onIdentity(modelIdentity) {
    if (modelIdentity !== null) resolvedIdentity = modelIdentity;
  }
}

/**
 * One spawn + parse. Throws on spawn error, non-zero exit, or output the chosen
 * protocol cannot understand; the caller decides whether to retry.
 *
 * `spawnImpl` is awaited so the real (asynchronous) implementation and the synchronous
 * result objects the tests inject are both accepted.
 *
 * @returns {Promise<Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>}
 */
async function attemptSelect({ command, args, prompt, spawnImpl, structured, onIdentity }) {
  const res = await spawnImpl(command, args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
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

  if (!structured) {
    return parseTolerantResponse(res.stdout ?? '', command);
  }

  const { candidates, modelIdentity } = parseStructuredResponse(res.stdout ?? '', command);
  onIdentity(modelIdentity);
  return candidates;
}

/**
 * Build the selection prompt: instructs the model to point at quotable passages, copy
 * them EXACTLY as they appear in the source (OCR damage included), and — for evident
 * OCR/typographic corruption only — POINT AT corrections it proposes.
 *
 * The two protocols differ ONLY in the closing output instruction: the structured path
 * lets the CLI own the JSON encoding (so nothing here asks the model to hand-write
 * JSON), while the tolerant path still asks for a bare JSON array.
 *
 * @param {string} sourceId
 * @param {string} sourceText
 * @param {boolean} structured
 * @returns {string}
 */
function buildPrompt(sourceId, sourceText, structured) {
  return `You are selecting quotable passages from a primary source document for a quote bank.

Source id: ${sourceId}

Read the source text below (delimited by <<<SOURCE and SOURCE) and select the most quotable passages: memorable, self-contained, and representative statements.

${FIDELITY_RULE} Copy the passage precisely as written in the source text below.

${CORRECTION_RULES}

${structured ? STRUCTURED_OUTPUT_INSTRUCTION : ARRAY_OUTPUT_INSTRUCTION}

<<<SOURCE
${sourceText}
SOURCE`;
}

const STRUCTURED_OUTPUT_INSTRUCTION = `Return the selected passages in the required structured output: a "candidates" list, where each entry has "text" (the passage copied exactly from the source, including its OCR errors) and "corrections" (a possibly empty list of {"before", "after"} objects).

If no passage is worth selecting, return an empty "candidates" list.`;

const ARRAY_OUTPUT_INSTRUCTION = `Output ONLY a JSON array of objects, with no prose, no explanation, no markdown code fence, and no commentary before or after it. The entire response must be valid JSON, in exactly this form:
[{"text": "the passage copied exactly from the source, including its OCR errors", "corrections": [{"before": "exact corrupt substring as it appears in the passage", "after": "the corrected form"}]}]

If no passage is worth selecting, output an empty JSON array: []`;

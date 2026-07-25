// The SUBAGENT FAN-OUT model adapter: the miner's second impure model seam, and an
// alternative to the per-source adapter in src/claude.mjs — never a replacement for it.
//
// THE COST PROBLEM IT SOLVES. `claudeModel().select()` spawns ONE `claude -p` per source.
// Every invocation rebuilds Claude Code's system prompt and tool definitions: 15,667-37,788
// `cache_creation_input_tokens` measured for even a trivial prompt. Over a 123-source
// corpus that is millions of tokens of pure per-call setup, paid 123 times, on top of
// pushing 6.9 MB of source text through prompts.
//
// WHAT THIS DOES INSTEAD. One `claude` invocation per BATCH of sources, handed the source
// PATHS and told to dispatch one subagent per source (Task); each subagent Reads its own
// file and returns the passages it selected, and the top-level run aggregates them into one
// schema-conforming envelope. Setup is paid once per batch, and source text never enters a
// prompt.
//
// WHAT IT DOES NOT CHANGE — THE FIDELITY INVARIANT. This adapter, like the other one, only
// POINTS at passages. The miner still GROUNDS every candidate by copying exact bytes from
// the source IT loaded (src/miner.mjs), and omits anything that is not an exact byte
// substring. A subagent that misreads its file, paraphrases, or hallucinates is caught by
// grounding exactly as a hallucinating single model was before. Nothing about who reads the
// file changes what may be emitted.
//
// PORTABILITY TRADEOFF, STATED PLAINLY. src/claude.mjs needs only "a CLI that takes a
// prompt and returns JSON" and is portable to other tools. This adapter depends on Claude
// Code specifically — subagents, the Task and Read tools, `--json-schema`. That is why it
// is opt-in (`QUOTE_MINER_STRATEGY=agent`) and the per-source adapter remains the default.
//
// This module performs no IO beyond the subprocess call and does not import
// production-control.

import { basename } from 'node:path';
import { DEFAULT_COMMAND } from './claude-protocol.mjs';
import { agentArgs, buildBatchPrompt, parseBatchResponse } from './claude-agent-protocol.mjs';
import { spawnCapture, MAX_OUTPUT_BYTES } from './spawn.mjs';
import { withRetry, resolveMaxAttempts, resolveRetryDelayMs, defaultSleep } from './retry.mjs';

/**
 * Build a model object that mines a whole BATCH of sources per `claude` invocation.
 *
 * `selectBatch(sources)` takes `[{ id, path }]` and resolves to a
 * `Map<sourceId, Array<{ text, corrections }>>` — one entry per REQUESTED source, in the
 * requested order. It never spawns for an empty batch.
 *
 * FAIL LOUD (never a fabricated "nothing quotable"): a missing or misshapen envelope,
 * `is_error: true`, an id that was not requested, and a requested id the response omits
 * all throw. The last of those is the deliberate choice this adapter makes: an unanswered
 * source is a FAILURE, not an empty result. Silently recording it as "nothing quotable"
 * is the false-clean TASK-15 documents, where roughly a quarter of a 123-source corpus
 * contributed nothing while the run reported complete success. Because the throw happens
 * inside the retry budget below, a dropped subagent normally just costs one more attempt;
 * only a batch that fails every attempt fails the run — and the run then fails atomically,
 * which is the same contract `claudeModel.select()` has always had.
 *
 * MODEL IDENTITY (AUDIT-21, FR-020): identical contract to src/claude.mjs. `id` is a getter
 * and it CHANGES — the command basename before the first call, the real model the CLI
 * reported (`modelUsage` -> `canonicalModel`) after a successful batch — and an explicit
 * `options.modelId` / `QUOTE_MINER_MODEL_ID` outranks both. Callers stamping provenance
 * must read `resolvedId()` AFTER mining.
 *
 * @param {{
 *   command?: string,
 *   spawnImpl?: (command: string, args: string[], options: object) =>
 *     { status: number | null, stdout: string, stderr: string, error?: Error } |
 *     Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>,
 *   modelId?: string,
 *   maxAttempts?: number,
 *   retryDelayMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   onDiagnostic?: (event: object) => void
 * }} [options]
 * @returns {{
 *   id: string,
 *   resolvedId(): string,
 *   selectBatch(sources: Array<{ id: string, path: string }>):
 *     Promise<Map<string, Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>>
 * }}
 */
export function claudeAgentModel(options = {}) {
  // The fan-out protocol is Claude-Code-specific by construction, so unlike src/claude.mjs
  // there is no tolerant fallback: an override only relocates the BINARY (a wrapper used
  // for cost probing, a pinned install), never the wire shape.
  const command = options.command ?? process.env.QUOTE_MINER_MODEL_CMD ?? DEFAULT_COMMAND;
  const args = agentArgs();

  const spawnImpl = options.spawnImpl ?? spawnCapture;
  const maxAttempts = resolveMaxAttempts(options.maxAttempts);
  const retryDelayMs = resolveRetryDelayMs(options.retryDelayMs);
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const onDiagnostic = options.onDiagnostic;

  // Explicit operator escape hatch; outranks everything below.
  const rawOverride = process.env.QUOTE_MINER_MODEL_ID ?? options.modelId;
  const modelIdOverride = rawOverride ? rawOverride : null;

  // Learned from the CLI envelope on the first successful batch; null until then.
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

    async selectBatch(sources) {
      // Shape first, and BEFORE any subprocess: a batch entry without a path cannot be
      // read by a subagent, and quietly dropping it would understate the corpus.
      for (const source of sources) {
        if (typeof source.path !== 'string' || source.path.length === 0) {
          throw new Error(
            `claude agent model adapter: source '${source.id}' has no 'path'; the batch protocol ` +
              'hands file paths to subagents and cannot mine a source without one'
          );
        }
      }

      if (sources.length === 0) return new Map();

      const prompt = buildBatchPrompt(sources);
      const batchLabel = sources.map((source) => source.id).join(', ');

      return withRetry({
        maxAttempts,
        retryDelayMs,
        sleepImpl,
        attempt: () =>
          attemptBatch({ command, args, prompt, sources, spawnImpl, onIdentity, onDiagnostic }),
        describeFailure: (attempts, lastError) =>
          `claude agent model adapter: batch [${batchLabel}]: the model call failed after ` +
          `${attempts} attempt(s). last error: ${lastError.message}`,
      });
    },
  };

  function onIdentity(modelIdentity) {
    if (modelIdentity !== null) resolvedIdentity = modelIdentity;
  }
}

/**
 * One spawn + parse for a batch. Throws on spawn error, non-zero exit, or a response the
 * protocol cannot accept; the caller decides whether to retry.
 *
 * `spawnImpl` is awaited so the real (asynchronous) implementation and the synchronous
 * result objects the tests inject are both accepted.
 *
 * @returns {Promise<Map<string, Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>>}
 */
async function attemptBatch({ command, args, prompt, sources, spawnImpl, onIdentity, onDiagnostic }) {
  const res = await spawnImpl(command, args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (res.error) {
    throw new Error(
      `claude agent model adapter: failed to spawn '${command}': ${res.error.message}`
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `claude agent model adapter: '${command}' exited with status ${res.status}. stderr: ${res.stderr ?? ''}`
    );
  }

  const { bySource, modelIdentity, usage, numTurns } = parseBatchResponse(
    res.stdout ?? '',
    command,
    sources
  );
  onIdentity(modelIdentity);

  // Cost is the entire reason this adapter exists, so the envelope's own accounting is
  // offered to the caller rather than being discarded. Purely diagnostic: it touches
  // neither the candidates nor the bank.
  if (onDiagnostic !== undefined) {
    onDiagnostic({
      sources: sources.length,
      num_turns: numTurns,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    });
  }

  return bySource;
}

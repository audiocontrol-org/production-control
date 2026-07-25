// Bounded retry, shared by every model adapter (src/claude.mjs, src/claude-agent.mjs).
//
// WHY RETRY AT ALL: the model is stochastic, so a single failed or malformed response is
// often fine on a second attempt — a spawn error, a non-zero exit, unparseable output, or
// (on the fan-out path) a subagent that dropped one file.
//
// WHY BOUNDED, AND WHY IT THROWS: after the last attempt this FAILS LOUD, naming the
// attempt count and the last error. It never degrades to an empty candidate list, which
// would silently assert that a source had nothing quotable — the false-clean this project
// forbids (TASK-15).
//
// No IO of its own: the sleep is injectable so the tests never wait on a real timer.

import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Run `attempt` until it succeeds or the budget is exhausted.
 *
 * `attempt` is AWAITED inside the try — without that, a rejected attempt would escape the
 * catch and skip the retry budget entirely.
 *
 * @template T
 * @param {{
 *   attempt: (attemptNumber: number) => Promise<T>,
 *   maxAttempts: number,
 *   retryDelayMs: number,
 *   sleepImpl: (ms: number) => Promise<void>,
 *   describeFailure: (attempts: number, lastError: Error) => string
 * }} args
 * @returns {Promise<T>}
 */
export async function withRetry({ attempt, maxAttempts, retryDelayMs, sleepImpl, describeFailure }) {
  let lastError = null;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    if (attemptNumber > 1 && retryDelayMs > 0) {
      await sleepImpl(retryDelayMs * (attemptNumber - 1));
    }
    try {
      return await attempt(attemptNumber);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(describeFailure(maxAttempts, lastError), { cause: lastError });
}

/**
 * Attempt budget for one model call: the explicit option, else
 * `QUOTE_MINER_MODEL_MAX_ATTEMPTS`, else 3. A nonsensical value THROWS rather than being
 * quietly clamped.
 *
 * @param {number | undefined} option
 * @returns {number}
 */
export function resolveMaxAttempts(option) {
  const raw = option ?? process.env.QUOTE_MINER_MODEL_MAX_ATTEMPTS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_ATTEMPTS;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `claude model adapter: maxAttempts must be an integer >= 1; got ${JSON.stringify(raw)}`
    );
  }
  return value;
}

/**
 * Backoff between attempts, in ms: the explicit option, else
 * `QUOTE_MINER_MODEL_RETRY_DELAY_MS`, else 0. The default is 0 because the failure this
 * retry exists for is model stochasticity, not rate limiting — an immediate second attempt
 * is the right move, and it keeps the test suite fast. The delay grows linearly with the
 * attempt number.
 *
 * @param {number | undefined} option
 * @returns {number}
 */
export function resolveRetryDelayMs(option) {
  const raw = option ?? process.env.QUOTE_MINER_MODEL_RETRY_DELAY_MS;
  if (raw === undefined || raw === null || raw === '') return 0;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `claude model adapter: retryDelayMs must be a number >= 0; got ${JSON.stringify(raw)}`
    );
  }
  return value;
}

/** @param {number} ms */
export function defaultSleep(ms) {
  return delay(ms);
}

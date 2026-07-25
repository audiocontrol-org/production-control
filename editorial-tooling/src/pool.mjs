// A tiny bounded-concurrency worker pool, written here on purpose: this package takes no
// runtime dependency for something this small (no p-limit), and the exact failure and
// ordering semantics below are load-bearing for the miner's atomicity guarantee.
//
// Two properties define this pool:
//
//   ORDER IS INPUT ORDER. Results land in a slot keyed by the item's ORIGINAL index and
//   are returned in that order, never in completion order. Callers can therefore run work
//   in parallel and still assemble byte-identical output run to run.
//
//   FAILURE IS TOTAL AND QUIET. The first rejection stops NEW work from being scheduled,
//   but every already-in-flight task is awaited to settlement before this function
//   rejects. Runners capture their own errors instead of rejecting, so no promise is ever
//   left without a handler — Node emits no unhandled-rejection warning and never tears the
//   process down for work that was abandoned mid-flight.

/**
 * Map `items` through `worker` with at most `limit` concurrent calls, returning results in
 * the ORIGINAL item order.
 *
 * If any worker call rejects, no further items are scheduled, all in-flight calls are
 * awaited to settlement, and this rejects with the FIRST error (subsequent failures are
 * disclosed in that error's message so nothing is silently swallowed).
 *
 * @template T, R
 * @param {ReadonlyArray<T>} items
 * @param {number} limit  Positive integer; validate with resolveConcurrency() first.
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const failures = [];
  let next = 0;

  // Each runner pulls the next unclaimed index until the work is exhausted or a peer has
  // failed. `next++` is atomic here because JS runs these runners on one thread: only the
  // synchronous slice between awaits ever touches it.
  async function runner() {
    for (;;) {
      if (failures.length > 0) return; // (a) stop scheduling once a failure is known
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        // (b) Capture rather than reject: a rejecting runner would be an unhandled
        // rejection for the peers Promise.all no longer waits on.
        failures.push(err);
        return;
      }
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(runner());
  }
  // Runners never reject, so this awaits SETTLEMENT of all in-flight work — the pool
  // leaves nothing running behind it.
  await Promise.all(runners);

  if (failures.length > 0) {
    throw combineFailures(failures);
  }
  return results;
}

/**
 * Report the first failure, disclosing any concurrent ones.
 *
 * With a bound of N, up to N sources can fail in the same instant. Reporting only the
 * first would hide the others behind a fix-one-at-a-time loop, so the rest are appended to
 * the message; the first error is preserved verbatim as `cause` (and as the message
 * prefix) so existing callers matching on it keep working.
 *
 * @param {Error[]} failures
 * @returns {Error}
 */
function combineFailures(failures) {
  const [first, ...rest] = failures;
  if (rest.length === 0) return first;
  const others = rest.map((err) => err.message).join('; ');
  return new Error(
    `${first.message} (${rest.length} other source(s) failed concurrently: ${others})`,
    { cause: first }
  );
}

/**
 * Resolve the concurrency bound from an explicit option, else an environment value, else
 * the default.
 *
 * A bad value THROWS naming it rather than being clamped: silently turning `0` or `'four'`
 * into 4 would hide a misconfigured pipeline behind a run that looks fine.
 *
 * Also used for the batch path's `chunkSize` (src/miner.mjs), which has exactly the same
 * "positive integer, else fail loud naming it" contract — hence the `label`/`envName`
 * knobs rather than a second copy of this function.
 *
 * @param {unknown} option  The caller's `concurrency` argument, or undefined.
 * @param {string | undefined} envValue  Raw environment string, or undefined.
 * @param {{ envName?: string, fallback?: number, label?: string }} [names]
 * @returns {number}
 */
export function resolveConcurrency(option, envValue, names = {}) {
  const envName = names.envName ?? 'QUOTE_MINER_CONCURRENCY';
  const fallback = names.fallback ?? DEFAULT_CONCURRENCY;
  const label = names.label ?? 'concurrency';

  if (option !== undefined) {
    if (!isPositiveInteger(option)) {
      throw new Error(
        `invalid ${label} ${describe(option)}: must be an integer >= 1`
      );
    }
    return option;
  }

  if (envValue !== undefined && envValue.trim() !== '') {
    const parsed = Number(envValue);
    if (!isPositiveInteger(parsed)) {
      throw new Error(
        `invalid ${envName} '${envValue}': must be an integer >= 1`
      );
    }
    return parsed;
  }

  return fallback;
}

/**
 * Default bound. Every model call spawns a full `claude` subprocess, so unbounded fan-out
 * over a 100+ source corpus would be hostile to memory and to any provider rate limit.
 */
export const DEFAULT_CONCURRENCY = 4;

/** @param {unknown} value */
function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Render a bad value for an error message without losing its type. */
function describe(value) {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

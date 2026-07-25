// Impure quote miner (US2 core). Selects quotable passages via an injected model
// (the impure "model points" step), then GROUNDS each selection deterministically by
// copying the exact UTF-8 bytes out of the source (FR-014: never emit an ungrounded
// passage). No production-control import; operates purely on values passed to it.
//
// The model call is impure (selection varies by model/run), but grounding + assembly
// are deterministic given the model's output. The miner NEVER returns a partial bank:
// a bad source id (FR-018), invalid UTF-8, or a model rejection (FR-015b/016) all throw
// before or instead of returning. It reports no validation verdict — acceptance is the
// independent validator's job (FR-013).
//
// THREE COLLABORATORS, one concern each: src/grounding.mjs owns the fidelity step (shared
// by every seam so it cannot be reimplemented), src/miner-batch.mjs owns the `selectBatch`
// seam, and src/cache.mjs owns the per-source result cache that makes a killed run
// resumable. This file owns orchestration, the per-source seam, and assembly.

import { stringify } from 'yaml';
import { buildSourceMap } from './validator.mjs';
import { mapWithConcurrency, resolveConcurrency } from './pool.mjs';
import { openCache } from './cache.mjs';
import { groundSource, decodeUtf8OrThrow, resolveModelIdentity } from './grounding.mjs';
import { mineInBatches, replayCached, DEFAULT_CHUNK_SIZE } from './miner-batch.mjs';

/**
 * Mine grounded quotes from a corpus of sources using an injected model.
 *
 * Sources are mined with BOUNDED CONCURRENCY (TASK-11). They are completely independent —
 * grounding is a byte search against THAT source's own bytes and quote ids are
 * `q-<sourceId>-<n>`, scoped per source — so serializing them bought nothing but wall
 * clock, and on a 100+ source corpus that wall clock was long enough that interruptions
 * kept destroying whole runs (the build is atomic). ASSEMBLY REMAINS DETERMINISTIC: each
 * source's result is collected into a slot keyed by its ORIGINAL index and the bank and
 * report are assembled in that order, so identical model responses produce identical
 * output no matter which source finishes first.
 *
 * `concurrency` (optional) bounds the number of in-flight model calls; it falls back to
 * `QUOTE_MINER_CONCURRENCY`, then to 4. A non-integer or `< 1` value throws. `concurrency:
 * 1` is exactly the old serial path.
 *
 * `onProgress` (optional) is invoked after EACH source completes, with that source's
 * counts, so a caller can report progress WHILE a long run is in flight instead of only
 * seeing the report at the end (TASK-10). It is a diagnostic channel only: it does not
 * affect the bank or the final report. Because completions no longer arrive in source
 * order, the event carries BOTH `index` (the source's original 1-based position, which
 * identifies it) and `completed` (a monotonically increasing count, which shows forward
 * motion).
 *
 * A model may additionally PROPOSE OCR corrections per candidate (TASK-9). It only ever
 * points at them: the tool verifies each against the grounded bytes, discloses the kept
 * ones as closed-set `ocr-fix` edits, and derives `text` mechanically (src/corrections.mjs).
 * `spans[].raw` remains the exact source bytes in every case.
 *
 * `model.select` may return either plain candidate strings (legacy shape) or
 * `{ text, corrections }` objects; both are normalized. A candidate that is neither
 * THROWS rather than being guessed at.
 *
 * TWO MODEL SEAMS (see src/claude.mjs and src/claude-agent.mjs):
 *
 *   * `model.selectBatch(sources)` — if present, it WINS. Sources are chunked and each
 *     chunk is asked for in ONE model call, which lets an adapter fan the chunk out
 *     internally (one subagent per source) instead of paying a full CLI setup per source.
 *     Chunks are dispatched through the SAME concurrency pool, so chunks run concurrently
 *     and each one fans out inside itself. The batch seam is handed `{ id, path }` — never
 *     bytes — so source text stays out of the model's prompt.
 *   * `model.select(id, text)` — otherwise, exactly today's per-source path, unchanged.
 *
 * BOTH PATHS GROUND IDENTICALLY. Whoever read the file — this process for `select`, a
 * subagent for `selectBatch` — the candidate is still verified against the bytes THIS
 * function was handed, and omitted if it is not an exact byte substring of them (FR-014).
 * Grounding never consults what a subagent claims it read, so a subagent that misreads or
 * hallucinates is caught exactly as a hallucinating single model was. The two seams
 * therefore produce byte-identical banks for identical model output.
 *
 * `chunkSize` (batch path only) is the number of sources per model call: the option, else
 * `QUOTE_MINER_CHUNK_SIZE`, else 10. It is validated exactly like `concurrency` — a
 * non-integer or `< 1` value throws naming it — and is validated on BOTH paths, so a
 * misconfigured environment surfaces rather than lurking until someone opts into batching.
 *
 * RESUMABILITY (`cacheDir`, else `QUOTE_MINER_CACHE_DIR`, else OFF — see src/cache.mjs).
 * Mining is atomic, so a killed run or one bad answer at source 59 used to discard every
 * completed source. With a cache configured, each source's MODEL OUTPUT is persisted the
 * instant that source completes, and a later run skips the model for anything already on
 * disk. ONLY the model call is skipped: grounding, correction verification, and assembly run
 * on the identical code path, so a cached candidate is verified against the current bytes
 * exactly like a fresh one and the cache can never introduce an ungrounded quote. Ordering
 * is unaffected — the bank and `report.per_source` stay in ORIGINAL source order whatever
 * was cached.
 *
 * @param {{
 *   sources: Array<{ id: string, path?: string, bytes: Buffer }>,
 *   model: {
 *     id: string,
 *     resolvedId?: () => string,
 *     select?: (sourceId: string, sourceText: string) =>
 *       Promise<Array<string | { text: string, corrections?: Array<{ before: string, after: string }> }>>,
 *     selectBatch?: (sources: Array<{ id: string, path: string }>) =>
 *       Promise<Map<string, Array<string | { text: string, corrections?: Array<{ before: string, after: string }> }>>>
 *   },
 *   concurrency?: number,
 *   chunkSize?: number,
 *   cacheDir?: string,
 *   onProgress?: (event: {
 *     index: number, completed: number, total: number, id: string,
 *     selected: number, grounded: number, omitted: number,
 *     corrections_proposed: number, corrections_applied: number, corrections_dropped: number,
 *     from_cache: boolean
 *   }) => void
 * }} args
 * @returns {Promise<{ bank: object, report: object }>}
 */
export async function mine({ sources, model, onProgress, concurrency, chunkSize, cacheDir }) {
  // FR-018: enforce the source-id mapping BEFORE processing any quote. A duplicate,
  // case-collision, or invalid (path/control-char) id fails the whole run loud.
  const { errors } = buildSourceMap(sources);
  if (errors.length > 0) {
    throw new Error(`source-id mapping is ambiguous (FR-018): ${errors.join('; ')}`);
  }

  // A bad bound fails BEFORE any model subprocess is spawned.
  const limit = resolveConcurrency(concurrency, process.env.QUOTE_MINER_CONCURRENCY);
  const batchSize = resolveConcurrency(chunkSize, process.env.QUOTE_MINER_CHUNK_SIZE, {
    envName: 'QUOTE_MINER_CHUNK_SIZE',
    fallback: DEFAULT_CHUNK_SIZE,
    label: 'chunkSize'
  });

  // `null` when no location was configured — the default, and byte-for-byte today's
  // behaviour (no directory created, no file written, no entry read).
  const cache = openCache({ cacheDir });

  const total = sources.length;
  let completed = 0;

  // Progress is a LIVENESS signal, emitted in completion order: `completed` counts up
  // monotonically so an operator sees motion, while `index`/`id` name WHICH source it was
  // (its original 1-based position). Neither influences assembly below. It fires per
  // SOURCE on both paths — a batch reports its sources as the batch returns, never one
  // event per chunk, so the operator still sees per-source motion.
  //
  // `from_cache` rides on the event (not on `counts`) so `report.per_source` keeps EXACTLY
  // the shape it has always had: a resumed run's per-source counts must be comparable to
  // the original run's, and they would not be if a provenance flag were mixed into them.
  const emitProgress = (index, result) => {
    completed++;
    if (onProgress !== undefined) {
      onProgress({ index: index + 1, completed, total, ...result.counts, from_cache: result.fromCache });
    }
  };

  const mined =
    typeof model.selectBatch === 'function'
      ? await mineInBatches({ sources, model, limit, batchSize, cache, emitProgress })
      : // The pool returns per-source results in ORIGINAL index order regardless of which
        // source finished first (src/pool.mjs), and it fails the whole run on the first
        // error without leaving in-flight work unhandled — preserving FR-015/FR-016
        // atomicity.
        await mapWithConcurrency(sources, limit, async (source, index) => {
          const result = await mineSource(source, model, cache);
          emitProgress(index, result);
          return result;
        });

  const quotes = [];
  let totalSelected = 0;
  let totalGrounded = 0;
  let totalOmitted = 0;
  let totalProposed = 0;
  let totalApplied = 0;
  let totalDropped = 0;

  // Which sources were served from the cache, and every model identity that contributed to
  // this bank. Both are collected in original source order, so a resumed run's report is as
  // deterministic as its bank.
  const cachedSources = [];
  const identities = new Set();
  // Read the model's identity ONCE, AFTER mining (AUDIT-21/FR-020): an adapter only learns
  // the real model from the CLI's response envelope, so an early read would record the
  // command name and hide a model swap.
  const freshIdentity = resolveModelIdentity(model);

  // DETERMINISTIC ASSEMBLY: walk the slots in original source order, never completion
  // order, so two runs over the same corpus with the same model responses are byte
  // identical.
  for (const result of mined) {
    if (result.fromCache) {
      cachedSources.push(result.counts.id);
      identities.add(result.modelIdentity);
    } else {
      identities.add(freshIdentity);
    }
    quotes.push(...result.quotes);
    totalSelected += result.counts.selected;
    totalGrounded += result.counts.grounded;
    totalOmitted += result.counts.omitted;
    totalProposed += result.counts.corrections_proposed;
    totalApplied += result.counts.corrections_applied;
    totalDropped += result.counts.corrections_dropped;
  }

  const bank = { version: 1, quotes };

  const report = {
    selected: totalSelected,
    grounded: totalGrounded,
    omitted_ungrounded: totalOmitted,
    sources_processed: sources.length,
    // On any source failure the run THREW above, so a returned report always has 0
    // skipped and 0 failed.
    sources_skipped: 0,
    sources_failed: 0,
    // Disclosed OCR corrections (TASK-9). `proposed` counts only corrections attached
    // to a GROUNDED candidate; `applied` are the ones verified against `raw` and
    // emitted as `ocr-fix` edits; `dropped` are the rest (before absent from raw,
    // overlapping an accepted edit, or a whole-quote degrade to verbatim source text).
    // proposed === applied + dropped, always.
    corrections_proposed: totalProposed,
    corrections_applied: totalApplied,
    corrections_dropped: totalDropped,
    // RESUMPTION DISCLOSURE. A run that was mostly served from disk looks suspiciously fast
    // and cheap; saying so is the difference between "resumed" and "silently did less".
    // `cache_entries_ignored` counts entries that existed but were unusable (wrong protocol
    // version, corrupt, unreadable) — a rotting cache is visible instead of merely slow.
    sources_from_cache: cachedSources.length,
    cached_sources: cachedSources,
    cache_entries_ignored: cache === null ? 0 : cache.stats().ignored,
    // PROVENANCE, NOT UNIFORMITY. A resumed run can legitimately mix models: sources cached
    // under yesterday's model plus sources mined fresh under today's. Forbidding the mix
    // would throw away exactly the completed work the cache exists to preserve, so the mix
    // is allowed and DISCLOSED instead — every identity that contributed is listed, sorted
    // for determinism, and callers stamping provenance must report the plurality rather
    // than picking one and implying the bank came from a single model.
    model_identities: [...identities].sort(),
    // Ordered by original source index (see the assembly loop above), not by which
    // source the pool happened to finish first.
    per_source: mined.map((result) => result.counts)
  };

  return { bank, report };
}

/**
 * Mine ONE source through the per-source seam: decode it, ask the model to point at
 * candidates, and ground each candidate against this source's own bytes.
 *
 * Extracted so the pool can run sources concurrently while this stays a pure per-source
 * unit: it touches no shared accumulator, so nothing here depends on the order sources are
 * processed in. Grounding semantics are unchanged (FR-014).
 *
 * A CACHE HIT SKIPS THE MODEL CALL AND NOTHING ELSE. The decode still runs (a non-UTF-8
 * source must fail whether or not someone once mined it) and grounding still runs against
 * this source's current bytes, so a cached candidate is held to exactly the same standard
 * as a fresh one.
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {{ id: string, select: Function }} model
 * @param {{ read: Function, write: Function } | null} cache
 * @returns {Promise<{ quotes: object[], counts: object, fromCache: boolean }>}
 */
async function mineSource(source, model, cache) {
  // Decode with FATAL so invalid UTF-8 throws. A non-UTF-8 source fails the run
  // (FR-015b/016) — no partial bank, no catch-and-continue.
  const text = decodeUtf8OrThrow(source.id, source.bytes);

  const entry = cache === null ? null : cache.read(source);
  if (entry !== null) return replayCached(source, entry);

  // Impure step: the model points at candidate passages (and may propose OCR
  // corrections for them). A model rejection propagates and fails the run.
  const candidates = await model.select(source.id, text);

  const result = groundSource(
    source,
    candidates,
    `miner: model '${model.id}' on source '${source.id}'`
  );
  result.fromCache = false;
  result.modelIdentity = null;

  // Written the MOMENT this source completes — not at the end of the run. Writing at the
  // end would cache nothing in the one case the cache exists for: a run that dies partway.
  // Persisting only after grounding normalized the candidates keeps a model protocol
  // violation from sticking to the corpus forever.
  if (cache !== null) {
    cache.write(source, { modelIdentity: resolveModelIdentity(model), candidates });
  }

  return result;
}

/**
 * Serialize a bank object to a YAML string for the bin (T014) to write to disk.
 *
 * @param {object} bank
 * @returns {string}
 */
export function serializeBank(bank) {
  return stringify(bank);
}

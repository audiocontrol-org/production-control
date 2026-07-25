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

import { stringify } from 'yaml';
import { buildSourceMap } from './validator.mjs';
import { normalizeCandidates, buildQuote } from './corrections.mjs';
import { mapWithConcurrency, resolveConcurrency } from './pool.mjs';

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
 * @param {{
 *   sources: Array<{ id: string, path?: string, bytes: Buffer }>,
 *   model: {
 *     id: string,
 *     select?: (sourceId: string, sourceText: string) =>
 *       Promise<Array<string | { text: string, corrections?: Array<{ before: string, after: string }> }>>,
 *     selectBatch?: (sources: Array<{ id: string, path: string }>) =>
 *       Promise<Map<string, Array<string | { text: string, corrections?: Array<{ before: string, after: string }> }>>>
 *   },
 *   concurrency?: number,
 *   chunkSize?: number,
 *   onProgress?: (event: {
 *     index: number, completed: number, total: number, id: string,
 *     selected: number, grounded: number, omitted: number,
 *     corrections_proposed: number, corrections_applied: number, corrections_dropped: number
 *   }) => void
 * }} args
 * @returns {Promise<{ bank: object, report: object }>}
 */
export async function mine({ sources, model, onProgress, concurrency, chunkSize }) {
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

  const total = sources.length;
  let completed = 0;

  // Progress is a LIVENESS signal, emitted in completion order: `completed` counts up
  // monotonically so an operator sees motion, while `index`/`id` name WHICH source it was
  // (its original 1-based position). Neither influences assembly below. It fires per
  // SOURCE on both paths — a batch reports its sources as the batch returns, never one
  // event per chunk, so the operator still sees per-source motion.
  const emitProgress = (index, result) => {
    completed++;
    if (onProgress !== undefined) {
      onProgress({ index: index + 1, completed, total, ...result.counts });
    }
  };

  const mined =
    typeof model.selectBatch === 'function'
      ? await mineInBatches({ sources, model, limit, batchSize, emitProgress })
      : // The pool returns per-source results in ORIGINAL index order regardless of which
        // source finished first (src/pool.mjs), and it fails the whole run on the first
        // error without leaving in-flight work unhandled — preserving FR-015/FR-016
        // atomicity.
        await mapWithConcurrency(sources, limit, async (source, index) => {
          const result = await mineSource(source, model);
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

  // DETERMINISTIC ASSEMBLY: walk the slots in original source order, never completion
  // order, so two runs over the same corpus with the same model responses are byte
  // identical.
  for (const result of mined) {
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
    // Ordered by original source index (see the assembly loop above), not by which
    // source the pool happened to finish first.
    per_source: mined.map((result) => result.counts)
  };

  return { bank, report };
}

/** Sources per batch model call when neither the option nor the env var says otherwise. */
const DEFAULT_CHUNK_SIZE = 10;

/**
 * Mine every source through the BATCH seam: partition the corpus into chunks, ask the
 * model about one chunk per call, and ground each answer against the bytes WE loaded.
 *
 * Chunks are dispatched through the same bounded pool the per-source path uses, so the
 * concurrency bound now counts in-flight CHUNKS (each of which fans out internally). The
 * pool returns chunk results in original chunk order, and each chunk's results are in
 * source order within it, so flattening yields exactly the original source order — the
 * same determinism guarantee, one level up.
 *
 * @param {{
 *   sources: Array<{ id: string, path?: string, bytes: Buffer }>,
 *   model: { id: string, selectBatch: Function },
 *   limit: number,
 *   batchSize: number,
 *   emitProgress: (index: number, result: object) => void
 * }} args
 * @returns {Promise<Array<{ quotes: object[], counts: object }>>}
 */
async function mineInBatches({ sources, model, limit, batchSize, emitProgress }) {
  // A source with no path cannot be handed to a batch adapter (which gives paths to
  // subagents rather than shipping text). Fail BEFORE any model call, naming it: quietly
  // dropping it, or quietly falling back to the per-source seam, would silently change
  // what the corpus contains.
  const pathless = sources.filter((s) => typeof s.path !== 'string' || s.path.length === 0);
  if (pathless.length > 0) {
    throw new Error(
      `miner: the model exposes selectBatch, which mines sources by path, but ` +
        `${pathless.length} source(s) have no 'path': ${pathless.map((s) => s.id).join(', ')}`
    );
  }

  const chunks = [];
  for (let start = 0; start < sources.length; start += batchSize) {
    chunks.push({ offset: start, items: sources.slice(start, start + batchSize) });
  }

  const minedChunks = await mapWithConcurrency(chunks, limit, async ({ offset, items }) => {
    // Decode with FATAL first, exactly as the per-source path does: a non-UTF-8 source
    // fails the run (FR-015b/016) rather than being sent to a model.
    for (const source of items) {
      decodeUtf8OrThrow(source.id, source.bytes);
    }

    // Impure step: ONE model call for the whole chunk. Only ids and paths cross this
    // boundary — never bytes.
    const answered = await model.selectBatch(items.map(({ id, path }) => ({ id, path })));
    if (!(answered instanceof Map)) {
      throw new Error(
        `miner: model '${model.id}' selectBatch must resolve to a Map of source id -> candidates; ` +
          `got ${Object.prototype.toString.call(answered)}`
      );
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const source = items[i];
      if (!answered.has(source.id)) {
        // NOT "nothing quotable": an unanswered source is an unanswered question. Recording
        // it as an empty result would be a false-clean (TASK-15).
        throw new Error(
          `miner: model '${model.id}' returned no answer for requested source '${source.id}'; ` +
            'a missing answer is not the same as a source with nothing quotable'
        );
      }
      const result = groundSource(
        source,
        answered.get(source.id),
        `miner: model '${model.id}' on source '${source.id}'`
      );
      emitProgress(offset + i, result);
      results.push(result);
    }
    return results;
  });

  return minedChunks.flat();
}

/**
 * Mine ONE source through the per-source seam: decode it, ask the model to point at
 * candidates, and ground each candidate against this source's own bytes.
 *
 * Extracted so the pool can run sources concurrently while this stays a pure per-source
 * unit: it touches no shared accumulator, so nothing here depends on the order sources are
 * processed in. Grounding semantics are unchanged (FR-014).
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {{ id: string, select: Function }} model
 * @returns {Promise<{ quotes: object[], counts: object }>}
 */
async function mineSource(source, model) {
  // Decode with FATAL so invalid UTF-8 throws. A non-UTF-8 source fails the run
  // (FR-015b/016) — no partial bank, no catch-and-continue.
  const text = decodeUtf8OrThrow(source.id, source.bytes);

  // Impure step: the model points at candidate passages (and may propose OCR
  // corrections for them). A model rejection propagates and fails the run.
  const candidates = await model.select(source.id, text);

  return groundSource(source, candidates, `miner: model '${model.id}' on source '${source.id}'`);
}

/**
 * GROUND a source's candidates: the one place a passage becomes a quote, shared by BOTH
 * model seams so they cannot drift apart.
 *
 * THE FIDELITY INVARIANT LIVES HERE. Grounding is `bytes.indexOf` against the bytes the
 * CALLER loaded for this source — never against whatever the model, or a subagent that
 * read the file itself, claims the file says. A candidate that is not an exact byte
 * substring of those bytes is OMITTED (FR-014). That is why fanning selection out to
 * subagents changes nothing about fidelity: a subagent that misreads, paraphrases, or
 * hallucinates produces candidates that simply fail to ground, exactly as a hallucinating
 * single model's did.
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {unknown[]} rawCandidates  whatever the model returned, unnormalized
 * @param {string} context  names the producer, for error messages
 * @returns {{ quotes: object[], counts: object }}
 */
function groundSource({ id, bytes }, rawCandidates, context) {
  const candidates = normalizeCandidates(rawCandidates, context);

  const quotes = [];
  let grounded = 0;
  let omitted = 0;
  let proposed = 0;
  let applied = 0;
  let dropped = 0;

  for (const candidate of candidates) {
    // Ground by copying EXACT bytes: is the candidate an exact byte substring of
    // THIS source? (UTF-8 bytes, no normalization.)
    const candBuf = Buffer.from(candidate.text, 'utf8');
    if (bytes.indexOf(candBuf) >= 0) {
      // The grounded source bytes are the span's `raw` — always, uncorrected. Any
      // proposed correction is verified against those bytes, disclosed as an
      // `ocr-fix`, and `text` is derived mechanically (src/corrections.mjs).
      // Corrections are only counted for GROUNDED candidates: an omitted candidate
      // has no `raw` to verify a correction against.
      //
      // The `<n>` in the id counts grounded quotes WITHIN this source, so ids stay
      // stable no matter how many sources run at once.
      const built = buildQuote({
        id: `q-${id}-${grounded}`,
        source: id,
        raw: candidate.text,
        corrections: candidate.corrections
      });
      quotes.push(built.quote);
      proposed += built.proposed;
      applied += built.applied;
      dropped += built.dropped;
      grounded++;
    } else {
      // Ungrounded: OMIT it (never emit an unverified passage — FR-014).
      omitted++;
    }
  }

  return {
    quotes,
    counts: {
      id,
      selected: candidates.length,
      grounded,
      omitted,
      corrections_proposed: proposed,
      corrections_applied: applied,
      corrections_dropped: dropped
    }
  };
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

/**
 * Decode source bytes to UTF-8 text with FATAL decoding, throwing a named error if the
 * bytes are not valid UTF-8.
 *
 * @param {string} id
 * @param {Buffer} bytes
 * @returns {string}
 */
function decodeUtf8OrThrow(id, bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`source '${id}' is not valid UTF-8`);
  }
}

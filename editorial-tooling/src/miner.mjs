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
 * @param {{
 *   sources: Array<{ id: string, bytes: Buffer }>,
 *   model: {
 *     id: string,
 *     select: (sourceId: string, sourceText: string) =>
 *       Promise<Array<string | { text: string, corrections?: Array<{ before: string, after: string }> }>>
 *   },
 *   concurrency?: number,
 *   onProgress?: (event: {
 *     index: number, completed: number, total: number, id: string,
 *     selected: number, grounded: number, omitted: number,
 *     corrections_proposed: number, corrections_applied: number, corrections_dropped: number
 *   }) => void
 * }} args
 * @returns {Promise<{ bank: object, report: object }>}
 */
export async function mine({ sources, model, onProgress, concurrency }) {
  // FR-018: enforce the source-id mapping BEFORE processing any quote. A duplicate,
  // case-collision, or invalid (path/control-char) id fails the whole run loud.
  const { errors } = buildSourceMap(sources);
  if (errors.length > 0) {
    throw new Error(`source-id mapping is ambiguous (FR-018): ${errors.join('; ')}`);
  }

  // A bad bound fails BEFORE any model subprocess is spawned.
  const limit = resolveConcurrency(concurrency, process.env.QUOTE_MINER_CONCURRENCY);

  const total = sources.length;
  let completed = 0;

  // The pool returns per-source results in ORIGINAL index order regardless of which
  // source finished first (src/pool.mjs), and it fails the whole run on the first error
  // without leaving in-flight work unhandled — preserving FR-015/FR-016 atomicity.
  const mined = await mapWithConcurrency(sources, limit, async (source, index) => {
    const result = await mineSource(source, model);

    // Progress is a LIVENESS signal, emitted in completion order: `completed` counts up
    // monotonically so an operator sees motion, while `index`/`id` name WHICH source it
    // was (its original 1-based position). Neither influences assembly below.
    completed++;
    if (onProgress !== undefined) {
      onProgress({
        index: index + 1,
        completed,
        total,
        ...result.counts
      });
    }
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

/**
 * Mine ONE source: decode it, ask the model to point at candidates, and ground each
 * candidate against this source's own bytes.
 *
 * Extracted so the pool can run sources concurrently while this stays a pure per-source
 * unit: it touches no shared accumulator, so nothing here depends on the order sources are
 * processed in. Grounding semantics are unchanged (FR-014).
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {{ id: string, select: Function }} model
 * @returns {Promise<{ quotes: object[], counts: object }>}
 */
async function mineSource({ id, bytes }, model) {
  // Decode with FATAL so invalid UTF-8 throws. A non-UTF-8 source fails the run
  // (FR-015b/016) — no partial bank, no catch-and-continue.
  const text = decodeUtf8OrThrow(id, bytes);

  // Impure step: the model points at candidate passages (and may propose OCR
  // corrections for them). A model rejection propagates and fails the run.
  const candidates = normalizeCandidates(
    await model.select(id, text),
    `miner: model '${model.id}' on source '${id}'`
  );

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

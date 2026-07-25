// Model-proposed OCR corrections: normalization (what the model may say) and the
// verify -> apply -> derive pipeline (what the tool actually does with it).
//
// THE DISCIPLINE (TASK-9): the model POINTS, the tool CONTROLS THE BYTES.
//   * A span's `raw` is ALWAYS the exact, unmodified source bytes — never a corrected
//     form. Fidelity of `raw` is untouched by anything in this module.
//   * Every correction the tool keeps is DISCLOSED as a closed-set `ocr-fix` edit
//     recording the incorrect source form in `before` (data-model.md §Edit).
//   * The presentation `text` is DERIVED MECHANICALLY by `reconstruct()` from
//     src/edits.mjs — the SAME function the validator uses — so the miner and the
//     validator agree by construction. `text` is never taken from the model.
//   * A proposed correction whose `before` is not actually present in the grounded
//     `raw` is DROPPED (the same "cannot be grounded -> omit" discipline as FR-014).
//     Dropping a correction keeps the quote (uncorrected); it never drops the quote.
//
// No IO, no network, no production-control import.

import { reconstruct } from './edits.mjs';

/**
 * Normalize one model candidate to the object shape `{ text, corrections }`.
 *
 * Accepts BOTH the legacy plain-string shape (normalized to zero corrections) and the
 * object shape. Anything else THROWS — a candidate the tool cannot understand is a
 * defect to surface, never something to guess at or fabricate.
 *
 * @param {unknown} candidate
 * @param {string} context names the producer, for the error message
 * @returns {{ text: string, corrections: Array<{ before: string, after: string }> }}
 */
export function normalizeCandidate(candidate, context) {
  if (typeof candidate === 'string') {
    return { text: candidate, corrections: [] };
  }

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate) ||
    typeof candidate.text !== 'string'
  ) {
    return failCandidate(context, candidate);
  }

  const proposed = candidate.corrections;
  if (proposed === undefined || proposed === null) {
    return { text: candidate.text, corrections: [] };
  }
  if (!Array.isArray(proposed)) {
    throw new Error(`${context}: candidate 'corrections' must be an array`);
  }

  const corrections = proposed.map((correction) => {
    if (
      typeof correction !== 'object' ||
      correction === null ||
      typeof correction.before !== 'string' ||
      typeof correction.after !== 'string'
    ) {
      throw new Error(
        `${context}: each correction must be an object with string 'before' and 'after'`
      );
    }
    return { before: correction.before, after: correction.after };
  });

  return { text: candidate.text, corrections };
}

/**
 * Normalize a list of model candidates. @see normalizeCandidate
 *
 * @param {unknown[]} candidates
 * @param {string} context
 * @returns {Array<{ text: string, corrections: Array<{ before: string, after: string }> }>}
 */
export function normalizeCandidates(candidates, context) {
  return candidates.map((candidate) => normalizeCandidate(candidate, context));
}

/**
 * Build a quote from an already-GROUNDED span plus the model's proposed corrections.
 *
 * `raw` MUST be the exact grounded source bytes; it is copied into the span verbatim
 * and is never altered here. Each proposed correction is VERIFIED against those bytes:
 *   - `before` absent from `raw`               -> dropped (counted)
 *   - `before` overlaps an already-kept edit    -> dropped (counted)
 *   - `before` occurs more than once            -> kept, pinned with an explicit `at`
 *     at the FIRST occurrence (the structural rules require `at` when `before` is not
 *     unique, else the edit is ambiguous). This is deliberate and consistent: a
 *     repeated corrupt form is corrected at its first occurrence only.
 *   - `before` occurs exactly once              -> kept, no `at` needed
 *
 * `text` is then derived by `reconstruct()`. If reconstruction reports an error, ALL
 * corrections for this quote are dropped and the quote degrades to `text = raw`,
 * `edits: []`. That is NOT a "fallback to fake data": the verbatim source text is the
 * most truthful possible value, a faithful uncorrected quote is always valid, and the
 * drop is counted and disclosed in the mining report.
 *
 * @param {{
 *   id: string, source: string, raw: string,
 *   corrections: Array<{ before: string, after: string }>
 * }} args
 * @returns {{ quote: object, proposed: number, applied: number, dropped: number }}
 */
export function buildQuote({ id, source, raw, corrections }) {
  const proposed = corrections.length;
  const rawBytes = Buffer.from(raw, 'utf8');

  const edits = [];
  const claimed = []; // [start, end) byte ranges in raw already taken by a kept edit

  for (const { before, after } of corrections) {
    const beforeBytes = Buffer.from(before, 'utf8');
    if (beforeBytes.length === 0) continue; // an insertion; no closed-set op permits it

    const start = rawBytes.indexOf(beforeBytes);
    if (start < 0) continue; // not grounded in raw -> drop

    const end = start + beforeBytes.length;
    if (claimed.some(([cStart, cEnd]) => start < cEnd && cStart < end)) continue; // overlap

    const occurrences = countOccurrences(rawBytes, beforeBytes);
    edits.push(
      occurrences > 1
        ? { op: 'ocr-fix', span: 0, at: start, before, after }
        : { op: 'ocr-fix', span: 0, before, after }
    );
    claimed.push([start, end]);
  }

  const quote = { id, source, spans: [{ raw }], text: raw, edits };

  // Derive the presentation MECHANICALLY from raw + disclosed edits, using the same
  // function the validator uses. `text` never comes from the model.
  const reconstructed = reconstruct(quote);
  if (reconstructed.error !== null) {
    quote.edits = [];
    quote.text = raw;
    return { quote, proposed, applied: 0, dropped: proposed };
  }

  quote.text = reconstructed.text;
  return { quote, proposed, applied: edits.length, dropped: proposed - edits.length };
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let fromIndex = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx === -1) break;
    count++;
    fromIndex = idx + 1;
  }
  return count;
}

function failCandidate(context, candidate) {
  throw new Error(
    `${context}: each candidate must be a string or an object with a string 'text'; got ${JSON.stringify(candidate)}`
  );
}

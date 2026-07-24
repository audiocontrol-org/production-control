// Deterministic quote-bank validator (US1): source-map assembly (FR-018) and the
// fidelity gate (data-model.md §Validation rules). No IO, no network, no LLM, and no
// import of production-control — this module operates purely on values passed to it.

import { structuralDefects } from './schema.mjs';
import { reconstruct, firstByteDiff } from './edits.mjs';

function hasControlChar(str) {
  const SPACE_CODE = ' '.codePointAt(0);
  for (let i = 0; i < str.length; i++) {
    if (str.codePointAt(i) < SPACE_CODE) return true;
  }
  return false;
}

/**
 * Assemble the source-id -> bytes map from raw source files, detecting FR-018
 * ambiguities (duplicate id, case-collision, invalid id). Does not read or write
 * any file itself; `files` bytes are taken as-is.
 *
 * @param {Array<{ id: string, bytes: Buffer }>} files
 * @returns {{ sources: Map<string, Buffer>, errors: string[] }}
 */
export function buildSourceMap(files) {
  const sources = new Map();
  const errors = [];
  const seenLower = new Map(); // lowercased id -> original id first seen

  for (const file of files) {
    const { id, bytes } = file;

    if (id.includes('/') || id.includes('\\') || hasControlChar(id)) {
      errors.push(`invalid source id '${id}'`);
      continue;
    }

    if (sources.has(id)) {
      errors.push(`duplicate source id '${id}'`);
      continue;
    }

    const lower = id.toLowerCase();
    const priorId = seenLower.get(lower);
    if (priorId !== undefined && priorId !== id) {
      errors.push(`source id case-collision: '${priorId}' vs '${id}'`);
      continue;
    }
    seenLower.set(lower, id);

    sources.set(id, bytes);
  }

  return { sources, errors };
}

/**
 * Validate a parsed quote bank against its sources: structural checks first
 * (data-model.md Step 0), then per-quote fidelity checks. Pure and deterministic —
 * no LLM, no similarity threshold, no network — and never mutates `sources`.
 *
 * @param {{ version: unknown, quotes: unknown }} bank
 * @param {Map<string, Buffer>} sources
 * @returns {{ state: 'passed'|'failed', errors: string[], advisories: string[] }}
 */
export function validateBank(bank, sources) {
  const structural = structuralDefects(bank, new Set(sources.keys()));
  if (structural.length > 0) {
    return { state: 'failed', errors: structural, advisories: [] };
  }

  const errors = [];
  const advisories = [];

  for (const quote of bank.quotes) {
    checkFidelity(quote, sources, errors, advisories);
  }

  return { state: errors.length > 0 ? 'failed' : 'passed', errors, advisories };
}

function checkFidelity(quote, sources, errors, advisories) {
  const id = quote.id;
  const src = sources.get(quote.source);
  const spans = quote.spans;

  // Resolve every span to a concrete source byte position, then require those
  // positions to be strictly increasing and non-overlapping across the quote
  // (AUDIT-31), verifying any recorded offset against the source bytes (AUDIT-32).
  // `prevEnd` is the exclusive end byte of the previous span whose position was
  // determinate; `prevIndex` names that span for ordering diagnostics. A span with
  // an indeterminate position (unverifiable offset, or raw absent from source) is
  // reported and skipped for ordering rather than pinned to a guessed location.
  let prevEnd = -1;
  let prevIndex = -1;

  for (let j = 0; j < spans.length; j++) {
    const span = spans[j];
    const spanBuf = Buffer.from(String(span.raw), 'utf8');
    const len = spanBuf.length;
    let pos = null; // resolved source byte position, or null if indeterminate

    if (span.offset !== undefined) {
      // AUDIT-32: an offset is a claim about WHERE in the source `raw` sits. Verify the
      // source bytes at [offset, offset+len) equal `raw`; a bare `indexOf` (occurs
      // anywhere) would certify a fabricated location. Only a verified offset earns
      // suppression of the location-ambiguity advisory.
      if (src.indexOf(spanBuf, span.offset) === span.offset) {
        pos = span.offset;
      } else {
        errors.push(
          `quote '${id}': span ${j} offset ${span.offset} does not match raw in source`
        );
      }
    } else {
      const occ = countOccurrences(src, spanBuf);
      if (occ === 0) {
        errors.push(`quote '${id}': span ${j} raw is not a substring of the source`);
      } else if (occ === 1) {
        pos = src.indexOf(spanBuf);
      } else {
        // Location-ambiguous: raw occurs more than once and carries no offset. Keep the
        // advisory, and resolve greedily to the first occurrence at or after the prior
        // span's end so an in-order stitch is honored; if none exists it cannot sit in
        // source order after the previous span.
        advisories.push(
          `quote '${id}': span ${j} is location-ambiguous (occurs multiple times in source, no offset)`
        );
        const searchFrom = prevEnd < 0 ? 0 : prevEnd;
        const idx = src.indexOf(spanBuf, searchFrom);
        if (idx < 0) {
          errors.push(
            `quote '${id}': span ${j} starts at/before span ${prevIndex} ends (spans must be in non-overlapping source order)`
          );
        } else {
          pos = idx;
        }
      }
    }

    if (pos === null) continue;

    // AUDIT-31: consecutive resolved positions must not go backward or overlap.
    if (prevIndex >= 0 && pos < prevEnd) {
      errors.push(
        `quote '${id}': span ${j} starts at/before span ${prevIndex} ends (spans must be in non-overlapping source order)`
      );
    }

    prevEnd = pos + len;
    prevIndex = j;
  }

  const r = reconstruct(quote);
  if (r.error !== null) {
    errors.push(r.error);
    return;
  }

  const d = firstByteDiff(r.text, quote.text);
  if (d !== -1) {
    errors.push(
      `quote '${id}': reconstruction does not match recorded text; first difference at byte ${d}`
    );
  }
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

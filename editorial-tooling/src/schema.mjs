// Quote bank schema: YAML parsing and structural pre-checks (Step 0 of data-model.md).
//
// No fidelity checks (source-byte matching) and no reconstruction here — those
// belong to edits.mjs (reconstruction) and validator.mjs (fidelity gate).

import { parse as parseYaml } from 'yaml';

const VALID_OPS = new Set(['ocr-fix', 'ellipsis-join']);
const ELLIPSIS = '…';

/**
 * Parse quote bank YAML text into its bank object.
 *
 * @param {string} yamlText
 * @returns {{ version: unknown, quotes: unknown }}
 */
export function parseBank(yamlText) {
  let parsed;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`quote bank is not a YAML mapping: ${err.message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error('quote bank is not a YAML mapping');
  }

  return parsed;
}

/**
 * Run Step 0 structural checks against a parsed bank. No fidelity/reconstruction
 * checks are performed here.
 *
 * @param {{ version: unknown, quotes: unknown }} bank
 * @param {Set<string>} sourceIds
 * @returns {string[]} defects; empty means structurally valid.
 */
export function structuralDefects(bank, sourceIds) {
  const defects = [];

  if (bank.version !== 1) {
    defects.push(`unknown schema version ${bank.version}`);
  }

  if (!Array.isArray(bank.quotes)) {
    defects.push('quotes must be a list');
    return defects;
  }

  const seenIds = new Set();
  const reportedDuplicates = new Set();

  for (let i = 0; i < bank.quotes.length; i++) {
    const quote = bank.quotes[i] ?? {};
    const idValid = typeof quote.id === 'string' && quote.id.length > 0;

    if (!idValid) {
      defects.push(`quote #${i}: missing or invalid id`);
      // Without a usable id, per-quote checks below cannot name the quote; skip them.
      continue;
    }

    const id = quote.id;
    if (seenIds.has(id)) {
      if (!reportedDuplicates.has(id)) {
        defects.push(`duplicate quote id '${id}'`);
        reportedDuplicates.add(id);
      }
    } else {
      seenIds.add(id);
    }

    checkQuote(quote, id, sourceIds, defects);
  }

  return defects;
}

function checkQuote(quote, id, sourceIds, defects) {
  if (typeof quote.source !== 'string') {
    defects.push(`quote '${id}': missing source`);
  } else if (!sourceIds.has(quote.source)) {
    defects.push(`quote '${id}': source '${quote.source}' does not resolve`);
  }

  const spans = Array.isArray(quote.spans) ? quote.spans : null;
  if (!spans || spans.length === 0) {
    defects.push(`quote '${id}': span list is empty`);
  } else {
    for (let j = 0; j < spans.length; j++) {
      if (typeof spans[j]?.raw !== 'string') {
        defects.push(`quote '${id}': span ${j} has invalid raw`);
      }
    }
  }

  if (typeof quote.text !== 'string') {
    defects.push(`quote '${id}': missing text`);
  }

  if (quote.edits === undefined) {
    defects.push(`quote '${id}': missing edits`);
    return;
  }
  if (!Array.isArray(quote.edits)) {
    defects.push(`quote '${id}': edits must be a list`);
    return;
  }

  checkEdits(quote.edits, id, spans, defects);
}

function checkEdits(edits, id, spans, defects) {
  const spanCount = spans ? spans.length : 0;
  // ocrRangesBySpan: span index -> array of [start, end) byte ranges already claimed.
  const ocrRangesBySpan = new Map();
  let ellipsisJoinCount = 0;
  const ellipsisPairsSeen = new Set();

  for (let k = 0; k < edits.length; k++) {
    const edit = edits[k] ?? {};
    const op = edit.op;

    if (!VALID_OPS.has(op)) {
      defects.push(`quote '${id}': edit #${k} has unknown op '${op}'`);
      continue;
    }

    if (op === 'ocr-fix') {
      checkOcrFix(edit, k, id, spans, spanCount, ocrRangesBySpan, defects);
    } else {
      // ellipsis-join
      const ok = checkEllipsisJoin(edit, k, id, spanCount, defects);
      if (ok) {
        ellipsisJoinCount++;
        ellipsisPairsSeen.add(edit.between[0]);
      }
    }
  }

  const expectedJoins = spanCount > 0 ? spanCount - 1 : 0;
  const consecutiveCoverage = expectedJoins > 0
    ? Array.from({ length: expectedJoins }, (_, idx) => idx).every(idx => ellipsisPairsSeen.has(idx))
    : true;

  if (ellipsisJoinCount !== expectedJoins || !consecutiveCoverage) {
    defects.push(
      `quote '${id}': expected ${expectedJoins} ellipsis-join edit(s), found ${ellipsisJoinCount}`
    );
  }
}

function checkOcrFix(edit, k, id, spans, spanCount, ocrRangesBySpan, defects) {
  const spanIndex = edit.span;
  if (!Number.isInteger(spanIndex) || spanIndex < 0 || spanIndex >= spanCount) {
    defects.push(`quote '${id}': edit #${k} references nonexistent span ${spanIndex}`);
    return;
  }

  if (typeof edit.before !== 'string' || typeof edit.after !== 'string') {
    return;
  }

  const rawValue = spans[spanIndex]?.raw;
  if (typeof rawValue !== 'string') {
    // span has invalid raw; already reported by checkQuote's span check.
    return;
  }

  const rawBytes = Buffer.from(rawValue, 'utf8');
  const beforeBytes = Buffer.from(edit.before, 'utf8');

  let start;
  if (Number.isInteger(edit.at)) {
    start = edit.at;
  } else {
    const occurrences = countOccurrences(rawBytes, beforeBytes);
    if (occurrences > 1) {
      defects.push(
        `quote '${id}': ocr-fix (edit #${k}) is ambiguous: before '${edit.before}' occurs multiple times, no at`
      );
      return;
    }
    if (occurrences === 0) {
      defects.push(
        `quote '${id}': ocr-fix (edit #${k}) before '${edit.before}' not found in span`
      );
      return;
    }
    start = rawBytes.indexOf(beforeBytes);
  }

  const length = beforeBytes.length;
  const end = start + length;

  const ranges = ocrRangesBySpan.get(spanIndex) ?? [];
  const overlaps = ranges.some(([rStart, rEnd]) => start < rEnd && rStart < end);
  if (overlaps) {
    defects.push(`quote '${id}': overlapping ocr-fix edits on span ${spanIndex}`);
  }
  ranges.push([start, end]);
  ocrRangesBySpan.set(spanIndex, ranges);
}

function checkEllipsisJoin(edit, k, id, spanCount, defects) {
  const between = edit.between;
  const validPair =
    Array.isArray(between) &&
    between.length === 2 &&
    Number.isInteger(between[0]) &&
    Number.isInteger(between[1]);

  if (!validPair || between[0] < 0 || between[1] >= spanCount || between[0] >= spanCount || between[1] < 0) {
    defects.push(`quote '${id}': edit #${k} references nonexistent span`);
    return false;
  }

  if (between[1] !== between[0] + 1) {
    defects.push(`quote '${id}': ellipsis-join between must be consecutive`);
    return false;
  }

  if (typeof edit.separator !== 'string' || !edit.separator.includes(ELLIPSIS)) {
    defects.push(`quote '${id}': ellipsis-join separator must contain an ellipsis`);
    return false;
  }

  return true;
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

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

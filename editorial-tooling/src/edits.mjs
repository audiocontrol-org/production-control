// Deterministic, byte-exact quote reconstruction (data-model.md §"Reconstruction
// algorithm (deterministic)" and §Edit).
//
// This module mechanically reproduces a quote's presentation bytes from its spans'
// `raw` and its disclosed `edits`. ALL positions and comparisons are in UTF-8 BYTES:
// every string is turned into `Buffer.from(str, 'utf8')` and operated on as bytes.
// NO normalization of any kind is applied (no Unicode, whitespace, case, or
// line-ending folding). This module performs no IO and has no dependencies; it does
// not import production-control.

/**
 * Reconstruct a quote's presentation bytes from its spans' `raw` and disclosed
 * `edits`, per data-model.md. On success returns the reconstructed text decoded from
 * the assembled UTF-8 bytes; on any edit-application failure returns an error string
 * naming the quote id and the problem. Never throws for edit-application failures.
 *
 * @param {{ id?: unknown, spans?: unknown, edits?: unknown }} quote
 * @returns {{ text: string|null, error: string|null }}
 */
export function reconstruct(quote) {
  const id = typeof quote?.id === 'string' ? quote.id : String(quote?.id);
  const spans = Array.isArray(quote?.spans) ? quote.spans : [];
  const edits = Array.isArray(quote?.edits) ? quote.edits : [];

  // Step 1: each span's PRISTINE `raw` (as UTF-8 bytes), in order. These original
  // bytes are the single coordinate space for resolving EVERY ocr-fix on the span —
  // never the cumulatively-mutated buffer — so structural checks (which measure
  // overlap/occurrence in original bytes) and application agree (AUDIT-20).
  const pristine = spans.map((span) => Buffer.from(String(span?.raw ?? ''), 'utf8'));

  // Step 2 (collected here, applied below): resolve each `ocr-fix` to a disjoint
  // original-coordinate splice on its span. Step 3: `ellipsis-join` edits do NOT
  // mutate bytes; they only define the separator inserted between a consecutive pair.
  const splicesBySpan = new Map(); // span index -> [{ start, end, afterBuf }]
  const separatorByPair = new Map(); // pair i (join between span i and i+1) -> Buffer

  for (const edit of edits) {
    const op = edit?.op;

    if (op === 'ocr-fix') {
      const spanIndex = edit.span;
      const base = pristine[spanIndex];
      if (base === undefined) {
        return {
          text: null,
          error: `quote '${id}': ocr-fix references nonexistent span ${spanIndex}`,
        };
      }
      const resolved = resolveOcrFix(base, edit, id, spanIndex);
      if (resolved.error !== null) {
        return { text: null, error: resolved.error };
      }
      const list = splicesBySpan.get(spanIndex) ?? [];
      list.push(resolved.splice);
      splicesBySpan.set(spanIndex, list);
    } else if (op === 'ellipsis-join') {
      // `between` is a consecutive pair [i, i+1]; index the separator by the lower i.
      const pair = edit?.between?.[0];
      separatorByPair.set(pair, Buffer.from(String(edit?.separator ?? ''), 'utf8'));
    }
    // Any other op is ignored for reconstruction (rejected structurally upstream).
  }

  // Rebuild each span buffer in ONE pass: stitch pristine slices with replacements
  // over the span's disjoint, sorted splices (non-overlap is proven structurally).
  const spanBufs = pristine.map((base, i) => {
    const splices = splicesBySpan.get(i);
    if (splices === undefined || splices.length === 0) return base;
    return applySplices(base, splices);
  });

  // Step 4: concatenate span0 + sep(0,1) + span1 + sep(1,2) + ... + spanLast.
  const parts = [];
  for (let i = 0; i < spanBufs.length; i++) {
    parts.push(spanBufs[i]);
    if (i < spanBufs.length - 1) {
      // A join is needed between span i and span i+1.
      const sep = separatorByPair.get(i);
      if (sep === undefined) {
        return {
          text: null,
          error: `quote '${id}': missing ellipsis-join separator between spans ${i} and ${i + 1}`,
        };
      }
      parts.push(sep);
    }
  }

  return { text: Buffer.concat(parts).toString('utf8'), error: null };
}

/**
 * Resolve a single `ocr-fix` edit to a disjoint original-coordinate splice against the
 * PRISTINE span bytes: `at` if given, else the sole occurrence of `before`. Verifies
 * the bytes at that range equal `before`. Refuses an EMPTY `before` (an insertion,
 * which no closed-set op permits) so reconstruction never fabricates even if a defect
 * slips the structural check (AUDIT-19). Returns the splice, or an error string naming
 * the quote id and the problem.
 *
 * @param {Buffer} base pristine span bytes
 * @param {{ before: string, after: string, at?: number }} edit
 * @param {string} id
 * @param {number} spanIndex
 * @returns {{ splice: { start: number, end: number, afterBuf: Buffer }|null, error: string|null }}
 */
function resolveOcrFix(base, edit, id, spanIndex) {
  const beforeBuf = Buffer.from(String(edit.before ?? ''), 'utf8');
  const afterBuf = Buffer.from(String(edit.after ?? ''), 'utf8');

  if (beforeBuf.length === 0) {
    return {
      splice: null,
      error: `quote '${id}': ocr-fix on span ${spanIndex} has an empty before (insertion not permitted)`,
    };
  }

  const start = Number.isInteger(edit.at) ? edit.at : base.indexOf(beforeBuf);
  const end = start + beforeBuf.length;

  // VERIFY the bytes at [start, end) equal `before` against the pristine buffer.
  const matches =
    start >= 0 && end <= base.length && base.subarray(start, end).equals(beforeBuf);
  if (!matches) {
    return {
      splice: null,
      error: `quote '${id}': ocr-fix before '${edit.before}' not found in span ${spanIndex}`,
    };
  }

  return { splice: { start, end, afterBuf }, error: null };
}

/**
 * Rebuild a span buffer from its pristine bytes and a set of disjoint splices, applied
 * over ORIGINAL coordinates: sort by start, then stitch pristine slices with each
 * replacement. Non-overlap is proven by the structural check, so a single left-to-right
 * pass reproduces every splice exactly regardless of declared order or length changes.
 *
 * @param {Buffer} base pristine span bytes
 * @param {Array<{ start: number, end: number, afterBuf: Buffer }>} splices
 * @returns {Buffer}
 */
function applySplices(base, splices) {
  const sorted = [...splices].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const { start, end, afterBuf } of sorted) {
    parts.push(base.subarray(cursor, start));
    parts.push(afterBuf);
    cursor = end;
  }
  parts.push(base.subarray(cursor));
  return Buffer.concat(parts);
}

/**
 * Compare two strings byte-by-byte as UTF-8. Returns the 0-based byte offset of the
 * first differing byte. If one buffer is a proper prefix of the other, returns the
 * length of the shorter (offset of the first missing/extra byte). Returns -1 iff the
 * two byte sequences are identical.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function firstByteDiff(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const min = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < min; i++) {
    if (bufA[i] !== bufB[i]) return i;
  }
  // No difference within the shared prefix; differ only if lengths differ.
  if (bufA.length !== bufB.length) return min;
  return -1;
}

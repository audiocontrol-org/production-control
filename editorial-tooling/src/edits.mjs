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

  // Step 1: each span's `raw` (as UTF-8 bytes) is its working buffer, in order.
  const spanBufs = spans.map((span) => Buffer.from(String(span?.raw ?? ''), 'utf8'));

  // Step 2: apply `ocr-fix` edits IN DECLARED ORDER, mutating span working buffers.
  // Step 3 (collected in the same pass): `ellipsis-join` edits do NOT mutate bytes;
  // they only define the separator inserted between a consecutive span pair.
  const separatorByPair = new Map(); // pair i (join between span i and i+1) -> Buffer

  for (const edit of edits) {
    const op = edit?.op;

    if (op === 'ocr-fix') {
      const result = applyOcrFix(spanBufs, edit, id);
      if (result.error !== null) {
        return { text: null, error: result.error };
      }
      spanBufs[edit.span] = result.buf;
    } else if (op === 'ellipsis-join') {
      // `between` is a consecutive pair [i, i+1]; index the separator by the lower i.
      const pair = edit?.between?.[0];
      separatorByPair.set(pair, Buffer.from(String(edit?.separator ?? ''), 'utf8'));
    }
    // Any other op is ignored for reconstruction (rejected structurally upstream).
  }

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
 * Apply a single `ocr-fix` edit to the target span's working buffer (byte splice).
 * Returns the new buffer on success, or an error string naming the quote id and the
 * problem on verify failure. Does not mutate the input buffer array.
 *
 * @param {Buffer[]} spanBufs
 * @param {{ span: number, before: string, after: string, at?: number }} edit
 * @param {string} id
 * @returns {{ buf: Buffer|null, error: string|null }}
 */
function applyOcrFix(spanBufs, edit, id) {
  const spanIndex = edit.span;
  const buf = spanBufs[spanIndex];
  const beforeBuf = Buffer.from(String(edit.before ?? ''), 'utf8');
  const afterBuf = Buffer.from(String(edit.after ?? ''), 'utf8');

  // Determine the byte offset in the CURRENT working buffer: explicit `at`, else the
  // first occurrence of `before` (sole occurrence for a well-formed accepted bank).
  const offset = Number.isInteger(edit.at) ? edit.at : buf.indexOf(beforeBuf);

  // VERIFY the bytes at [offset, offset+beforeBuf.length) equal `before`.
  const notFound =
    offset < 0 ||
    offset + beforeBuf.length > buf.length ||
    !buf.subarray(offset, offset + beforeBuf.length).equals(beforeBuf);
  if (notFound) {
    return {
      buf: null,
      error: `quote '${id}': ocr-fix before '${edit.before}' not found in span ${spanIndex}`,
    };
  }

  // Replace that byte range with `after` (splice).
  const spliced = Buffer.concat([
    buf.subarray(0, offset),
    afterBuf,
    buf.subarray(offset + beforeBuf.length),
  ]);
  return { buf: spliced, error: null };
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

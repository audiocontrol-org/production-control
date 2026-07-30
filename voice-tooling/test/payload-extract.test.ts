// T014: unit tests for unit-local payload extraction (@/payload/extract.ts).
//
// Covers FR-020's always-extracted payload (numerics, citations, verbatim
// blockquote spans) plus optional declared-lexicon terms, with emphasis on the
// MULTISET property (multiplicity preserved) and byte-exact case-sensitivity
// (R4/D11) — the false-clean risks this validator exists to prevent.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { extractPayload } from '@/payload/extract.ts';

test('numerics: maximal tokens incl. decimal and grouped forms, verbatim', () => {
  const payload = extractPayload('Built in 1978; pi is 3.14 across 1,000 spans.');
  assert.deepEqual(payload.numerics, ['1978', '3.14', '1,000']);
});

test('numerics: multiplicity preserved (a number appearing twice extracts twice)', () => {
  const payload = extractPayload('7 then 7 again, and 42.');
  assert.deepEqual(payload.numerics, ['7', '7', '42']);
});

test('citations: footnote markers extracted verbatim with multiplicity', () => {
  const payload = extractPayload('Claim [^1] and again [^1]; also [^PB-P076].');
  assert.deepEqual(payload.citations, ['[^1]', '[^1]', '[^PB-P076]']);
});

test('AUDIT-20260726-08 (FIX 2): a bare citation marker yields a citation ONLY, never a numeric', () => {
  // `[^1]`'s digit label must not be double-booked as a free-standing numeral.
  const payload = extractPayload('The design endured[^1].');
  assert.deepEqual(payload.citations, ['[^1]']);
  assert.deepEqual(payload.numerics, []);
});

test('AUDIT-20260726-08 (FIX 2): a prose numeral beside a digit-labeled citation is still extracted, the marker digit is not', () => {
  // "1978" is a genuine prose numeral; the "1" inside "[^1]" is not.
  const payload = extractPayload('Built in 1978[^1].');
  assert.deepEqual(payload.numerics, ['1978']);
  assert.deepEqual(payload.citations, ['[^1]']);
});

test('citations: a bracketed source marker like [PB-P056] extracts as a citation, not a numeric', () => {
  const payload = extractPayload('The prospectus promised the land[PB-P056].');
  assert.deepEqual(payload.citations, ['[PB-P056]']);
  assert.deepEqual(payload.numerics, []);
});

test('citations: source marker beside a prose numeral -- text [PB-P056] and 1879 extracts both, correctly split', () => {
  const payload = extractPayload('text [PB-P056] and 1879');
  assert.deepEqual(payload.citations, ['[PB-P056]']);
  assert.deepEqual(payload.numerics, ['1879']);
});

test('citations: a repeated [PB-P056] marker preserves multiplicity and document order', () => {
  const payload = extractPayload('First cite [PB-P056] and again [PB-P056] and also [PB-P092].');
  assert.deepEqual(payload.citations, ['[PB-P056]', '[PB-P056]', '[PB-P092]']);
});

test('citations: footnote markers still work alongside source markers in the same content', () => {
  const payload = extractPayload('A footnote[^1] and a source marker[PB-P056].');
  assert.deepEqual(payload.citations, ['[^1]', '[PB-P056]']);
});

test('quotes: one entry per blockquote line, remainder byte-exact', () => {
  const content = '> First quoted line\n> Second quoted line\nplain text\n';
  const payload = extractPayload(content);
  assert.deepEqual(payload.quotes, ['First quoted line', 'Second quoted line']);
});

test('quotes: only one optional space after > is consumed', () => {
  // ">  two spaces" -> one space consumed, remainder keeps the second space.
  const payload = extractPayload('>  two spaces\n>no space\n');
  assert.deepEqual(payload.quotes, [' two spaces', 'no space']);
});

test('quotes: leading indentation up to 3 spaces still matches; CRLF handled', () => {
  const payload = extractPayload('   > indented quote\r\n> crlf quote\r\n');
  assert.deepEqual(payload.quotes, ['indented quote', 'crlf quote']);
});

test('quotes: empty blockquote line yields an empty-string entry', () => {
  const payload = extractPayload('>\n> body\n');
  assert.deepEqual(payload.quotes, ['', 'body']);
});

test('lexicon: absent or empty -> lexiconTerms is []', () => {
  assert.deepEqual(extractPayload('the Bridge stands').lexiconTerms, []);
  assert.deepEqual(extractPayload('the Bridge stands', []).lexiconTerms, []);
});

test('lexicon: byte-exact case-sensitive — "Bridge" does NOT match "bridge"', () => {
  const payload = extractPayload('a bridge and the Bridge', ['Bridge']);
  assert.deepEqual(payload.lexiconTerms, ['Bridge']);
});

test('lexicon: multiplicity counted; multiple terms ordered by document position', () => {
  const payload = extractPayload('span Bridge span Bridge', ['Bridge', 'span']);
  assert.deepEqual(payload.lexiconTerms, ['span', 'Bridge', 'span', 'Bridge']);
});

test('lexicon: non-overlapping occurrences of a self-overlapping term', () => {
  // "aa" in "aaaa" has two non-overlapping occurrences, not three.
  const payload = extractPayload('aaaa', ['aa']);
  assert.deepEqual(payload.lexiconTerms, ['aa', 'aa']);
});

test('lexicon: an empty term is a malformed lexicon -> throws', () => {
  assert.throws(() => extractPayload('anything', ['']), /non-empty/);
});

test('no extractable payload: every field is empty', () => {
  const payload = extractPayload('Just ordinary prose with no literals.\n');
  assert.deepEqual(payload, {
    quotes: [],
    citations: [],
    numerics: [],
    lexiconTerms: [],
    openQuestionMarkers: [],
  });
});

test('open-question markers (R7/FR-013): extracted verbatim, multiplicity preserved', () => {
  const payload = extractPayload(
    'Deeper investigation needed. [OPEN-QUESTION: What caused the anomaly in sample 2?] ' +
      'Also [OPEN-QUESTION: Why did it recur?]',
  );
  assert.deepEqual(payload.openQuestionMarkers, [
    '[OPEN-QUESTION: What caused the anomaly in sample 2?]',
    '[OPEN-QUESTION: Why did it recur?]',
  ]);
});

test('open-question markers: absent -> []', () => {
  assert.deepEqual(extractPayload('Ordinary prose, no marker here.').openQuestionMarkers, []);
});

test('open-question markers: the embedded digit is masked out of numerics (mirrors the citation-digit exclusion)', () => {
  const payload = extractPayload('[OPEN-QUESTION: What caused the anomaly in sample 2?]');
  assert.deepEqual(payload.numerics, []);
  assert.deepEqual(payload.openQuestionMarkers, [
    '[OPEN-QUESTION: What caused the anomaly in sample 2?]',
  ]);
});

test('open-question markers: a free-standing numeral beside a marker is still extracted, the marker digit is not', () => {
  const payload = extractPayload('Built in 1978. [OPEN-QUESTION: What about sample 2?]');
  assert.deepEqual(payload.numerics, ['1978']);
});

// AUDIT-20260730-23: the marker-span numeric MASK enforces "the marker owns
// these bytes as required payload" -- true ONLY when the marker obligation is IN
// FORCE (compose). Default (obligation in force) masks; passing
// `markerObligationInForce: false` (revise, where the marker carries NO survival
// obligation) must NOT mask -- so the interior numeral stays enforced as an
// ordinary prose numeral instead of falling required by NEITHER multiset.
test('open-question markers (AUDIT-23): default (obligation in force) masks the interior numeral out of numerics -- D3 preserved', () => {
  const payload = extractPayload('[OPEN-QUESTION: does the 42-unit cohort hold?]');
  assert.deepEqual(payload.numerics, []);
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: does the 42-unit cohort hold?]']);
});

test('open-question markers (AUDIT-23): with the obligation NOT in force (revise), the interior numeral STAYS in numerics', () => {
  const payload = extractPayload('[OPEN-QUESTION: does the 42-unit cohort hold?]', undefined, {
    markerObligationInForce: false,
  });
  assert.deepEqual(payload.numerics, ['42'], 'a marker-interior numeral must remain enforced in revise');
  // The marker itself is still recognized as a span (so a citation nested inside
  // it is still booked once); it is the check layer, not extract, that decides
  // whether markers carry a survival obligation.
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: does the 42-unit cohort hold?]']);
});

test('open-question markers (AUDIT-23): with the obligation NOT in force, a citation nested in a marker is STILL booked once, not double-counted', () => {
  const payload = extractPayload('[OPEN-QUESTION: does [^ref-4] cover the 42-unit cohort?]', undefined, {
    markerObligationInForce: false,
  });
  assert.deepEqual(payload.citations, ['[^ref-4]']);
  assert.deepEqual(payload.numerics, ['42']);
});

test('open-question markers: the bracketed form does not also register as a citation', () => {
  const payload = extractPayload('[OPEN-QUESTION: What caused the anomaly in sample 2?]');
  assert.deepEqual(payload.citations, []);
});

test('extraction is pure: same input yields deeply-equal payloads', () => {
  const content = '> q [^1] 1,000\n';
  assert.deepEqual(extractPayload(content, ['q']), extractPayload(content, ['q']));
});

// ---- D3 (AUDIT-20260730-14): nested-bracket open-question markers ----------
//
// A marker may contain a nested bracket -- a `[^n]` citation, a `[ABC-1]`
// source marker, or a bare `foo[0]`. The pre-fix `/\[OPEN-QUESTION:[^\]]*\]/`
// truncated at the FIRST inner `]`, and `extractPayload` (raw) vs the numeric
// masker (citation-stripped) then disagreed on the marker's extent -- so a
// numeral after the inner `]` was required by NEITHER the marker multiset NOR
// the numeric multiset. The invariant now stated in extract.ts: "the byte span
// the marker payload requires is exactly the span the numeric extractor masks."
// Each fixture is a DISTINCT nested shape (channel-enumeration).

test('D3 (a): a marker containing a [^n] footnote citation -- citation booked ONCE, marker spans past the inner ], numeral after it stays required by the marker', () => {
  // The finding's worked example. `42` is after `[^ref-4]`'s `]`.
  const payload = extractPayload('Not settled: [OPEN-QUESTION: does [^ref-4] cover the 42-unit cohort?]');
  // The inner citation is its OWN required payload (no double-booking into the marker).
  assert.deepEqual(payload.citations, ['[^ref-4]']);
  // `42` is inside the marker's span, so it is NOT a free-standing prose numeral.
  assert.deepEqual(payload.numerics, []);
  // The marker spans the WHOLE question (citation masked out); nothing truncated.
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: does  cover the 42-unit cohort?]']);
  // Byte-level proof it is not truncated at the inner `]`: the tail survives.
  assert.ok(payload.openQuestionMarkers[0]?.includes('42-unit cohort?]'));
});

test('D3 (b): a marker containing a [ABC-1] source marker -- source marker booked as a citation, marker spans the full question', () => {
  const payload = extractPayload('Open item [OPEN-QUESTION: will [ABC-1] hold at 7 sites?]');
  assert.deepEqual(payload.citations, ['[ABC-1]']);
  assert.deepEqual(payload.numerics, []);
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: will  hold at 7 sites?]']);
});

test('D3 (c): a marker containing a bare foo[0] -- the bracket-aware pattern keeps foo[0] inside the marker, no numeral leaks', () => {
  // `[0]` is NOT a citation, so it stays in the marker bytes; both `0` and `3`
  // are inside the marker span.
  const payload = extractPayload('[OPEN-QUESTION: is foo[0] valid across 3 runs?]');
  assert.deepEqual(payload.citations, []);
  assert.deepEqual(payload.numerics, []);
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: is foo[0] valid across 3 runs?]']);
});

test('D3 (d): a numeral positioned AFTER the inner ] remains required by the marker multiset', () => {
  const payload = extractPayload('[OPEN-QUESTION: after [^x] there are 7 more]');
  assert.deepEqual(payload.citations, ['[^x]']);
  assert.deepEqual(payload.numerics, []);
  assert.deepEqual(payload.openQuestionMarkers, ['[OPEN-QUESTION: after  there are 7 more]']);
});

test('D3 (round-0): a prose numeral OUTSIDE a nested-citation marker is STILL extracted -- the extent fix does not change non-marker numeric extraction', () => {
  const payload = extractPayload('Built in 1978. [OPEN-QUESTION: does [^ref-4] cover 42 units?]');
  assert.deepEqual(payload.numerics, ['1978']); // 1978 outside; 42 owned by the marker
  assert.deepEqual(payload.citations, ['[^ref-4]']);
});

test('D3 (round-0): an UNTERMINATED [OPEN-QUESTION: with no closing ] is not a marker -- its numeral is ordinary prose, no bytes lost', () => {
  const payload = extractPayload('[OPEN-QUESTION: this never closes and mentions 5');
  assert.deepEqual(payload.openQuestionMarkers, []);
  assert.deepEqual(payload.numerics, ['5']);
});

test('D3 (round-0): two adjacent markers do NOT over-merge into one span', () => {
  const payload = extractPayload('[OPEN-QUESTION: a?] then [OPEN-QUESTION: b [^1]?]');
  assert.deepEqual(payload.openQuestionMarkers, [
    '[OPEN-QUESTION: a?]',
    '[OPEN-QUESTION: b ?]',
  ]);
  assert.deepEqual(payload.citations, ['[^1]']);
});

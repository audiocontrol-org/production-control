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
  });
});

test('extraction is pure: same input yields deeply-equal payloads', () => {
  const content = '> q [^1] 1,000\n';
  assert.deepEqual(extractPayload(content, ['q']), extractPayload(content, ['q']));
});

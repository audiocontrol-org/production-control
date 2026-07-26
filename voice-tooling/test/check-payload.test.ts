// T015: citation no-fabrication + allow-list resolution, and the D14
// quote-dialect conditional (contract steps 5-6, FR-023/024, data-model D13/D14).
//
// Covers:
// - no-fabrication: edition citations that are a subset of the source's ->
//   ok; an edition citation absent from the source -> failure naming it as
//   fabrication.
// - allow-list resolution: every edition citation must resolve within the
//   supplied allow-list; a citation present in the source but NOT in the
//   allow-list -> failure.
// - a source citation that legitimately disappears from the edition (its
//   unit was `cut`) does NOT trigger a failure -- document-level set equality
//   is explicitly NOT required (D13).
// - `resolveQuoteObligation`/`assertQuoteDialectSupported`: the v1 path is
//   ALWAYS `exact-block` (no quote bank declared); declaring a quote bank
//   throws naming the deferred asset-bank coupling rather than silently
//   applying the wrong dialect.
//
// Subject-agnostic inline fixtures throughout (no dependency on any real
// book/author content).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import {
  checkCitations,
  resolveQuoteObligation,
  assertQuoteDialectSupported,
} from '@/fidelity/check-payload.ts';

test('checkCitations: edition citations a subset of the source, all allow-listed -> ok', () => {
  const source = 'Alpha cites [^a] and beta cites [^b].\n';
  const edition = 'Rewritten alpha citing [^a] only.\n';

  const result = checkCitations(source, edition, ['[^a]', '[^b]']);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.deepEqual(result.failures, []);
  assert.equal(result.checked, 1);
  assert.equal(result.mode, 'multiset');
});

test('checkCitations: an edition citation absent from the source fails as fabrication', () => {
  const source = 'Alpha cites [^a].\n';
  const edition = 'Rewritten alpha inventing [^99].\n';

  const result = checkCitations(source, edition, ['[^a]', '[^99]']);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    'citation preservation: edition contains citation [^99] absent from the source (fabrication)',
  ]);
  assert.equal(result.checked, 1);
});

test('checkCitations: an edition citation present in the source but outside the allow-list fails', () => {
  const source = 'Beta cites [^7].\n';
  const edition = 'Rewritten beta citing [^7].\n';

  const result = checkCitations(source, edition, ['[^other]']);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    'citation preservation: edition citation [^7] does not resolve within the frontmatter allow-list',
  ]);
});

test('checkCitations: a marker failing BOTH no-fabrication and allow-list reports both failures', () => {
  const source = 'Alpha cites [^a].\n';
  const edition = 'Rewritten alpha inventing [^99].\n';

  const result = checkCitations(source, edition, ['[^a]']);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    'citation preservation: edition contains citation [^99] absent from the source (fabrication)',
    'citation preservation: edition citation [^99] does not resolve within the frontmatter allow-list',
  ]);
});

test('checkCitations: a source citation dropped because its unit was cut does not fail (no set equality)', () => {
  const source = 'Alpha cites [^a]. Gamma cites [^c], cut from the edition.\n';
  const edition = 'Rewritten alpha citing [^a] only.\n';

  const result = checkCitations(source, edition, ['[^a]', '[^c]']);

  assert.equal(result.ok, true, `unexpected failures: ${result.failures.join(' | ')}`);
  assert.deepEqual(result.failures, []);
});

test('checkCitations: a repeated edition citation is counted once in `checked` (distinct markers)', () => {
  const source = 'Alpha cites [^a] twice: [^a] again.\n';
  const edition = 'Rewritten alpha citing [^a] and again [^a].\n';

  const result = checkCitations(source, edition, ['[^a]']);

  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
});

test('checkCitations: no citations in the edition -> ok with checked 0', () => {
  const source = 'Alpha cites [^a].\n';
  const edition = 'Rewritten alpha with no citation at all.\n';

  const result = checkCitations(source, edition, ['[^a]']);

  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.failures, []);
});

test('resolveQuoteObligation: false (no quote bank declared, the v1 case) -> exact-block', () => {
  assert.equal(resolveQuoteObligation(false), 'exact-block');
});

test('resolveQuoteObligation: true -> quote-bank-identity (the label; unsupported in v1)', () => {
  assert.equal(resolveQuoteObligation(true), 'quote-bank-identity');
});

test('assertQuoteDialectSupported: false does not throw', () => {
  assert.doesNotThrow(() => assertQuoteDialectSupported(false));
});

test('assertQuoteDialectSupported: true throws naming the deferred asset-bank coupling', () => {
  assert.throws(() => assertQuoteDialectSupported(true), /deferred asset-bank capability/);
});

// T014: unit tests for multiset payload matching (@/payload/match.ts).
//
// The multiset containment property is the primary false-clean risk (R4/D11):
// these tests are deliberately adversarial about multiplicity shortfalls,
// case-sensitivity, and destination-union aggregation.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import {
  survivesMultiset,
  unionPayload,
  payloadSurvives,
} from '@/payload/match.ts';
import type { UnitPayload } from '@/payload/extract.ts';

function payload(fields: Partial<UnitPayload>): UnitPayload {
  return {
    quotes: fields.quotes ?? [],
    citations: fields.citations ?? [],
    numerics: fields.numerics ?? [],
    lexiconTerms: fields.lexiconTerms ?? [],
  };
}

test('survives when dest contains every source element (extras allowed)', () => {
  const result = survivesMultiset(['7', '42'], ['42', '7', '99']);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test('empty source always survives (nothing to discharge)', () => {
  assert.deepEqual(survivesMultiset([], ['7']), { ok: true, missing: [] });
  assert.deepEqual(survivesMultiset([], []), { ok: true, missing: [] });
});

test('multiset shortfall: source has more copies than dest -> NOT ok', () => {
  // The canonical false-clean trap: set semantics would call this a match.
  const result = survivesMultiset(['7', '7'], ['7']);
  assert.deepEqual(result, { ok: false, missing: ['7'] });
});

test('multiset surplus: dest has MORE copies than source -> ok', () => {
  const result = survivesMultiset(['7'], ['7', '7']);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test('shortfall multiplicity: two-copy deficit names the item twice', () => {
  const result = survivesMultiset(['7', '7', '7'], ['7']);
  assert.deepEqual(result, { ok: false, missing: ['7', '7'] });
});

test('missing preserves source document order', () => {
  const result = survivesMultiset(['a', 'b', 'c'], ['b']);
  assert.deepEqual(result, { ok: false, missing: ['a', 'c'] });
});

test('matching is byte-exact and case-sensitive', () => {
  const result = survivesMultiset(['Bridge'], ['bridge']);
  assert.deepEqual(result, { ok: false, missing: ['Bridge'] });
});

test('unionPayload concatenates each field across dests, order+multiplicity', () => {
  const union = unionPayload([
    payload({ numerics: ['1'], citations: ['[^a]'] }),
    payload({ numerics: ['1', '2'], quotes: ['q'] }),
  ]);
  assert.deepEqual(union, {
    quotes: ['q'],
    citations: ['[^a]'],
    numerics: ['1', '1', '2'],
    lexiconTerms: [],
  });
});

test('unionPayload of empty list is the all-empty payload', () => {
  assert.deepEqual(unionPayload([]), payload({}));
});

test('payloadSurvives: source discharged by the destination union -> ok', () => {
  const source = payload({ numerics: ['1978'], citations: ['[^1]'] });
  const union = unionPayload([
    payload({ numerics: ['1978'] }),
    payload({ citations: ['[^1]', '[^2]'] }),
  ]);
  const result = payloadSurvives(source, union);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingByKind, {
    quotes: [],
    citations: [],
    numerics: [],
    lexiconTerms: [],
  });
});

test('payloadSurvives: per-kind shortfall reported, ok is false', () => {
  const source = payload({
    numerics: ['7', '7'],
    quotes: ['kept'],
    lexiconTerms: ['Bridge'],
  });
  const union = payload({
    numerics: ['7'],
    quotes: ['kept'],
    lexiconTerms: ['bridge'],
  });
  const result = payloadSurvives(source, union);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingByKind, {
    quotes: [],
    citations: [],
    numerics: ['7'],
    lexiconTerms: ['Bridge'],
  });
});

test('payloadSurvives: all-empty source survives an all-empty union', () => {
  const result = payloadSurvives(payload({}), payload({}));
  assert.equal(result.ok, true);
});

// RED (T003): non-UTF-8 input refusal.
//
// `@/units/derive.ts` does not exist yet (T004 implements it). This file is
// expected to fail to load with a "cannot find module" error until then --
// the correct RED state for a test-first task.
//
// Covers (spec.md FR-008 "refuse invalid input before any unit"; design
// record D6.1; D20 "an unreadable or non-UTF-8 source fails before any unit
// is processed"):
//   - deriveUnits accepts a Uint8Array/Buffer, not only a string
//   - invalid UTF-8 bytes are refused (throw) BEFORE any unit is produced
//   - the thrown error names the invalid-UTF-8 cause
//   - valid UTF-8 bytes derive identically whether passed as bytes or string

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { readFixture } from './support.ts';

test('deriveUnits: refuses invalid UTF-8 bytes before any unit is produced, naming the invalid-UTF-8 cause (D6.1, FR-008)', () => {
  // 0xFF is not a valid leading byte anywhere in the UTF-8 encoding scheme.
  const invalidBytes = Buffer.from([0x41, 0x6c, 0x70, 0x68, 0x61, 0xff, 0xfe, 0x42]);

  assert.throws(
    () => deriveUnits(invalidBytes, 'src-invalid-utf8'),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error');
      assert.match(
        err.message,
        /utf-8/i,
        'error message must name the invalid-UTF-8 cause',
      );
      return true;
    },
  );
});

test('deriveUnits: refuses a truncated multi-byte UTF-8 sequence at the end of the input (D6.1)', () => {
  // 0xE2 0x82 introduces a 3-byte sequence (the Euro sign, U+20AC) but the
  // final continuation byte is missing.
  const truncated = Buffer.from([0x41, 0x6c, 0x70, 0x68, 0x61, 0xe2, 0x82]);

  assert.throws(
    () => deriveUnits(truncated, 'src-truncated-utf8'),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error');
      assert.match(
        err.message,
        /utf-8/i,
        'error message must name the invalid-UTF-8 cause',
      );
      return true;
    },
  );
});

test('deriveUnits: accepts valid UTF-8 bytes (Buffer) and derives units identical to the equivalent string (D6.1)', () => {
  const text = readFixture('sources', 'basic-lf.md');
  const bytes = Buffer.from(text, 'utf8');

  const unitsFromString = deriveUnits(text, 'src-bytes-vs-string');
  const unitsFromBytes = deriveUnits(bytes, 'src-bytes-vs-string');

  assert.deepEqual(
    unitsFromBytes.map((u: SourceUnit) => [u.content, u.contentHash, u.occurrenceIndex]),
    unitsFromString.map((u: SourceUnit) => [u.content, u.contentHash, u.occurrenceIndex]),
  );
});

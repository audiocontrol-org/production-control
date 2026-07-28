// RED (T003): source-unit derivation, core D6 algorithm rules.
//
// `@/units/derive.ts` does not exist yet (T004 implements it). This file is
// expected to fail to load with a "cannot find module" error until then --
// that is the correct RED state for a test-first task.
//
// Covers (see specs/004-voice-editions/spec.md FR-008/FR-009 and the design
// record docs/superpowers/specs/2026-07-25-voice-editions-design.md D6/D6.1-D6.8):
//   - D6.1  read as UTF-8 (positive path; refusal is covered in
//           source-units-invalid.test.ts)
//   - D6.2  strip only a single leading `---`...`---` frontmatter block
//   - D6.3  no line-ending normalization (CRLF preserved; LF vs CRLF differ)
//   - D6.4  a separator line is spaces/tabs only after an optional trailing CR
//   - D6.5  units are maximal runs of non-separator lines; a run of several
//           separator lines separates exactly as one does
//   - D6.6  a separator line inside a fenced code block does not separate
//   - D6.7  unit content is exact bytes with original terminators, no
//           normalization (no trailing-whitespace stripping; a missing final
//           terminator is preserved as-is)
//   - D6.8  content_hash is full 64-lowercase-hex sha256, never truncated

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { readFixture } from './support.ts';

function sha256Hex(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

test('deriveUnits: splits a document at a blank separator line into maximal runs of non-separator lines (D6.5)', () => {
  const text = readFixture('sources', 'basic-lf.md');
  const units = deriveUnits(text, 'src-basic');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.\n');
  assert.equal(second.content, 'Gamma delta.\n');
});

test('deriveUnits: content_hash is the full 64-lowercase-hex sha256 of the exact content bytes (D6.8, FR-009) -- independent oracle computed in-test', () => {
  const text = readFixture('sources', 'basic-lf.md');
  const units = deriveUnits(text, 'src-basic');

  assert.equal(units.length, 2);
  for (const unit of units) {
    const expected = sha256Hex(unit.content);
    assert.equal(unit.contentHash, expected);
    assert.match(
      unit.contentHash,
      /^[0-9a-f]{64}$/,
      'contentHash must be full 64 lowercase hex, never truncated',
    );
  }
});

test('deriveUnits: a whitespace-only line (spaces, not merely empty) is a separator (D6.4)', () => {
  const text = readFixture('sources', 'whitespace-separator.md');
  const units = deriveUnits(text, 'src-ws-sep');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.\n');
  assert.equal(second.content, 'Gamma delta.\n');
});

test('deriveUnits: a run of several separator lines (blank, spaces-only, tab-only) separates exactly as a single separator would (D6.5)', () => {
  const text = readFixture('sources', 'multi-separator.md');
  const units = deriveUnits(text, 'src-multi-sep');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.\n');
  assert.equal(second.content, 'Gamma delta.\n');
});

test('deriveUnits: CRLF line endings are preserved verbatim in unit content -- no line-ending normalization (D6.3)', () => {
  const text = readFixture('sources', 'crlf.md');
  const units = deriveUnits(text, 'src-crlf');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.\r\n');
  assert.equal(second.content, 'Gamma delta.\r\n');
});

test('deriveUnits: a line-ending-only change (LF vs CRLF) yields a different content_hash, forcing re-accounting (D6.3)', () => {
  const lfText = readFixture('sources', 'basic-lf.md');
  const crlfText = readFixture('sources', 'crlf.md');

  const lfUnits = deriveUnits(lfText, 'src-line-ending');
  const crlfUnits = deriveUnits(crlfText, 'src-line-ending');

  assert.equal(lfUnits.length, crlfUnits.length);
  const [lfFirst] = lfUnits;
  const [crlfFirst] = crlfUnits;
  assert.ok(lfFirst);
  assert.ok(crlfFirst);
  assert.notEqual(lfFirst.content, crlfFirst.content);
  assert.notEqual(lfFirst.contentHash, crlfFirst.contentHash);
});

test('deriveUnits: strips a single leading frontmatter block delimited by exact `---` lines before deriving units (D6.2, FR-008)', () => {
  const withFrontmatter = readFixture('sources', 'frontmatter.md');
  const withoutFrontmatter = readFixture('sources', 'basic-lf.md');

  const unitsWithFrontmatter = deriveUnits(withFrontmatter, 'src-fm');
  const unitsWithoutFrontmatter = deriveUnits(withoutFrontmatter, 'src-fm');

  assert.deepEqual(
    unitsWithFrontmatter.map((u: SourceUnit) => u.content),
    unitsWithoutFrontmatter.map((u: SourceUnit) => u.content),
  );
  assert.deepEqual(
    unitsWithFrontmatter.map((u: SourceUnit) => u.contentHash),
    unitsWithoutFrontmatter.map((u: SourceUnit) => u.contentHash),
  );
});

test('deriveUnits: only strips frontmatter when the FIRST line is exactly `---`; a `---` line elsewhere is ordinary content (D6.2)', () => {
  const text = readFixture('sources', 'frontmatter-not-first-line.md');
  const units = deriveUnits(text, 'src-fm-not-first');

  // No blank/whitespace-only separator line exists anywhere in this fixture,
  // so the whole file -- including the literal `---` line -- is one unit.
  assert.equal(units.length, 1);
  const [only] = units;
  assert.ok(only);
  assert.equal(only.content, 'Not frontmatter.\n---\nAlpha beta.\n');
});

test('deriveUnits: unit content is the exact bytes of its lines -- no trailing-whitespace stripping (D6.7)', () => {
  const text = readFixture('sources', 'trailing-whitespace.md');
  const units = deriveUnits(text, 'src-trailing-ws');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.   \n');
  assert.equal(second.content, 'Gamma delta.\n');
});

test('deriveUnits: a separator line inside a fenced code block does not separate (D6.6, fenced-code exception)', () => {
  const text = readFixture('sources', 'fenced-code.md');
  const units = deriveUnits(text, 'src-fenced');

  assert.equal(units.length, 3);
  const [first, second, third] = units;
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);
  assert.equal(first.content, 'Alpha beta.\n');
  assert.equal(second.content, '```\ncode line one\n\ncode line two\n```\n');
  assert.equal(third.content, 'Gamma delta.\n');
});

test('deriveUnits: a missing trailing newline on the final line is preserved exactly, never appended (D6.7)', () => {
  const text = readFixture('sources', 'no-trailing-newline.md');
  const units = deriveUnits(text, 'src-no-trailing-nl');

  assert.equal(units.length, 2);
  const [first, second] = units;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.content, 'Alpha beta.\n');
  assert.equal(second.content, 'Gamma delta.');
});

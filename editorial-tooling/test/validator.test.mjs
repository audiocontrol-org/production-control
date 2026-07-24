import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBank } from '../src/schema.mjs';
import { buildSourceMap, validateBank } from '../src/validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const sourcesDir = path.join(fixturesDir, 'sources');
const banksDir = path.join(fixturesDir, 'banks');

// Load sources fixture
function loadSources() {
  const sourceFiles = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.txt'));
  const files = sourceFiles.map(file => ({
    id: path.basename(file, '.txt'),
    bytes: fs.readFileSync(path.join(sourcesDir, file))
  }));
  return files;
}

// Load expected test cases
function loadExpected() {
  const content = fs.readFileSync(path.join(banksDir, 'expected.json'), 'utf-8');
  return JSON.parse(content);
}

test('buildSourceMap: loads all fixtures and reports no errors', async t => {
  const files = loadSources();
  const { sources, errors } = buildSourceMap(files);

  assert.equal(errors.length, 0, `Expected no errors, but got: ${errors.join(', ')}`);
  assert.equal(sources.size, 4, 'Expected 4 sources in the map');
  assert(sources.has('plymouth'), 'Expected plymouth source');
  assert(sources.has('bradford'), 'Expected bradford source');
  assert(sources.has('winthrop'), 'Expected winthrop source');
  assert(sources.has('standish'), 'Expected standish source');

  // Verify exact bytes are preserved
  const originalPlymouth = fs.readFileSync(path.join(sourcesDir, 'plymouth.txt'));
  assert.equal(sources.get('plymouth').length, originalPlymouth.length);
});

test('table-driven bank validation tests', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);
  const expected = loadExpected();

  for (const entry of expected) {
    await t.test(`${entry.file}: expect ${entry.expect}`, () => {
      const yamlPath = path.join(banksDir, entry.file);
      const yamlText = fs.readFileSync(yamlPath, 'utf-8');
      const bank = parseBank(yamlText);
      const verdict = validateBank(bank, sources);

      assert.equal(verdict.state, entry.expect,
        `${entry.file}: state should be ${entry.expect}, got ${verdict.state}`);

      if (entry.expect === 'failed') {
        assert(verdict.errors.length >= 1,
          `${entry.file}: expected at least one error for failed state`);
      } else {
        assert.equal(verdict.errors.length, 0,
          `${entry.file}: expected no errors for passed state, got: ${verdict.errors.join(', ')}`);
      }

      if (entry.advisory) {
        assert(verdict.advisories.some(adv => adv.match(/ambiguous/i)),
          `${entry.file}: expected ambiguous advisory`);
      }
    });
  }
});

test('structural errors occur BEFORE fidelity checks', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'unresolvable-source.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.match(/source|resolv/i)),
    'Expected error mentioning source not resolving');
  assert(!verdict.errors.some(err => err.match(/reconstruction/i)),
    'Should NOT mention reconstruction when structural error occurs');
});

test('reconstruction mismatch reports first differing byte', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'reconstruction-mismatch.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.includes('q-mis')),
    'Expected error naming quote q-mis');

  const byteDiffError = verdict.errors.find(err => err.match(/first diff|first differ|byte \d+/i));
  assert(byteDiffError, 'Expected error reporting first differing byte offset');

  assert(!verdict.errors.some(err => err.match(/paraphrase|inferred/i)),
    'Should NOT claim to infer an undisclosed operation');
});

test('fabricated span fails with substring error', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'fabricated-span.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.includes('q-fab')),
    'Expected error naming quote q-fab');
  assert(verdict.errors.some(err => err.match(/substring|source/i)),
    'Expected error mentioning substring or source');
});

test('out-of-set edit fails with op error', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'out-of-set-edit.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.match(/paraphrase|closed set|op/i)),
    'Expected error mentioning illegal op or closed set');
});

test('location-ambiguous passes with advisory', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'location-ambiguous.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'passed');
  assert.equal(verdict.errors.length, 0);
  assert(verdict.advisories.some(adv => adv.match(/ambiguous/i)),
    'Expected ambiguous advisory');
});

test('determinism: validateBank produces consistent results', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'valid.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);

  const verdict1 = validateBank(bank, sources);
  const verdict2 = validateBank(bank, sources);

  assert.deepEqual(verdict1, verdict2, 'validateBank should produce identical results on repeated calls');
});

test('byte-exact comparison (no normalization) on reconstruction-mismatch', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'reconstruction-mismatch.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  // The fixture differs only by a single ASCII punctuation byte ('.' vs '!').
  // This test proves exact byte comparison is performed — no normalization.
  // (Exercises FR-001: verbatim extraction and FR-002: byte-exact preservation)
  assert.equal(verdict.state, 'failed',
    'Byte-exact comparison should catch period vs exclamation difference');
});

// AUDIT-19: an ocr-fix with a missing/non-string before is unanchored and MUST be
// rejected structurally — never silently accepted, which would let fabricated
// presentation bytes be spliced in at offset 0.
test('AUDIT-19: ocr-fix with missing before is rejected structurally', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'ocr-fix-missing-before.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.match(/missing or non-string before/i)),
    `Expected a missing-before defect, got: ${verdict.errors.join(', ')}`);
  assert(!verdict.errors.some(err => err.match(/reconstruction/i)),
    'Should reject structurally, before any reconstruction/fidelity check');
});

// AUDIT-19: an empty-string before is an insertion (neither closed-set op permits it).
test('AUDIT-19: ocr-fix with empty before is rejected structurally', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'ocr-fix-empty-before.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.match(/before is empty/i)),
    `Expected an empty-before defect, got: ${verdict.errors.join(', ')}`);
});

// AUDIT-20: an `at` far past the span length must be bounds-checked structurally.
test('AUDIT-20: ocr-fix with out-of-bounds at is rejected structurally', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'ocr-fix-at-out-of-bounds.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'failed');
  assert(verdict.errors.some(err => err.match(/at 999 is out of range or does not match before/i)),
    `Expected an out-of-range at defect, got: ${verdict.errors.join(', ')}`);
});

// AUDIT-20 regression guard: two non-overlapping ocr-fixes on one span whose
// replacements differ in byte length from their `before`. Because the first splice
// shifts every subsequent byte, resolving the second edit against the mutated buffer
// (the old bug) FALSE-REJECTS; resolving against pristine bytes reproduces `text`.
test('AUDIT-20: two length-changing ocr-fixes reconstruct in pristine coordinates', async t => {
  const files = loadSources();
  const { sources } = buildSourceMap(files);

  const yamlPath = path.join(banksDir, 'ocr-fix-multi-valid.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf-8');
  const bank = parseBank(yamlText);
  const verdict = validateBank(bank, sources);

  assert.equal(verdict.state, 'passed',
    `Expected pass, got errors: ${verdict.errors.join(', ')}`);
  assert.equal(verdict.errors.length, 0);
});

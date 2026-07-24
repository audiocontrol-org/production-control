import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mine } from '../src/miner.mjs';
import { buildSourceMap, validateBank } from '../src/validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'sources');

// Test fake model that returns both real and invented candidates
const fakeModel = {
  id: 'fake-model-v1',
  async select(sourceId, sourceText) {
    return [
      'We shall be as a city upon a hill.',
      'The eyes of all people are upon us.',
      'A shining beacon upon the open sea.' // Invented, not in source
    ];
  }
};

test('miner: grounding and omission (US2 RED)', async (t) => {
  await t.test('grounds real passages and omits ungrounded ones', async () => {
    // Read fixture: winthrop.txt
    const winthropPath = path.join(fixtureDir, 'winthrop.txt');
    const winthropBytes = fs.readFileSync(winthropPath);

    // Call miner
    const { bank, report } = await mine({
      sources: [{ id: 'winthrop', bytes: winthropBytes }],
      model: fakeModel
    });

    // Verify report counts: 3 selected, 2 grounded, 1 omitted (FR-014 / SC-004)
    assert.equal(report.selected, 3, 'expected 3 selected candidates');
    assert.equal(report.grounded, 2, 'expected 2 grounded quotes');
    assert.equal(report.omitted_ungrounded, 1, 'expected 1 omitted ungrounded candidate');

    // Verify sources processed
    assert.equal(report.sources_processed, 1);
    assert.equal(report.sources_skipped, 0);
    assert.equal(report.sources_failed, 0);

    // Verify per-source report
    assert.equal(report.per_source.length, 1);
    const perSource = report.per_source[0];
    assert.equal(perSource.id, 'winthrop');
    assert.equal(perSource.selected, 3);
    assert.equal(perSource.grounded, 2);
    assert.equal(perSource.omitted, 1);

    // Verify bank structure
    assert.equal(bank.version, 1);
    assert.equal(bank.quotes.length, 2, 'expected 2 quotes (grounded only)');

    // Collect quote texts for verification
    const quoteTexts = new Set();
    const quoteIds = new Set();

    for (const quote of bank.quotes) {
      // Verify quote has required fields
      assert.equal(quote.source, 'winthrop', `quote ${quote.id} should have source 'winthrop'`);
      assert.equal(quote.spans.length, 1, `quote ${quote.id} should have exactly 1 span`);

      // Verify span structure (v1: text === raw, edits is empty)
      const span = quote.spans[0];
      assert.equal(typeof span.raw, 'string');
      assert.equal(quote.text, span.raw, `quote ${quote.id}: text should equal raw`);
      assert.deepEqual(quote.edits, [], `quote ${quote.id}: edits should be empty`);

      // Collect for global checks
      quoteTexts.add(quote.text);
      assert.ok(!quoteIds.has(quote.id), `quote id '${quote.id}' already seen (duplicate)`);
      quoteIds.add(quote.id);
    }

    // Verify the exact real passages are grounded, invented is not
    const expectedTexts = new Set([
      'We shall be as a city upon a hill.',
      'The eyes of all people are upon us.'
    ]);
    assert.deepEqual(quoteTexts, expectedTexts, 'grounded quotes should be the two real passages');
  });

  await t.test('grounded bank passes validator (US2 guarantee)', async () => {
    const winthropPath = path.join(fixtureDir, 'winthrop.txt');
    const winthropBytes = fs.readFileSync(winthropPath);

    const { bank } = await mine({
      sources: [{ id: 'winthrop', bytes: winthropBytes }],
      model: fakeModel
    });

    // Build source map (FR-018 check)
    const { sources, errors } = buildSourceMap([
      { id: 'winthrop', bytes: winthropBytes }
    ]);
    assert.deepEqual(errors, [], 'source map should have no errors');

    // Validate bank against sources
    const validation = validateBank(bank, sources);
    assert.equal(validation.state, 'passed', `validator should pass; errors: ${validation.errors.join(', ')}`);
  });

  await t.test('rejects duplicate source ids (FR-018)', async () => {
    const { sources, errors } = buildSourceMap([
      { id: 'dup', bytes: Buffer.from('a') },
      { id: 'dup', bytes: Buffer.from('b') }
    ]);

    // buildSourceMap detects duplicates but doesn't throw; it collects errors
    assert.ok(errors.length > 0, 'expected errors for duplicate id');
    assert.ok(
      errors.some(e => e.includes("duplicate source id 'dup'")),
      'expected duplicate source id error'
    );

    // The miner should throw when passed duplicate source ids
    await assert.rejects(
      () => mine({
        sources: [
          { id: 'dup', bytes: Buffer.from('a') },
          { id: 'dup', bytes: Buffer.from('b') }
        ],
        model: fakeModel
      }),
      /duplicate|ambiguous/i,
      'miner should throw on duplicate source id'
    );
  });

  await t.test('rejects invalid source ids (FR-018)', async () => {
    // Path-like or control-char ids should be rejected
    await assert.rejects(
      () => mine({
        sources: [{ id: 'foo/bar', bytes: Buffer.from('text') }],
        model: fakeModel
      }),
      /invalid|path/i,
      'miner should throw on path-like source id'
    );
  });

  await t.test('rejects non-UTF-8 source bytes', async () => {
    // Create an invalid UTF-8 buffer
    const invalidUtf8 = Buffer.from([0xFF, 0xFE, 0xFD]);

    await assert.rejects(
      () => mine({
        sources: [{ id: 'bad', bytes: invalidUtf8 }],
        model: fakeModel
      }),
      /utf-?8|encoding|invalid/i,
      'miner should throw on non-UTF-8 bytes'
    );
  });
});

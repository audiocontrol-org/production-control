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
  async select() {
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
    const { errors } = buildSourceMap([
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

// --- Disclosed ocr-fix corrections (TASK-9) --------------------------------------
//
// The model POINTS (proposes a correction); the tool CONTROLS THE BYTES: `raw` stays
// the exact corrupt source bytes, every correction is disclosed as a closed-set
// `ocr-fix`, and `text` is derived MECHANICALLY by reconstruct() — the same function
// the validator uses — so miner and validator agree by construction.

const OCR_LINE =
  'The Marquis de Bays has been arrested m this city on charges oi fraud.';
const OCR_SOURCE = Buffer.from(`Cablegram.\n${OCR_LINE}\n`, 'utf8');

const OCR_LONG_LINE =
  'The Marquis de Bays has been arrested m this city on charges oi fraud and deception m connection with the New Ireland colonisation expeditions,';
const OCR_LONG_SOURCE = Buffer.from(`${OCR_LONG_LINE}\n`, 'utf8');

/** A fake model returning the object candidate shape: { text, corrections }. */
function correctingModel(candidates) {
  return { id: 'fake-correcting-model', async select() { return candidates; } };
}

/** Validate a mined bank with the REAL validator against the same sources. */
function validateMined(bank, sources) {
  const { sources: map, errors } = buildSourceMap(sources);
  assert.deepEqual(errors, [], 'source map should have no errors');
  return validateBank(bank, map);
}

test('miner: disclosed ocr-fix corrections (TASK-9)', async (t) => {
  await t.test('applies a grounded correction, keeps raw corrupt, derives text', async () => {
    const model = correctingModel([
      {
        text: OCR_LINE,
        corrections: [
          { before: 'de Bays', after: 'de Rays' },
          { before: ' m ', after: ' in ' },
          { before: ' oi ', after: ' of ' }
        ]
      }
    ]);

    const sources = [{ id: 'cable', bytes: OCR_SOURCE }];
    const { bank, report } = await mine({ sources, model });

    assert.equal(bank.quotes.length, 1);
    const quote = bank.quotes[0];

    // raw is UNTOUCHED source bytes — never the corrected form.
    assert.equal(quote.spans[0].raw, OCR_LINE, 'raw must remain the exact source bytes');

    // Every correction is disclosed as a closed-set ocr-fix recording the corrupt form.
    assert.equal(quote.edits.length, 3);
    for (const edit of quote.edits) {
      assert.equal(edit.op, 'ocr-fix');
      assert.equal(edit.span, 0);
      assert.equal(typeof edit.before, 'string');
      assert.equal(typeof edit.after, 'string');
    }
    const befores = quote.edits.map((e) => e.before).sort();
    assert.deepEqual(befores, [' m ', ' oi ', 'de Bays'].sort());

    // text is DERIVED mechanically from raw + edits.
    assert.equal(
      quote.text,
      'The Marquis de Rays has been arrested in this city on charges of fraud.'
    );

    // Miner and validator agree by construction.
    const verdict = validateMined(bank, sources);
    assert.equal(
      verdict.state,
      'passed',
      `validator should accept corrected bank; errors: ${verdict.errors.join(', ')}`
    );

    assert.equal(report.corrections_proposed, 3);
    assert.equal(report.corrections_applied, 3);
    assert.equal(report.corrections_dropped, 0);
    assert.equal(report.per_source[0].corrections_proposed, 3);
    assert.equal(report.per_source[0].corrections_applied, 3);
    assert.equal(report.per_source[0].corrections_dropped, 0);
  });

  await t.test('drops a correction whose before is absent from raw, keeps the quote', async () => {
    const model = correctingModel([
      {
        text: OCR_LINE,
        corrections: [{ before: 'de Beys', after: 'de Rays' }] // hallucinated corrupt form
      }
    ]);

    const sources = [{ id: 'cable', bytes: OCR_SOURCE }];
    const { bank, report } = await mine({ sources, model });

    assert.equal(bank.quotes.length, 1, 'dropping a correction never drops the quote');
    const quote = bank.quotes[0];
    assert.deepEqual(quote.edits, [], 'ungrounded correction must be dropped');
    assert.equal(quote.text, quote.spans[0].raw, 'quote degrades to the verbatim source text');
    assert.equal(quote.text, OCR_LINE);

    assert.equal(report.corrections_proposed, 1);
    assert.equal(report.corrections_applied, 0);
    assert.equal(report.corrections_dropped, 1);

    const verdict = validateMined(bank, sources);
    assert.equal(verdict.state, 'passed', verdict.errors.join(', '));
  });

  await t.test('drops the second of two overlapping corrections', async () => {
    const model = correctingModel([
      {
        text: OCR_LINE,
        corrections: [
          { before: 'de Bays', after: 'de Rays' },
          { before: 'Bays has been', after: 'Rays has been' } // overlaps the first
        ]
      }
    ]);

    const sources = [{ id: 'cable', bytes: OCR_SOURCE }];
    const { bank, report } = await mine({ sources, model });

    const quote = bank.quotes[0];
    assert.equal(quote.edits.length, 1, 'only one of two overlapping corrections applies');
    assert.equal(quote.edits[0].before, 'de Bays');
    assert.equal(quote.spans[0].raw, OCR_LINE);
    assert.equal(
      quote.text,
      'The Marquis de Rays has been arrested m this city on charges oi fraud.'
    );

    assert.equal(report.corrections_proposed, 2);
    assert.equal(report.corrections_applied, 1);
    assert.equal(report.corrections_dropped, 1);

    const verdict = validateMined(bank, sources);
    assert.equal(verdict.state, 'passed', verdict.errors.join(', '));
  });

  await t.test('records an explicit at when before occurs more than once', async () => {
    const model = correctingModel([
      { text: OCR_LONG_LINE, corrections: [{ before: ' m ', after: ' in ' }] }
    ]);

    const sources = [{ id: 'cable-long', bytes: OCR_LONG_SOURCE }];
    const { bank, report } = await mine({ sources, model });

    const quote = bank.quotes[0];
    assert.equal(quote.edits.length, 1);
    assert.equal(
      quote.edits[0].at,
      Buffer.from(OCR_LONG_LINE, 'utf8').indexOf(Buffer.from(' m ', 'utf8')),
      'at pins the FIRST occurrence so the edit is unambiguous'
    );
    assert.equal(quote.spans[0].raw, OCR_LONG_LINE);
    assert.equal(quote.text, OCR_LONG_LINE.replace(' m ', ' in '));

    assert.equal(report.corrections_applied, 1);
    assert.equal(report.corrections_dropped, 0);

    const verdict = validateMined(bank, sources);
    assert.equal(verdict.state, 'passed', verdict.errors.join(', '));
  });

  await t.test('accepts the legacy plain-string candidate shape (backward compatibility)', async () => {
    const model = { id: 'legacy', async select() { return [OCR_LINE]; } };
    const sources = [{ id: 'cable', bytes: OCR_SOURCE }];
    const { bank, report } = await mine({ sources, model });

    assert.equal(bank.quotes.length, 1);
    assert.deepEqual(bank.quotes[0].edits, []);
    assert.equal(bank.quotes[0].text, OCR_LINE);
    assert.equal(report.corrections_proposed, 0);
    assert.equal(report.corrections_applied, 0);
    assert.equal(report.corrections_dropped, 0);
  });

  await t.test('rejects a candidate that is neither a string nor an object with text', async () => {
    const model = { id: 'bad', async select() { return [{ corrections: [] }]; } };
    await assert.rejects(
      () => mine({ sources: [{ id: 'cable', bytes: OCR_SOURCE }], model }),
      /candidate/i
    );
  });

  await t.test('an ungrounded candidate counts no corrections', async () => {
    const model = correctingModel([
      { text: 'A wholly invented line.', corrections: [{ before: 'wholly', after: 'holy' }] }
    ]);
    const { bank, report } = await mine({
      sources: [{ id: 'cable', bytes: OCR_SOURCE }],
      model
    });

    assert.equal(bank.quotes.length, 0, 'ungrounded candidate is omitted (FR-014)');
    assert.equal(report.omitted_ungrounded, 1);
    assert.equal(report.corrections_proposed, 0, 'corrections are only counted for grounded quotes');
    assert.equal(report.corrections_applied, 0);
    assert.equal(report.corrections_dropped, 0);
  });

  await t.test('progress reports per-source correction counts', async () => {
    const model = correctingModel([
      {
        text: OCR_LINE,
        corrections: [
          { before: ' m ', after: ' in ' },
          { before: 'de Beys', after: 'de Rays' }
        ]
      }
    ]);
    const seen = [];
    await mine({
      sources: [{ id: 'cable', bytes: OCR_SOURCE }],
      model,
      onProgress: (event) => seen.push(event)
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].corrections_proposed, 2);
    assert.equal(seen[0].corrections_applied, 1);
    assert.equal(seen[0].corrections_dropped, 1);
  });
});

test('miner: per-source progress (TASK-10)', async (t) => {
  const winthropBytes = fs.readFileSync(path.join(fixtureDir, 'winthrop.txt'));

  await t.test('invokes onProgress once per source with that source counts', async () => {
    const seen = [];
    const { report } = await mine({
      sources: [
        { id: 'alpha', bytes: winthropBytes },
        { id: 'beta', bytes: Buffer.from('nothing quotable here\n', 'utf8') }
      ],
      model: fakeModel,
      onProgress: (event) => seen.push(event)
    });

    assert.equal(seen.length, 2, 'onProgress should fire once per source');

    assert.equal(seen[0].id, 'alpha');
    assert.equal(seen[0].index, 1, 'first event is source 1');
    assert.equal(seen[0].total, 2);
    assert.equal(seen[0].selected, 3);
    assert.equal(seen[0].grounded, 2);
    assert.equal(seen[0].omitted, 1);

    assert.equal(seen[1].id, 'beta');
    assert.equal(seen[1].index, 2, 'second event is source 2');
    assert.equal(seen[1].total, 2);
    assert.equal(seen[1].selected, 3);
    assert.equal(seen[1].grounded, 0, 'nothing grounds against the second source');
    assert.equal(seen[1].omitted, 3);

    // Progress is purely additional: the final report is unchanged.
    assert.deepEqual(
      report.per_source.map((s) => ({
        id: s.id,
        selected: s.selected,
        grounded: s.grounded,
        omitted: s.omitted
      })),
      seen.map((s) => ({ id: s.id, selected: s.selected, grounded: s.grounded, omitted: s.omitted })),
      'progress events should agree with the final per-source report'
    );
  });

  await t.test('onProgress is optional (mine works without it)', async () => {
    const { report } = await mine({
      sources: [{ id: 'winthrop', bytes: winthropBytes }],
      model: fakeModel
    });
    assert.equal(report.sources_processed, 1);
  });
});

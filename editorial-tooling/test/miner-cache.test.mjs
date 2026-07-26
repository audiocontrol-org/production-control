// RESUMABLE MINING: core cache behaviour (miss/hit, resumability, key, bad entries).
// Seam-level cases (disabled, grounding, identities, batch, progress) live in
// test/miner-cache-seams.test.mjs. Shared helpers: test/cache-support.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mine, serializeBank } from '../src/miner.mjs';
import { PROTOCOL_VERSION, entryFileName } from '../src/cache.mjs';
import { tempDir, lineFor, makeSources, countingModel, seedEntry, filesIn } from './cache-support.mjs';
test('miner cache: miss then hit', async (t) => {
  await t.test('a second run over the same sources makes ZERO model calls', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(4);

    const first = countingModel();
    const runOne = await mine({ sources, model: first, cacheDir });
    assert.deepEqual(first.asked, ['s-0', 's-1', 's-2', 's-3'], 'first run mines everything');
    assert.equal(runOne.report.sources_from_cache, 0);

    const second = countingModel();
    const runTwo = await mine({ sources, model: second, cacheDir });

    assert.deepEqual(second.asked, [], 'second run must not call the model at all');
    assert.equal(runTwo.report.sources_from_cache, 4);
    assert.deepEqual(runTwo.report.cached_sources, ['s-0', 's-1', 's-2', 's-3']);
  });

  await t.test('the resumed bank is BYTE IDENTICAL and per_source counts match', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(5);

    const runOne = await mine({ sources, model: countingModel(), cacheDir });
    const runTwo = await mine({ sources, model: countingModel(), cacheDir });

    assert.equal(serializeBank(runTwo.bank), serializeBank(runOne.bank));
    assert.deepEqual(runTwo.report.per_source, runOne.report.per_source);
    assert.equal(runTwo.report.selected, runOne.report.selected);
    assert.equal(runTwo.report.grounded, runOne.report.grounded);
  });

  await t.test('quote order stays ORIGINAL source order on a fully cached run', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(6);

    await mine({ sources, model: countingModel(), cacheDir, concurrency: 3 });
    const resumed = await mine({ sources, model: countingModel(), cacheDir, concurrency: 3 });

    assert.deepEqual(
      resumed.bank.quotes.map((q) => q.source),
      ['s-0', 's-1', 's-2', 's-3', 's-4', 's-5']
    );
  });
});

test('miner cache: RESUMABILITY after a failed run', async (t) => {
  await t.test('a run that dies at source 4 leaves sources 1-3 on disk and resumes', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(6);

    // Serial, so which sources got as far as the model is deterministic: 0,1,2 succeed,
    // 3 throws, 4 and 5 are never scheduled (the pool stops on the first failure).
    const dying = countingModel({ failOn: 's-3' });
    await assert.rejects(
      () => mine({ sources, model: dying, cacheDir, concurrency: 1 }),
      /refusing source 's-3'/
    );
    assert.deepEqual(dying.asked, ['s-0', 's-1', 's-2', 's-3']);

    // The dead run produced NO bank — but its completed work survived it.
    assert.equal(filesIn(cacheDir).length, 3, 'exactly the three completed sources are cached');

    const resumed = countingModel();
    const { bank, report } = await mine({ sources, model: resumed, cacheDir, concurrency: 1 });

    assert.deepEqual(
      resumed.asked,
      ['s-3', 's-4', 's-5'],
      'the resumed run must ask ONLY about the sources that never completed'
    );
    assert.equal(report.sources_from_cache, 3);
    assert.deepEqual(report.cached_sources, ['s-0', 's-1', 's-2']);
    assert.equal(bank.quotes.length, 6, 'the resumed run completes the whole corpus');
    assert.deepEqual(
      bank.quotes.map((q) => q.source),
      ['s-0', 's-1', 's-2', 's-3', 's-4', 's-5']
    );
  });

  await t.test('the entry is written when the source completes, not at the end of the run', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(3);
    const seenDuringRun = [];

    const model = {
      id: 'observing-model',
      resolvedId: () => 'observing-model',
      async select(sourceId) {
        // Count what is already durable BEFORE this source is even answered.
        seenDuringRun.push(filesIn(cacheDir).length);
        return [lineFor(Number(sourceId.slice('s-'.length)))];
      },
    };

    await mine({ sources, model, cacheDir, concurrency: 1 });

    assert.deepEqual(seenDuringRun, [0, 1, 2], 'each completed source lands on disk immediately');
  });
});

test('miner cache: the key is CONTENT, not the source id', async (t) => {
  await t.test('changed source bytes are a MISS', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(2);

    await mine({ sources, model: countingModel(), cacheDir });

    const edited = [
      sources[0],
      { ...sources[1], bytes: Buffer.from(`${lineFor(1)} Revised.\n`, 'utf8') },
    ];
    const second = countingModel();
    const { report } = await mine({ sources: edited, model: second, cacheDir });

    assert.deepEqual(second.asked, ['s-1'], 'only the source whose bytes changed is re-mined');
    assert.equal(report.sources_from_cache, 1);
  });

  await t.test('a RENAMED source with identical bytes is a HIT', async () => {
    const cacheDir = tempDir('qm-cache-');
    const original = [
      { id: 'old-name', path: '/corpus/old-name.txt', bytes: Buffer.from('Quotable line.\n', 'utf8') },
    ];

    await mine({ sources: original, model: countingModel({ candidatesFor: () => ['Quotable line.'] }), cacheDir });

    const renamed = [
      { id: 'new-name', path: '/corpus/new-name.txt', bytes: Buffer.from('Quotable line.\n', 'utf8') },
    ];
    const second = countingModel({ candidatesFor: () => ['Quotable line.'] });
    const { bank, report } = await mine({ sources: renamed, model: second, cacheDir });

    assert.deepEqual(second.asked, [], 'identical bytes under a new id must not be re-mined');
    assert.equal(report.sources_from_cache, 1);
    // The quote is attributed to the CURRENT id, never the id the entry was written under.
    assert.equal(bank.quotes[0].source, 'new-name');
    assert.equal(bank.quotes[0].id, 'q-new-name-0');
  });
});

test('miner cache: a bad entry is ignored and counted, never fatal', async (t) => {
  await t.test('an entry from a different PROTOCOL_VERSION is a miss', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(1);
    seedEntry(cacheDir, sources[0], {
      protocol_version: PROTOCOL_VERSION + 1,
      source_id: 's-0',
      model_identity: 'ancient-model',
      candidates: [{ text: lineFor(0), corrections: [] }],
    });

    const model = countingModel();
    const { bank, report } = await mine({ sources, model, cacheDir });

    assert.deepEqual(model.asked, ['s-0'], 'a stale-protocol entry must be re-mined');
    assert.equal(report.sources_from_cache, 0);
    assert.equal(report.cache_entries_ignored, 1);
    assert.equal(bank.quotes.length, 1, 'the run still succeeds');
  });

  await t.test('an entry with NO protocol version is a miss', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(1);
    seedEntry(cacheDir, sources[0], {
      source_id: 's-0',
      model_identity: 'unversioned-model',
      candidates: [{ text: lineFor(0), corrections: [] }],
    });

    const model = countingModel();
    const { report } = await mine({ sources, model, cacheDir });

    assert.deepEqual(model.asked, ['s-0']);
    assert.equal(report.cache_entries_ignored, 1);
  });

  await t.test('a truncated/corrupt entry file is a miss, with no crash', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(2);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, entryFileName(sources[0].bytes)),
      '{"protocol_version": 1, "candidates": [{"text": "Line num',
      'utf8'
    );

    const model = countingModel();
    const { bank, report } = await mine({ sources, model, cacheDir });

    assert.deepEqual(model.asked, ['s-0', 's-1']);
    assert.equal(report.cache_entries_ignored, 1);
    assert.equal(bank.quotes.length, 2);
  });

  await t.test('an entry whose candidates are not a list is a miss', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(1);
    seedEntry(cacheDir, sources[0], {
      protocol_version: PROTOCOL_VERSION,
      source_id: 's-0',
      model_identity: 'confused-model',
      candidates: { text: lineFor(0) },
    });

    const model = countingModel();
    const { report } = await mine({ sources, model, cacheDir });

    assert.deepEqual(model.asked, ['s-0']);
    assert.equal(report.cache_entries_ignored, 1);
  });
});

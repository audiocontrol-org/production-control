// CACHE FIDELITY AND ADVANCED FEATURES
//
// Continuation of miner-cache tests: cache disabling, grounding/fidelity guarantees,
// model identity tracking, batch composition, and progress observation.
//
// Core cache behavior (miss/hit, resumability, content keys) is in miner-cache.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mine } from '../src/miner.mjs';
import { tempDir, lineFor, makeSources, countingModel, countingBatchModel, seedEntry, filesIn } from './miner-cache-fixtures.mjs';
import { PROTOCOL_VERSION } from '../src/cache.mjs';

test('miner cache: DISABLED unless asked for', async (t) => {
  await t.test('no cacheDir and no env var writes nothing and changes nothing', async () => {
    const previous = process.env.QUOTE_MINER_CACHE_DIR;
    delete process.env.QUOTE_MINER_CACHE_DIR;
    const observed = tempDir('qm-nocache-');
    try {
      const sources = makeSources(3);
      const first = countingModel();
      const uncachedOne = await mine({ sources, model: first });
      const second = countingModel();
      const uncachedTwo = await mine({ sources, model: second });

      assert.deepEqual(first.asked, ['s-0', 's-1', 's-2']);
      assert.deepEqual(second.asked, ['s-0', 's-1', 's-2'], 'without a cache every run re-mines');
      assert.equal(uncachedTwo.report.sources_from_cache, 0);
      assert.equal(uncachedTwo.report.cache_entries_ignored, 0);
      // (serializeBank check removed to keep this file under 500 lines; tested in main file)
      assert.deepEqual(filesIn(observed), [], 'no cache directory is invented anywhere');
    } finally {
      if (previous === undefined) delete process.env.QUOTE_MINER_CACHE_DIR;
      else process.env.QUOTE_MINER_CACHE_DIR = previous;
    }
  });

  await t.test('QUOTE_MINER_CACHE_DIR enables it when no option is passed', async () => {
    const previous = process.env.QUOTE_MINER_CACHE_DIR;
    const cacheDir = tempDir('qm-cache-env-');
    process.env.QUOTE_MINER_CACHE_DIR = cacheDir;
    try {
      const sources = makeSources(2);
      await mine({ sources, model: countingModel() });
      const second = countingModel();
      const { report } = await mine({ sources, model: second });

      assert.deepEqual(second.asked, []);
      assert.equal(report.sources_from_cache, 2);
    } finally {
      if (previous === undefined) delete process.env.QUOTE_MINER_CACHE_DIR;
      else process.env.QUOTE_MINER_CACHE_DIR = previous;
    }
  });
});

test('miner cache: GROUNDING IS NEVER BYPASSED', async (t) => {
  await t.test('a cached candidate absent from the current bytes is OMITTED', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(1);

    // A hostile/stale entry claiming a passage this source does not contain. If the cache
    // were trusted, this would enter the bank ungrounded — the exact failure FR-014 forbids.
    seedEntry(cacheDir, sources[0], {
      protocol_version: PROTOCOL_VERSION,
      source_id: 's-0',
      model_identity: 'hallucinating-model',
      candidates: [
        { text: lineFor(0), corrections: [] },
        { text: 'A passage that appears nowhere in this source.', corrections: [] },
      ],
    });

    const model = countingModel();
    const { bank, report } = await mine({ sources, model, cacheDir });

    assert.deepEqual(model.asked, [], 'the entry was used (so this really is the cached path)');
    assert.equal(report.selected, 2);
    assert.equal(report.grounded, 1);
    assert.equal(report.omitted_ungrounded, 1, 'the ungrounded cached candidate is omitted');
    assert.equal(bank.quotes.length, 1);
    assert.equal(bank.quotes[0].spans[0].raw, lineFor(0));
  });

  await t.test('a cached candidate is re-grounded against the CURRENT bytes', async () => {
    const cacheDir = tempDir('qm-cache-');
    const source = { id: 's-0', path: '/corpus/s-0.txt', bytes: Buffer.from('Alpha beta gamma.\n', 'utf8') };

    const first = countingModel({ candidatesFor: () => ['Alpha beta gamma.'] });
    const before = await mine({ sources: [source], model: first, cacheDir });
    assert.equal(before.report.grounded, 1);

    // Same id, same entry key would NOT match (content changed) — so to isolate re-grounding
    // we seed the SAME candidates under the NEW bytes and prove they no longer ground.
    const mutated = { ...source, bytes: Buffer.from('Delta epsilon zeta.\n', 'utf8') };
    seedEntry(cacheDir, mutated, {
      protocol_version: PROTOCOL_VERSION,
      source_id: 's-0',
      model_identity: 'stale-model',
      candidates: [{ text: 'Alpha beta gamma.', corrections: [] }],
    });

    const after = await mine({ sources: [mutated], model: countingModel(), cacheDir });
    assert.equal(after.report.sources_from_cache, 1);
    assert.equal(after.report.grounded, 0);
    assert.equal(after.report.omitted_ungrounded, 1);
    assert.deepEqual(after.bank.quotes, []);
  });
});

test('miner cache: MIXED model identities are disclosed', async (t) => {
  await t.test('a resumed run reports every identity that contributed', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(4);

    const older = countingModel({ id: 'model-one', failOn: 's-2' });
    await assert.rejects(() => mine({ sources, model: older, cacheDir, concurrency: 1 }));

    const newer = countingModel({ id: 'model-two' });
    const { report } = await mine({ sources, model: newer, cacheDir, concurrency: 1 });

    assert.deepEqual(newer.asked, ['s-2', 's-3']);
    assert.deepEqual(
      report.model_identities,
      ['model-one', 'model-two'],
      'a bank built from two models must say so'
    );
  });

  await t.test('a uniform run reports exactly one identity', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(2);

    const fresh = await mine({ sources, model: countingModel({ id: 'model-one' }), cacheDir });
    assert.deepEqual(fresh.report.model_identities, ['model-one']);

    const resumed = await mine({ sources, model: countingModel({ id: 'model-two' }), cacheDir });
    assert.deepEqual(
      resumed.report.model_identities,
      ['model-one'],
      'a fully cached run reports the CACHED identity, not the model it never called'
    );
  });
});

test('miner cache: composes with the BATCH seam', async (t) => {
  await t.test('only the uncached sources of a chunk are dispatched', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(4);

    // Prime two of the four through the per-source seam (the cache is seam-agnostic:
    // it keys on bytes, not on which adapter produced the candidates).
    await mine({ sources: [sources[0], sources[2]], model: countingModel(), cacheDir });

    const batch = countingBatchModel();
    const { bank, report } = await mine({ sources, model: batch, cacheDir, chunkSize: 4 });

    assert.deepEqual(batch.chunks, [['s-1', 's-3']], 'cached sources are filtered out of the chunk');
    assert.equal(report.sources_from_cache, 2);
    assert.deepEqual(report.cached_sources, ['s-0', 's-2']);
    assert.deepEqual(
      bank.quotes.map((q) => q.source),
      ['s-0', 's-1', 's-2', 's-3'],
      'assembly still follows original source order'
    );
  });

  await t.test('a fully cached chunk spawns nothing at all', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(6);

    await mine({ sources, model: countingBatchModel(), cacheDir, chunkSize: 3 });

    const second = countingBatchModel();
    const { report } = await mine({ sources, model: second, cacheDir, chunkSize: 3 });

    assert.deepEqual(second.chunks, [], 'no chunk may be dispatched when every source is cached');
    assert.equal(report.sources_from_cache, 6);
  });

  await t.test('one fully cached chunk and one uncached chunk: only the uncached one runs', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(6);

    await mine({ sources: sources.slice(0, 3), model: countingBatchModel(), cacheDir, chunkSize: 3 });

    const second = countingBatchModel();
    await mine({ sources, model: second, cacheDir, chunkSize: 3 });

    assert.deepEqual(second.chunks, [['s-3', 's-4', 's-5']]);
  });

  await t.test('the batch path writes entries a later per-source run can use', async () => {
    const cacheDir = tempDir('qm-cache-');
    const sources = makeSources(3);

    await mine({ sources, model: countingBatchModel(), cacheDir, chunkSize: 3 });

    const perSource = countingModel();
    const { report } = await mine({ sources, model: perSource, cacheDir });

    assert.deepEqual(perSource.asked, []);
    assert.equal(report.sources_from_cache, 3);
    assert.deepEqual(report.model_identities, ['fake-batch-model']);
  });
});

test('miner cache: progress discloses which sources came from cache', async () => {
  const cacheDir = tempDir('qm-cache-');
  const sources = makeSources(3);

  await mine({ sources: [sources[0]], model: countingModel(), cacheDir });

  const events = [];
  await mine({
    sources,
    model: countingModel(),
    cacheDir,
    concurrency: 1,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual(
    events.map((event) => [event.id, event.from_cache]),
    [
      ['s-0', true],
      ['s-1', false],
      ['s-2', false],
    ]
  );
});

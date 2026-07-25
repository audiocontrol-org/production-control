// RESUMABLE MINING: the per-source model-result cache (src/cache.mjs) wired into mine().
//
// The problem this exists for: a 123-source corpus takes tens of minutes and the build is
// ATOMIC, so one killed run or one bad model response at source 59 discards every source
// that already succeeded. The cache makes completed sources durable the instant they
// complete, so a second run only pays for what is actually missing.
//
// The properties pinned here are the ones that would quietly rot:
//   1. Miss then hit: a second run makes ZERO model calls and produces the SAME bank.
//   2. RESUMABILITY: a run that dies partway leaves the completed sources on disk, and
//      the next run asks the model only about the ones that never finished.
//   3. The key is CONTENT: changed bytes miss, renamed-but-identical bytes hit.
//   4. A stale-protocol, corrupt, or unreadable entry is IGNORED and COUNTED — never
//      trusted, never fatal.
//   5. Disabled by default: no cacheDir, no files, behaviour identical to today.
//   6. GROUNDING IS NEVER BYPASSED — a cached candidate that is not in the current bytes
//      is omitted exactly like a fresh one. The cache cannot smuggle a quote past fidelity.
//   7. Mixed model identities across cached + fresh sources are DISCLOSED, not hidden.
//   8. Both model seams compose with it: `select` per source and `selectBatch` fan-out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mine, serializeBank } from '../src/miner.mjs';
import { PROTOCOL_VERSION, entryFileName } from '../src/cache.mjs';

/** A fresh temp directory; node's test runner leaves them for post-mortem on failure. */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The one quotable line source `i` contains. */
function lineFor(index) {
  return `Line number ${index} is quotable.`;
}

/** `count` sources, each with an id, a path (the batch seam needs one) and its own line. */
function makeSources(count) {
  const sources = [];
  for (let i = 0; i < count; i++) {
    sources.push({
      id: `s-${i}`,
      path: `/corpus/s-${i}.txt`,
      bytes: Buffer.from(`${lineFor(i)}\n`, 'utf8'),
    });
  }
  return sources;
}

/** A per-source fake that RECORDS every source id it was asked about. */
function countingModel({ id = 'fake-model', failOn = null, candidatesFor = null } = {}) {
  const asked = [];
  return {
    id,
    asked,
    resolvedId() {
      return id;
    },
    async select(sourceId) {
      asked.push(sourceId);
      if (failOn !== null && failOn === sourceId) {
        throw new Error(`fake model: refusing source '${sourceId}'`);
      }
      const index = Number(sourceId.slice('s-'.length));
      return candidatesFor === null ? [lineFor(index)] : candidatesFor(index);
    },
  };
}

/** A batch fake that RECORDS the chunks (as id arrays) it was actually dispatched. */
function countingBatchModel({ id = 'fake-batch-model' } = {}) {
  const chunks = [];
  return {
    id,
    chunks,
    resolvedId() {
      return id;
    },
    async selectBatch(sources) {
      chunks.push(sources.map((s) => s.id));
      const answer = new Map();
      for (const source of sources) {
        answer.set(source.id, [lineFor(Number(source.id.slice('s-'.length)))]);
      }
      return answer;
    },
  };
}

/** Seed a cache entry by hand, exactly where the cache would look for it. */
function seedEntry(dir, source, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, entryFileName(source.bytes)), JSON.stringify(entry), 'utf8');
}

/** Every regular file in `dir` (recursively), relative to it. */
function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

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
      assert.equal(serializeBank(uncachedTwo.bank), serializeBank(uncachedOne.bank));
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

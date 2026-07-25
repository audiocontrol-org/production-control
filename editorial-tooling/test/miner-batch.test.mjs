// BATCH mining: the miner's second model seam (`model.selectBatch`).
//
// A model that exposes `selectBatch` is asked about a CHUNK of sources at a time; the
// chunks themselves are dispatched through the SAME bounded-concurrency pool the
// per-source path uses, so chunks run concurrently and each one fans out internally.
//
// The properties pinned here are the ones a second code path could quietly break:
//   1. Chunking: the sources are partitioned, in order, into ceil(n / chunkSize) calls.
//   2. Determinism: quotes and `report.per_source` follow ORIGINAL source order.
//   3. Progress stays PER SOURCE (not per chunk), with the existing event shape.
//   4. EQUIVALENCE: the same logical model output delivered per-source and per-batch
//      produces byte-identical banks and reports.
//   5. The FIDELITY INVARIANT is untouched — grounding runs against the bytes the miner
//      loaded, so a subagent that misreads or hallucinates is omitted exactly as before.
//   6. A source without a `path` fails loud; a bad `chunkSize` fails loud.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mine } from '../src/miner.mjs';
import { buildSourceMap, validateBank } from '../src/validator.mjs';

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

/**
 * A fake batch model: records the chunks it was asked about and answers each source with
 * its own quotable line (plus whatever `extra` supplies).
 */
function batchModel({ candidatesFor = (index) => [lineFor(index)] } = {}) {
  const chunks = [];
  return {
    id: 'fake-batch-model',
    chunks,
    async selectBatch(sources) {
      chunks.push(sources.map((s) => s.id));
      const result = new Map();
      for (const source of sources) {
        const index = Number(source.id.slice('s-'.length));
        result.set(source.id, candidatesFor(index));
      }
      return result;
    },
  };
}

/** The per-source equivalent of `batchModel`, for the equivalence test. */
function perSourceModel({ candidatesFor = (index) => [lineFor(index)] } = {}) {
  return {
    id: 'fake-batch-model',
    async select(sourceId) {
      return candidatesFor(Number(sourceId.slice('s-'.length)));
    },
  };
}

test('miner: batch path chunks the corpus (selectBatch seam)', async (t) => {
  await t.test('7 sources at chunkSize 3 -> 3 chunks, in order, sizes 3/3/1', async () => {
    const sources = makeSources(7);
    const model = batchModel();

    await mine({ sources, model, chunkSize: 3 });

    assert.equal(model.chunks.length, 3, 'expected ceil(7/3) = 3 batch calls');
    assert.deepEqual(model.chunks.map((c) => c.length), [3, 3, 1]);
    assert.deepEqual(model.chunks, [
      ['s-0', 's-1', 's-2'],
      ['s-3', 's-4', 's-5'],
      ['s-6'],
    ]);
  });

  await t.test('the batch call receives id and path, never bytes', async () => {
    const sources = makeSources(2);
    const seen = [];
    const model = {
      id: 'recording-model',
      async selectBatch(batch) {
        seen.push(batch);
        return new Map(batch.map((s) => [s.id, []]));
      },
    };

    await mine({ sources, model, chunkSize: 2 });

    assert.deepEqual(seen[0], [
      { id: 's-0', path: '/corpus/s-0.txt' },
      { id: 's-1', path: '/corpus/s-1.txt' },
    ]);
    for (const entry of seen[0]) {
      assert.equal(entry.bytes, undefined, 'source bytes must not travel to the model');
    }
  });

  await t.test('chunkSize defaults to 10', async () => {
    const sources = makeSources(25);
    const model = batchModel();

    await mine({ sources, model });

    assert.deepEqual(model.chunks.map((c) => c.length), [10, 10, 5]);
  });

  await t.test('QUOTE_MINER_CHUNK_SIZE sets the chunk size when no option is passed', async () => {
    const previous = process.env.QUOTE_MINER_CHUNK_SIZE;
    process.env.QUOTE_MINER_CHUNK_SIZE = '4';
    try {
      const sources = makeSources(9);
      const model = batchModel();
      await mine({ sources, model });
      assert.deepEqual(model.chunks.map((c) => c.length), [4, 4, 1]);
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CHUNK_SIZE;
      } else {
        process.env.QUOTE_MINER_CHUNK_SIZE = previous;
      }
    }
  });

  await t.test('an explicit chunkSize beats the env var', async () => {
    const previous = process.env.QUOTE_MINER_CHUNK_SIZE;
    process.env.QUOTE_MINER_CHUNK_SIZE = '4';
    try {
      const sources = makeSources(6);
      const model = batchModel();
      await mine({ sources, model, chunkSize: 6 });
      assert.deepEqual(model.chunks.map((c) => c.length), [6]);
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CHUNK_SIZE;
      } else {
        process.env.QUOTE_MINER_CHUNK_SIZE = previous;
      }
    }
  });

  await t.test('chunks are dispatched through the concurrency pool', async () => {
    // Six chunks with a bound of 2: at most two batch calls may be in flight at once,
    // and more than one must be — chunking composes WITH the pool, it does not replace it.
    const sources = makeSources(6);
    let inFlight = 0;
    let maxInFlight = 0;
    const model = {
      id: 'overlapping-batch-model',
      async selectBatch(batch) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return new Map(batch.map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]]));
      },
    };

    await mine({ sources, model, chunkSize: 1, concurrency: 2 });

    assert.ok(maxInFlight > 1, 'chunks must actually overlap');
    assert.ok(maxInFlight <= 2, `in-flight ${maxInFlight} exceeded the bound of 2`);
  });
});

test('miner: batch path assembles deterministically', async (t) => {
  await t.test('quotes and per_source stay in ORIGINAL source order', async () => {
    const sources = makeSources(7);
    // Deliberately INVERTED latency: the LAST chunk settles first. If assembly followed
    // completion order, every assertion below would be shuffled.
    const model = {
      id: 'inverted-batch-model',
      async selectBatch(batch) {
        const turns = 10 - Number(batch[0].id.slice('s-'.length));
        for (let i = 0; i < turns; i++) await Promise.resolve();
        return new Map(batch.map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]]));
      },
    };

    const { bank, report } = await mine({ sources, model, chunkSize: 3, concurrency: 3 });

    assert.deepEqual(
      bank.quotes.map((q) => q.source),
      ['s-0', 's-1', 's-2', 's-3', 's-4', 's-5', 's-6'],
      'quotes must be in original source order'
    );
    assert.deepEqual(
      bank.quotes.map((q) => q.id),
      sources.map((_, i) => `q-s-${i}-0`),
      'quote ids are per-source and unaffected by chunking'
    );
    assert.deepEqual(
      report.per_source.map((s) => s.id),
      sources.map((s) => s.id),
      'per_source must be in original source order'
    );
    assert.equal(report.sources_processed, 7);
    assert.equal(report.grounded, 7);
  });

  await t.test('the mined bank is accepted by the REAL validator', async () => {
    const sources = makeSources(7);
    const { bank } = await mine({ sources, model: batchModel(), chunkSize: 3 });

    const { sources: map, errors } = buildSourceMap(sources);
    assert.deepEqual(errors, [], 'source map should have no errors');
    const verdict = validateBank(bank, map);
    assert.equal(verdict.state, 'passed', `validator errors: ${verdict.errors.join(', ')}`);
  });

  await t.test('FIDELITY: a hallucinated passage is omitted, exactly as on the per-source path', async () => {
    // The subagent CLAIMS a line that is not in the bytes the miner loaded. Grounding runs
    // against those bytes, so the claim is omitted — the fan-out changes who reads the
    // file, never what may be emitted.
    const sources = makeSources(3);
    const model = batchModel({
      candidatesFor: (index) =>
        index === 1 ? ['A line the source never contained.'] : [lineFor(index)],
    });

    const { bank, report } = await mine({ sources, model, chunkSize: 3 });

    assert.deepEqual(bank.quotes.map((q) => q.source), ['s-0', 's-2']);
    assert.equal(report.omitted_ungrounded, 1);
    assert.equal(report.grounded, 2);
    assert.equal(report.per_source[1].omitted, 1);
    assert.equal(report.per_source[1].grounded, 0);
  });
});

test('miner: batch path progress is PER SOURCE', async (t) => {
  await t.test('fires once per source with the existing event shape', async () => {
    const sources = makeSources(7);
    const seen = [];

    await mine({
      sources,
      model: batchModel(),
      chunkSize: 3,
      concurrency: 1,
      onProgress: (event) => seen.push(event),
    });

    assert.equal(seen.length, 7, 'one progress event per SOURCE, not per chunk');
    assert.deepEqual(
      seen.map((e) => e.completed),
      [1, 2, 3, 4, 5, 6, 7],
      'completed must climb monotonically'
    );
    assert.deepEqual(seen.map((e) => e.id), sources.map((s) => s.id));
    assert.deepEqual(seen.map((e) => e.index), [1, 2, 3, 4, 5, 6, 7]);
    for (const event of seen) {
      assert.equal(event.total, 7);
      assert.equal(typeof event.selected, 'number');
      assert.equal(typeof event.grounded, 'number');
      assert.equal(typeof event.omitted, 'number');
      assert.equal(typeof event.corrections_proposed, 'number');
      assert.equal(typeof event.corrections_applied, 'number');
      assert.equal(typeof event.corrections_dropped, 'number');
    }
  });
});

test('miner: per-source and batch paths are EQUIVALENT', async (t) => {
  const CORRECTED = 'Line number 2 is quotable.';

  await t.test('identical model output -> byte-identical bank and report', async () => {
    const sources = makeSources(9);
    const candidatesFor = (index) =>
      index === 2
        ? [{ text: CORRECTED, corrections: [{ before: 'quotable', after: 'quotable' }] }]
        : [lineFor(index)];

    const viaSelect = await mine({ sources, model: perSourceModel({ candidatesFor }) });
    const viaBatch = await mine({
      sources,
      model: batchModel({ candidatesFor }),
      chunkSize: 4,
    });

    assert.deepEqual(viaBatch.bank, viaSelect.bank, 'the bank must not depend on the seam used');
    assert.deepEqual(viaBatch.report, viaSelect.report, 'the report must not depend on the seam used');
  });

  await t.test('a model exposing BOTH seams uses selectBatch', async () => {
    const sources = makeSources(4);
    let selectCalls = 0;
    const model = {
      id: 'both-seams-model',
      async select(sourceId) {
        selectCalls++;
        return [lineFor(Number(sourceId.slice('s-'.length)))];
      },
      async selectBatch(batch) {
        return new Map(batch.map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]]));
      },
    };

    const { bank } = await mine({ sources, model, chunkSize: 2 });

    assert.equal(selectCalls, 0, 'selectBatch must win when both seams exist');
    assert.equal(bank.quotes.length, 4);
  });

  await t.test('a model with only `select` still takes the per-source path', async () => {
    const sources = makeSources(3);
    let calls = 0;
    const model = {
      id: 'per-source-only',
      async select(sourceId) {
        calls++;
        return [lineFor(Number(sourceId.slice('s-'.length)))];
      },
    };

    const { bank } = await mine({ sources, model });

    assert.equal(calls, 3, 'one call per source');
    assert.equal(bank.quotes.length, 3);
  });
});

test('miner: batch path fails loud', async (t) => {
  await t.test('a source without a path throws naming it, before any model call', async () => {
    const sources = makeSources(3);
    delete sources[1].path;
    const model = batchModel();

    await assert.rejects(() => mine({ sources, model, chunkSize: 3 }), (err) => {
      assert.match(err.message, /s-1/);
      assert.match(err.message, /path/);
      return true;
    });
    assert.equal(model.chunks.length, 0, 'no model call may be made with an incomplete batch');
  });

  await t.test('a requested source missing from the batch answer throws naming it', async () => {
    const sources = makeSources(3);
    const model = {
      id: 'dropping-model',
      async selectBatch(batch) {
        // Drops s-1 entirely.
        return new Map(
          batch.filter((s) => s.id !== 's-1').map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]])
        );
      },
    };

    await assert.rejects(() => mine({ sources, model, chunkSize: 3 }), (err) => {
      assert.match(err.message, /s-1/);
      assert.match(err.message, /missing/i);
      return true;
    });
  });

  await t.test('a non-UTF-8 source still fails the run on the batch path', async () => {
    const sources = makeSources(3);
    sources[2] = { id: 's-2', path: '/corpus/s-2.txt', bytes: Buffer.from([0xff, 0xfe, 0xfd]) };

    await assert.rejects(
      () => mine({ sources, model: batchModel(), chunkSize: 3 }),
      /not valid UTF-8/
    );
  });

  await t.test('a failing batch fails the whole run; no partial bank', async () => {
    const sources = makeSources(6);
    const model = {
      id: 'failing-batch-model',
      async selectBatch(batch) {
        if (batch.some((s) => s.id === 's-4')) {
          throw new Error('batch failed after retries');
        }
        return new Map(batch.map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]]));
      },
    };

    let result = 'not-assigned';
    await assert.rejects(async () => {
      result = await mine({ sources, model, chunkSize: 2 });
    }, /batch failed after retries/);
    assert.equal(result, 'not-assigned', 'mine must not return a partial bank');
  });

  for (const bad of [0, -1, 2.5, 'ten', null]) {
    await t.test(`rejects chunkSize ${JSON.stringify(bad)} naming the value`, async () => {
      await assert.rejects(
        () => mine({ sources: makeSources(2), model: batchModel(), chunkSize: bad }),
        (err) => {
          assert.match(err.message, /chunkSize/i);
          assert.ok(
            err.message.includes(String(bad)),
            `error should name the bad value ${String(bad)}; got: ${err.message}`
          );
          return true;
        }
      );
    });
  }

  await t.test('rejects a non-integer QUOTE_MINER_CHUNK_SIZE', async () => {
    const previous = process.env.QUOTE_MINER_CHUNK_SIZE;
    process.env.QUOTE_MINER_CHUNK_SIZE = 'ten';
    try {
      await assert.rejects(
        () => mine({ sources: makeSources(2), model: batchModel() }),
        (err) => {
          assert.match(err.message, /QUOTE_MINER_CHUNK_SIZE/);
          assert.ok(err.message.includes('ten'), `error should name 'ten'; got: ${err.message}`);
          return true;
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CHUNK_SIZE;
      } else {
        process.env.QUOTE_MINER_CHUNK_SIZE = previous;
      }
    }
  });

  await t.test('a batch answer that is not a Map throws rather than being guessed at', async () => {
    const sources = makeSources(2);
    const model = {
      id: 'wrong-shape-model',
      async selectBatch() {
        return [{ id: 's-0', candidates: [] }];
      },
    };

    await assert.rejects(() => mine({ sources, model, chunkSize: 2 }), /Map/);
  });
});

// Bounded-concurrency mining (TASK-11).
//
// The miner used to walk sources one at a time, so a 123-source corpus cost 50-80
// minutes of wall clock and any interruption discarded ALL completed work (the build is
// atomic). Sources are completely independent — grounding is `bytes.indexOf` against
// THAT source's own bytes and quote ids are `q-<sourceId>-<n>` (scoped per source) — so
// there is no correctness reason to serialize them.
//
// These tests pin the properties that make parallelism safe:
//   1. DETERMINISM: output order follows the ORIGINAL source order, never completion
//      order — on the per-source path AND on the batch path, where the pool schedules
//      CHUNKS. This is the regression guard for the whole change.
//   2. Concurrency actually happens, and stays bounded.
//   3. concurrency: 1 is exactly the old serial path.
// Fail-fast atomicity and progress semantics live in miner-concurrency-failure.test.mjs.
//
// Every ordering test is CAUSAL, not timing-based: the fake model hands back deferred
// promises that the test resolves by hand, so "slowest" and "fastest" are decided by the
// test, not by a sleep that could flake on a loaded machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mine } from '../src/miner.mjs';

/** A promise whose settlement the test controls. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask queue so the pool can start every runner it is allowed to. */
async function flush(ticks = 50) {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

/** The one quotable line source `i` contains (and the only candidate the fakes select). */
function lineFor(index) {
  return `Line number ${index} is quotable.`;
}

/** `count` independent sources, each containing exactly its own quotable line. */
function makeSources(count) {
  const sources = [];
  for (let i = 0; i < count; i++) {
    sources.push({ id: `s-${i}`, bytes: Buffer.from(`${lineFor(i)}\n`, 'utf8') });
  }
  return sources;
}

/**
 * A fake model that never settles on its own: `select` returns a deferred promise the
 * test resolves or rejects explicitly. It also records call order and in-flight depth.
 */
function deferredModel() {
  const deferredsById = new Map();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    id: 'fake-deferred-model',
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    /** Settle source `index`'s pending call with its own quotable line. */
    resolve(index) {
      deferredsById.get(`s-${index}`).resolve([lineFor(index)]);
    },
    /** Fail source `index`'s pending call. */
    reject(index, error) {
      deferredsById.get(`s-${index}`).reject(error);
    },
    async select(sourceId) {
      calls.push(sourceId);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const gate = deferred();
      deferredsById.set(sourceId, gate);
      try {
        return await gate.promise;
      } finally {
        inFlight--;
      }
    }
  };
}

/**
 * The BATCH equivalent of `deferredModel`: `selectBatch` returns a deferred promise the
 * test settles by hand, keyed by the chunk's arrival order.
 */
function deferredBatchModel() {
  const gates = [];
  const calls = [];
  return {
    id: 'fake-deferred-batch-model',
    calls,
    /** Settle the Nth chunk this model was asked about. */
    resolve(chunkIndex) {
      const { gate, batch } = gates[chunkIndex];
      gate.resolve(
        new Map(batch.map((s) => [s.id, [lineFor(Number(s.id.slice('s-'.length)))]]))
      );
    },
    async selectBatch(batch) {
      calls.push(batch.map((s) => s.id));
      const gate = deferred();
      gates.push({ gate, batch });
      return gate.promise;
    }
  };
}

/** A fake model that settles immediately, but still records in-flight depth. */
function immediateModel() {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    id: 'fake-immediate-model',
    get maxInFlight() {
      return maxInFlight;
    },
    async select(sourceId) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield at least once so overlapping calls are observable at all.
      await Promise.resolve();
      const index = Number(sourceId.slice('s-'.length));
      inFlight--;
      return [lineFor(index)];
    }
  };
}

test('miner: deterministic assembly under concurrency (TASK-11)', async (t) => {
  await t.test('orders quotes and per_source by ORIGINAL index, not completion order', async () => {
    const sources = makeSources(8);
    const model = deferredModel();

    // concurrency 8 puts every source in flight at once, so the test controls the
    // completion order completely.
    const pending = mine({ sources, model, concurrency: 8 });
    await flush();
    assert.equal(model.calls.length, 8, 'all 8 sources should be in flight');

    // Deliberately INVERTED latency: the LAST source finishes first, the FIRST source
    // finishes last. If assembly followed completion order, everything below would be
    // reversed.
    for (let i = 7; i >= 0; i--) {
      model.resolve(i);
      await flush(5);
    }

    const { bank, report } = await pending;

    assert.deepEqual(
      bank.quotes.map((q) => q.source),
      ['s-0', 's-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-7'],
      'quotes must be in original source order'
    );
    assert.deepEqual(
      bank.quotes.map((q) => q.text),
      sources.map((_, i) => lineFor(i)),
      'quote text must line up with the original source order'
    );
    // Quote ids are scoped per source (`q-<sourceId>-<n>`), so parallelism cannot make
    // them collide or renumber — assert that explicitly.
    assert.deepEqual(
      bank.quotes.map((q) => q.id),
      sources.map((_, i) => `q-s-${i}-0`),
      'quote ids are per-source and unaffected by completion order'
    );
    assert.equal(new Set(bank.quotes.map((q) => q.id)).size, 8, 'quote ids must be unique');

    assert.deepEqual(
      report.per_source.map((s) => s.id),
      sources.map((s) => s.id),
      'per_source must be in original source order'
    );
    assert.equal(report.sources_processed, 8);
    assert.equal(report.grounded, 8);
  });

  await t.test('reverse-completion run is byte-identical to an in-order run', async () => {
    const sources = makeSources(6);

    const reversedModel = deferredModel();
    const reversed = mine({ sources, model: reversedModel, concurrency: 6 });
    await flush();
    for (let i = 5; i >= 0; i--) {
      reversedModel.resolve(i);
      await flush(5);
    }
    const reversedResult = await reversed;

    const forwardModel = deferredModel();
    const forward = mine({ sources, model: forwardModel, concurrency: 6 });
    await flush();
    for (let i = 0; i < 6; i++) {
      forwardModel.resolve(i);
      await flush(5);
    }
    const forwardResult = await forward;

    assert.deepEqual(
      reversedResult.bank,
      forwardResult.bank,
      'the same model responses must produce an identical bank regardless of completion order'
    );
    assert.deepEqual(reversedResult.report, forwardResult.report);
  });

  await t.test('the BATCH path holds the same guarantee, one level up', async () => {
    // Chunks, not sources, are what the pool schedules on the batch path, so determinism
    // has to survive chunks completing out of order as well. Same causal technique: the
    // test decides which chunk settles when.
    const sources = makeSources(6).map((source) => ({ ...source, path: `/corpus/${source.id}.txt` }));

    const reversedModel = deferredBatchModel();
    const reversed = mine({ sources, model: reversedModel, chunkSize: 2, concurrency: 3 });
    await flush();
    assert.equal(reversedModel.calls.length, 3, 'all 3 chunks should be in flight');
    for (let chunk = 2; chunk >= 0; chunk--) {
      reversedModel.resolve(chunk);
      await flush(5);
    }
    const reversedResult = await reversed;

    const forwardModel = deferredBatchModel();
    const forward = mine({ sources, model: forwardModel, chunkSize: 2, concurrency: 3 });
    await flush();
    for (let chunk = 0; chunk < 3; chunk++) {
      forwardModel.resolve(chunk);
      await flush(5);
    }
    const forwardResult = await forward;

    assert.deepEqual(
      reversedResult.bank.quotes.map((q) => q.source),
      sources.map((s) => s.id),
      'quotes must be in original source order however the chunks landed'
    );
    assert.deepEqual(
      reversedResult.bank,
      forwardResult.bank,
      'chunk completion order must not change a single byte of the bank'
    );
    assert.deepEqual(reversedResult.report, forwardResult.report);
  });
});

test('miner: bounded concurrency (TASK-11)', async (t) => {
  await t.test('runs several sources at once but never more than the bound', async () => {
    const sources = makeSources(8);
    const model = deferredModel();

    const pending = mine({ sources, model, concurrency: 4 });
    await flush();

    assert.equal(model.calls.length, 4, 'exactly the bound should be in flight, not all 8');
    assert.ok(model.maxInFlight > 1, 'more than one source must run at a time');
    assert.ok(model.maxInFlight <= 4, `in-flight ${model.maxInFlight} exceeded the bound of 4`);

    for (let i = 0; i < 8; i++) {
      model.resolve(i);
      await flush(5);
    }
    const { bank } = await pending;

    assert.equal(model.calls.length, 8, 'every source must eventually be mined');
    assert.ok(model.maxInFlight <= 4, `in-flight ${model.maxInFlight} exceeded the bound of 4`);
    assert.deepEqual(
      bank.quotes.map((q) => q.source),
      sources.map((s) => s.id)
    );
  });

  await t.test('defaults to 4 when neither an option nor the env var is set', async () => {
    const previous = process.env.QUOTE_MINER_CONCURRENCY;
    delete process.env.QUOTE_MINER_CONCURRENCY;
    try {
      const sources = makeSources(8);
      const model = deferredModel();
      const pending = mine({ sources, model });
      await flush();
      assert.equal(model.calls.length, 4, 'default concurrency should be 4');
      for (let i = 0; i < 8; i++) {
        model.resolve(i);
        await flush(5);
      }
      await pending;
    } finally {
      if (previous !== undefined) {
        process.env.QUOTE_MINER_CONCURRENCY = previous;
      }
    }
  });

  await t.test('reads QUOTE_MINER_CONCURRENCY when no option is passed', async () => {
    const previous = process.env.QUOTE_MINER_CONCURRENCY;
    process.env.QUOTE_MINER_CONCURRENCY = '2';
    try {
      const sources = makeSources(8);
      const model = deferredModel();
      const pending = mine({ sources, model });
      await flush();
      assert.equal(model.calls.length, 2, 'env var should set the bound');
      for (let i = 0; i < 8; i++) {
        model.resolve(i);
        await flush(5);
      }
      await pending;
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CONCURRENCY;
      } else {
        process.env.QUOTE_MINER_CONCURRENCY = previous;
      }
    }
  });

  await t.test('an explicit option beats the env var', async () => {
    const previous = process.env.QUOTE_MINER_CONCURRENCY;
    process.env.QUOTE_MINER_CONCURRENCY = '2';
    try {
      const sources = makeSources(8);
      const model = deferredModel();
      const pending = mine({ sources, model, concurrency: 5 });
      await flush();
      assert.equal(model.calls.length, 5, 'the explicit option should win');
      for (let i = 0; i < 8; i++) {
        model.resolve(i);
        await flush(5);
      }
      await pending;
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CONCURRENCY;
      } else {
        process.env.QUOTE_MINER_CONCURRENCY = previous;
      }
    }
  });

  await t.test('concurrency 1 is exactly the serial path', async () => {
    const sources = makeSources(6);

    const serialModel = immediateModel();
    const serial = await mine({ sources, model: serialModel, concurrency: 1 });
    assert.equal(serialModel.maxInFlight, 1, 'concurrency 1 must never overlap two calls');

    const parallelModel = immediateModel();
    const parallel = await mine({ sources, model: parallelModel, concurrency: 4 });
    assert.ok(parallelModel.maxInFlight > 1, 'the parallel run should actually overlap');

    assert.deepEqual(serial.bank, parallel.bank, 'concurrency must not change the bank');
    assert.deepEqual(serial.report, parallel.report, 'concurrency must not change the report');
  });
});

test('miner: invalid concurrency throws naming the value (TASK-11)', async (t) => {
  const sources = makeSources(2);

  for (const bad of [0, -1, 2.5, 'four', null]) {
    await t.test(`rejects concurrency ${JSON.stringify(bad)}`, async () => {
      await assert.rejects(
        () => mine({ sources, model: immediateModel(), concurrency: bad }),
        (err) => {
          assert.match(err.message, /concurrency/i);
          assert.ok(
            err.message.includes(String(bad)),
            `error should name the bad value ${String(bad)}; got: ${err.message}`
          );
          return true;
        }
      );
    });
  }

  await t.test('rejects a non-integer QUOTE_MINER_CONCURRENCY', async () => {
    const previous = process.env.QUOTE_MINER_CONCURRENCY;
    process.env.QUOTE_MINER_CONCURRENCY = 'four';
    try {
      await assert.rejects(
        () => mine({ sources, model: immediateModel() }),
        (err) => {
          assert.match(err.message, /QUOTE_MINER_CONCURRENCY/);
          assert.ok(err.message.includes('four'), `error should name 'four'; got: ${err.message}`);
          return true;
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_CONCURRENCY;
      } else {
        process.env.QUOTE_MINER_CONCURRENCY = previous;
      }
    }
  });
});

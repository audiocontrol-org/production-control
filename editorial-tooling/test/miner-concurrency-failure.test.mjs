// Failure and progress semantics under concurrency (TASK-11). The determinism and
// bounded-fan-out halves of this suite live in miner-concurrency.test.mjs.
//
// Two properties are pinned here:
//   FAILURE IS TOTAL. The first failing source fails the whole run, no further sources
//   are scheduled, in-flight peers are awaited to settlement, and no unhandled rejection
//   escapes (FR-015/FR-016 atomicity).
//   PROGRESS IS A LIVENESS SIGNAL. Events arrive in completion order, carrying both the
//   source's ORIGINAL index and a monotonically increasing completed count.
//
// Every ordering test is CAUSAL, not timing-based: the fake model hands back deferred
// promises the test settles by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
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
 * test resolves or rejects explicitly.
 */
function deferredModel() {
  const deferredsById = new Map();
  const calls = [];
  return {
    id: 'fake-deferred-model',
    calls,
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
      const gate = deferred();
      deferredsById.set(sourceId, gate);
      return gate.promise;
    }
  };
}

/** A fake model that settles immediately. */
function immediateModel() {
  return {
    id: 'fake-immediate-model',
    async select(sourceId) {
      await Promise.resolve();
      return [lineFor(Number(sourceId.slice('s-'.length)))];
    }
  };
}
test('miner: fail-fast stays atomic under concurrency (FR-015/FR-016)', async (t) => {
  await t.test('one failing source fails the whole run and stops scheduling', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const sources = makeSources(8);
      const model = deferredModel();
      const pending = mine({ sources, model, concurrency: 4 });
      await flush();
      assert.equal(model.calls.length, 4);

      // Source 3 (the 4th of 8) blows up while 0-2 are still in flight.
      model.reject(3, new Error("model refused source 's-3'"));
      await flush();

      // The three in-flight peers still settle normally; the pool must absorb them
      // rather than scheduling sources 4-7.
      model.resolve(0);
      model.resolve(1);
      model.resolve(2);

      await assert.rejects(pending, /model refused source 's-3'/);

      assert.equal(
        model.calls.length,
        4,
        `scheduling must stop after a failure; model saw ${model.calls.length} calls`
      );

      // Give Node a full turn of the event loop: an unhandled rejection would surface here.
      await tick();
      await tick();
      assert.deepEqual(unhandled, [], 'a failing source must not leave an unhandled rejection');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  await t.test('no bank is produced when a source fails', async () => {
    const sources = makeSources(4);
    const model = {
      id: 'fake-failing-model',
      async select(sourceId) {
        if (sourceId === 's-2') {
          throw new Error('model failure after retries');
        }
        return [lineFor(Number(sourceId.slice('s-'.length)))];
      }
    };

    let result = 'not-assigned';
    await assert.rejects(async () => {
      result = await mine({ sources, model, concurrency: 4 });
    }, /model failure after retries/);
    assert.equal(result, 'not-assigned', 'mine must not return a partial bank');
  });

  await t.test('concurrent failures report the first and disclose the rest', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const sources = makeSources(4);
      const model = deferredModel();
      const pending = mine({ sources, model, concurrency: 4 });
      await flush();

      model.reject(1, new Error('first failure: s-1'));
      model.reject(2, new Error('second failure: s-2'));
      model.resolve(0);
      model.resolve(3);

      await assert.rejects(pending, (err) => {
        assert.match(err.message, /first failure: s-1/, 'the first failure is reported');
        assert.match(err.message, /second failure: s-2/, 'other failures are not swallowed');
        return true;
      });

      await tick();
      await tick();
      assert.deepEqual(unhandled, [], 'concurrent failures must not leak unhandled rejections');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  await t.test('a non-UTF-8 source still fails the run under concurrency', async () => {
    const sources = makeSources(4);
    sources[2] = { id: 's-2', bytes: Buffer.from([0xff, 0xfe, 0xfd]) };
    await assert.rejects(
      () => mine({ sources, model: immediateModel(), concurrency: 4 }),
      /not valid UTF-8/
    );
  });
});

test('miner: progress under concurrency (TASK-11)', async (t) => {
  await t.test('reports the original index plus a monotonic completed count', async () => {
    const sources = makeSources(8);
    const model = deferredModel();
    const seen = [];

    const pending = mine({
      sources,
      model,
      concurrency: 8,
      onProgress: (event) => seen.push(event)
    });
    await flush();

    // Complete in reverse order: `completed` must still count 1..8 upward while `index`
    // keeps naming the source's ORIGINAL position.
    for (let i = 7; i >= 0; i--) {
      model.resolve(i);
      await flush(5);
    }
    await pending;

    assert.equal(seen.length, 8, 'one progress event per source');
    assert.deepEqual(
      seen.map((e) => e.completed),
      [1, 2, 3, 4, 5, 6, 7, 8],
      'completed must increase monotonically so an operator sees forward motion'
    );
    assert.deepEqual(
      seen.map((e) => e.id),
      ['s-7', 's-6', 's-5', 's-4', 's-3', 's-2', 's-1', 's-0'],
      'progress is emitted in completion order (it is a liveness signal)'
    );
    assert.deepEqual(
      seen.map((e) => e.index),
      [8, 7, 6, 5, 4, 3, 2, 1],
      'index must stay the source ORIGINAL 1-based position, not the completion position'
    );
    for (const event of seen) {
      assert.equal(event.total, 8);
      assert.equal(event.id, `s-${event.index - 1}`, 'index and id must name the same source');
    }
  });
});

// The SUBAGENT FAN-OUT adapter's RETRY, MODEL IDENTITY, and COST DIAGNOSTICS.
//
// The wire protocol itself (argv, prompt, parsing, fail-loud) lives in
// claude-agent.test.mjs. What is pinned here is that this adapter honours exactly the same
// operational contracts as the per-source adapter in src/claude.mjs — a bounded retry
// budget that fails loud when exhausted, and a model identity read from the response
// envelope rather than invented — plus the usage accounting that is the whole reason the
// fan-out adapter exists.
//
// Every test injects a fake spawn. No real `claude` process is ever launched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAgentModel } from '../src/claude-agent.mjs';

/** The batch every test asks for. */
const SOURCES = [
  { id: 'PB-P001', path: '/corpus/newspapers/1879-07-15/issue.txt' },
  { id: 'PB-P002', path: '/corpus/newspapers/1879-08-01/issue.txt' },
];

/** A well-formed `claude -p --output-format json` envelope for the BATCH schema. */
function batchEnvelope(
  sources,
  { model = 'claude-opus-5[1m]', canonicalModel = 'claude-opus-5', usage = undefined } = {}
) {
  return JSON.stringify({
    is_error: false,
    subtype: 'success',
    type: 'result',
    num_turns: 8,
    modelUsage: {
      [model]: { inputTokens: 2, outputTokens: 69, canonicalModel, provider: 'firstParty' },
    },
    usage: usage ?? { cache_creation_input_tokens: 37788, input_tokens: 12, output_tokens: 500 },
    structured_output: { sources },
  });
}

/** Fake spawn: records the invocation, returns a canned result. */
function makeFakeSpawn({ stdout = batchEnvelope([]), status = 0, error = undefined } = {}) {
  const calls = [];
  const fn = (command, args, opts) => {
    calls.push({ command, args, opts });
    return { status, stdout, stderr: '', error };
  };
  fn.calls = calls;
  return fn;
}

/** Fake spawn walking a SEQUENCE of canned results, one per attempt (last one repeats). */
function makeSequencedSpawn(results) {
  const calls = [];
  const fn = (command, args, opts) => {
    const result = results[Math.min(calls.length, results.length - 1)];
    calls.push({ command, args, opts });
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  fn.calls = calls;
  return fn;
}

/** Every requested source answered with zero candidates (a legitimate, explicit answer). */
function emptyFor(sources) {
  return sources.map((s) => ({ id: s.id, candidates: [] }));
}

test('claudeAgentModel: bounded retry (same policy as the per-source adapter)', async (t) => {
  await t.test('non-zero exit on attempt 1, success on attempt 2 -> resolves', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { status: 3, stdout: '', stderr: 'boom' },
      { status: 0, stdout: batchEnvelope(emptyFor(SOURCES)) },
    ]);
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.selectBatch(SOURCES);

    assert.deepEqual(result.get('PB-P001'), []);
    assert.equal(fakeSpawn.calls.length, 2, 'exactly one retry consumed');
  });

  await t.test('spawn error on attempt 1, success on attempt 2 -> resolves', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { error: new Error('ENOENT'), status: null, stdout: '' },
      { status: 0, stdout: batchEnvelope(emptyFor(SOURCES)) },
    ]);
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.equal((await model.selectBatch(SOURCES)).size, 2);
    assert.equal(fakeSpawn.calls.length, 2);
  });

  await t.test('a DROPPED source on attempt 1 is retried and can succeed', async () => {
    // The retry budget is what makes throwing on a missing source safe: a subagent that
    // silently dropped one file usually answers for it on the next attempt.
    const fakeSpawn = makeSequencedSpawn([
      { status: 0, stdout: batchEnvelope([{ id: 'PB-P001', candidates: [] }]) },
      { status: 0, stdout: batchEnvelope(emptyFor(SOURCES)) },
    ]);
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.equal((await model.selectBatch(SOURCES)).size, 2);
    assert.equal(fakeSpawn.calls.length, 2);
  });

  await t.test('always failing -> throws naming the attempt count and the last error', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: 'not json at all' });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 4 });

    await assert.rejects(() => model.selectBatch(SOURCES), /after 4 attempt/);
    assert.equal(fakeSpawn.calls.length, 4, 'exactly maxAttempts spawn invocations');
  });

  await t.test('default attempt budget is 3', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: 'not json at all' });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(() => model.selectBatch(SOURCES), /after 3 attempt/);
    assert.equal(fakeSpawn.calls.length, 3);
  });

  await t.test('the thrown message names the batch it failed on', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '', status: 1 });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(() => model.selectBatch(SOURCES), (err) => {
      assert.match(err.message, /exited with status 1/);
      assert.match(err.message, /PB-P001/);
      return true;
    });
  });

  await t.test('an injected sleep is awaited between attempts, never before the first', async () => {
    const slept = [];
    const fakeSpawn = makeSequencedSpawn([
      { status: 1, stdout: '' },
      { status: 0, stdout: batchEnvelope(emptyFor(SOURCES)) },
    ]);
    const model = claudeAgentModel({
      spawnImpl: fakeSpawn,
      retryDelayMs: 25,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await model.selectBatch(SOURCES);

    assert.deepEqual(slept, [25], 'exactly one backoff, before attempt 2');
  });

  await t.test('rejects a nonsensical attempt budget instead of guessing', () => {
    assert.throws(() => claudeAgentModel({ spawnImpl: makeFakeSpawn(), maxAttempts: 0 }), /maxAttempts/);
  });
});

test('claudeAgentModel: model identity (AUDIT-21, FR-020)', async (t) => {
  await t.test('before any call the id is the command basename', () => {
    const model = claudeAgentModel({ spawnImpl: makeFakeSpawn() });
    assert.equal(model.id, 'claude');
    assert.equal(model.resolvedId(), 'claude');
  });

  await t.test('resolves canonicalModel from modelUsage after the first successful batch', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope(emptyFor(SOURCES), {
        model: 'claude-opus-5[1m]',
        canonicalModel: 'claude-opus-5',
      }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.equal(model.id, 'claude');
    await model.selectBatch(SOURCES);

    assert.equal(model.id, 'claude-opus-5');
    assert.equal(model.resolvedId(), 'claude-opus-5');
  });

  await t.test('falls back to the modelUsage KEY when canonicalModel is absent', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({
        modelUsage: { 'claude-haiku-9[1m]': { outputTokens: 5 } },
        structured_output: { sources: emptyFor(SOURCES) },
      }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    assert.equal(model.id, 'claude-haiku-9[1m]');
  });

  await t.test('NEVER invents an identity: no modelUsage -> keeps the command basename', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ structured_output: { sources: emptyFor(SOURCES) } }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    assert.equal(model.id, 'claude');
  });

  await t.test('options.modelId outranks the resolved identity', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, modelId: 'pinned-id' });

    await model.selectBatch(SOURCES);

    assert.equal(model.id, 'pinned-id');
    assert.equal(model.resolvedId(), 'pinned-id');
  });

  await t.test('QUOTE_MINER_MODEL_ID outranks the resolved identity', async () => {
    const previous = process.env.QUOTE_MINER_MODEL_ID;
    process.env.QUOTE_MINER_MODEL_ID = 'env-pinned-id';
    try {
      const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
      const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

      await model.selectBatch(SOURCES);

      assert.equal(model.id, 'env-pinned-id');
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_MODEL_ID;
      } else {
        process.env.QUOTE_MINER_MODEL_ID = previous;
      }
    }
  });
});

test('claudeAgentModel: usage diagnostics', async (t) => {
  await t.test('reports the envelope usage for a batch when a sink is injected', async () => {
    const seen = [];
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope(emptyFor(SOURCES), {
        usage: { cache_creation_input_tokens: 37788, input_tokens: 12, output_tokens: 500 },
      }),
    });
    const model = claudeAgentModel({
      spawnImpl: fakeSpawn,
      retryDelayMs: 0,
      onDiagnostic: (event) => seen.push(event),
    });

    await model.selectBatch(SOURCES);

    assert.equal(seen.length, 1, 'one diagnostic per batch');
    assert.equal(seen[0].sources, 2);
    assert.equal(seen[0].cache_creation_input_tokens, 37788);
    assert.equal(seen[0].num_turns, 8);
  });
});

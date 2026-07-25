import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { basename } from 'node:path';
import { claudeModel } from '../src/claude.mjs';

// A command basename that is NOT the default `claude`, so the adapter takes the
// TOLERANT path (plain args, bare JSON array on stdout) — the injected-fake seam
// used by miner-bin.test.mjs and by operators pointing at a stand-in binary.
const FAKE_COMMAND = path.join('/opt', 'alt-tools', 'not-claude-binary');

// Fake spawnSync-shaped implementation: records the invocation and returns a
// canned result so no real `claude` process is ever launched.
function makeFakeSpawn({ stdout = '[]', status = 0, error = undefined } = {}) {
  const calls = [];
  const fn = (command, args, opts) => {
    calls.push({ command, args, opts });
    return { status, stdout, stderr: '', error };
  };
  fn.calls = calls;
  return fn;
}

// Fake spawn that walks a SEQUENCE of canned results, one per attempt, so retry
// behaviour is observable. The last entry repeats once the sequence is exhausted.
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

/** A well-formed `claude -p --output-format json` envelope. */
function structuredEnvelope(candidates, { model = 'claude-opus-5[1m]', canonicalModel = 'claude-opus-5' } = {}) {
  return JSON.stringify({
    is_error: false,
    subtype: 'success',
    type: 'result',
    modelUsage: {
      [model]: { inputTokens: 2, outputTokens: 69, canonicalModel, provider: 'firstParty' },
    },
    result: JSON.stringify({ candidates }),
    structured_output: { candidates },
  });
}

test('claudeModel: id (AUDIT-21 provenance)', async (t) => {
  await t.test('default options, no env override -> id is "claude" before any call', () => {
    const model = claudeModel({ spawnImpl: makeFakeSpawn() });
    assert.equal(model.id, 'claude');
  });

  await t.test('options.command WITHOUT env override -> id is the basename of that command (regression guard)', () => {
    const model = claudeModel({
      command: FAKE_COMMAND,
      spawnImpl: makeFakeSpawn(),
    });
    assert.equal(model.id, basename(FAKE_COMMAND));
    assert.notEqual(model.id, 'claude');
  });

  await t.test('QUOTE_MINER_MODEL_ID env var takes precedence over basename', () => {
    const previous = process.env.QUOTE_MINER_MODEL_ID;
    process.env.QUOTE_MINER_MODEL_ID = 'claude-opus-4';
    try {
      const model = claudeModel({
        command: FAKE_COMMAND,
        spawnImpl: makeFakeSpawn(),
      });
      assert.equal(model.id, 'claude-opus-4');
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_MODEL_ID;
      } else {
        process.env.QUOTE_MINER_MODEL_ID = previous;
      }
    }
  });

  await t.test('options.modelId takes precedence over basename', () => {
    const model = claudeModel({
      command: FAKE_COMMAND,
      modelId: 'claude-sonnet-5',
      spawnImpl: makeFakeSpawn(),
    });
    assert.equal(model.id, 'claude-sonnet-5');
  });
});

test('claudeModel: DEFAULT path speaks the CLI structured-output protocol', async (t) => {
  await t.test('builds --output-format json --json-schema argv with an INLINE schema', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: structuredEnvelope([]), status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'some source text');

    const { command, args } = fakeSpawn.calls[0];
    assert.equal(command, 'claude');
    assert.ok(args.includes('-p'), `expected -p in argv: ${JSON.stringify(args)}`);

    const formatIdx = args.indexOf('--output-format');
    assert.notEqual(formatIdx, -1, `expected --output-format in argv: ${JSON.stringify(args)}`);
    assert.equal(args[formatIdx + 1], 'json');

    const schemaIdx = args.indexOf('--json-schema');
    assert.notEqual(schemaIdx, -1, `expected --json-schema in argv: ${JSON.stringify(args)}`);

    // The schema MUST be passed inline as JSON text — a file path is rejected by the CLI.
    const schema = JSON.parse(args[schemaIdx + 1]);
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['candidates']);
    const item = schema.properties.candidates.items;
    assert.deepEqual(item.required, ['text', 'corrections']);
    assert.equal(item.properties.text.type, 'string');
    assert.deepEqual(item.properties.corrections.items.required, ['before', 'after']);
  });

  await t.test('reads candidates from structured_output.candidates', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: structuredEnvelope([
        { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
        { text: 'a clean passage', corrections: [] },
      ]),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.select('source-1', 'some source text');

    assert.deepEqual(result, [
      { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
      { text: 'a clean passage', corrections: [] },
    ]);
    assert.equal(fakeSpawn.calls.length, 1, 'expected exactly one spawn invocation');
  });

  await t.test('the structured prompt still forbids authoring and asks for corrections', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: structuredEnvelope([]), status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'some source text');

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.match(prompt, /corrections/);
    assert.match(prompt, /"before"/);
    assert.match(prompt, /"after"/);
    assert.match(prompt, /paraphrase/i);
  });

  await t.test('FAIL LOUD: envelope missing structured_output throws naming it (never an empty list)', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ is_error: false, result: '{"candidates":[]}' }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /structured_output/);
  });

  await t.test('FAIL LOUD: structured_output without a candidates array throws naming it', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ structured_output: { candidates: 'nope' } }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /structured_output\.candidates/);
  });

  await t.test('FAIL LOUD: a bare JSON array (no envelope) on the default path throws', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '["a quote"]', status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /envelope/i);
  });

  await t.test('rejects a candidate that is neither string nor {text}', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: structuredEnvelope([{ corrections: [] }]),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /candidate/i);
  });
});

test('claudeModel: resolves the REAL model identity from the envelope (AUDIT-21, FR-020)', async (t) => {
  await t.test('id becomes the canonicalModel after the first successful default-path call', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: structuredEnvelope([], { model: 'claude-opus-5[1m]', canonicalModel: 'claude-opus-5' }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    // ORDERING: before any call the identity is not yet known.
    assert.equal(model.id, 'claude');

    await model.select('source-1', 'some source text');

    assert.equal(model.id, 'claude-opus-5');
    assert.equal(model.resolvedId(), 'claude-opus-5');
  });

  await t.test('a model swap behind a fixed `claude` command IS visible', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: structuredEnvelope([], { model: 'claude-sonnet-5', canonicalModel: 'claude-sonnet-5' }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'text');

    assert.equal(model.id, 'claude-sonnet-5');
    assert.notEqual(model.id, 'claude');
  });

  await t.test('falls back to the modelUsage KEY when canonicalModel is absent', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({
        modelUsage: { 'claude-haiku-9[1m]': { outputTokens: 5 } },
        structured_output: { candidates: [] },
      }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'text');

    assert.equal(model.id, 'claude-haiku-9[1m]');
  });

  await t.test('NEVER invents an identity: no modelUsage -> keeps the command basename', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ structured_output: { candidates: [] } }),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'text');

    assert.equal(model.id, 'claude');
  });

  await t.test('QUOTE_MINER_MODEL_ID still overrides the resolved identity', async () => {
    const previous = process.env.QUOTE_MINER_MODEL_ID;
    process.env.QUOTE_MINER_MODEL_ID = 'pinned-model-id';
    try {
      const fakeSpawn = makeFakeSpawn({ stdout: structuredEnvelope([]), status: 0 });
      const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

      await model.select('source-1', 'text');

      assert.equal(model.id, 'pinned-model-id');
      assert.equal(model.resolvedId(), 'pinned-model-id');
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_MODEL_ID;
      } else {
        process.env.QUOTE_MINER_MODEL_ID = previous;
      }
    }
  });

  await t.test('a NON-default injected command keeps using the command basename', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '["a quote"]', status: 0 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'text');

    assert.equal(model.id, basename(FAKE_COMMAND));
  });
});

test('claudeModel: bounded retry of transient model failures', async (t) => {
  await t.test('non-zero exit on attempt 1, success on attempt 2 -> resolves, one retry consumed', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { status: 3, stdout: '', stderr: 'boom' },
      { status: 0, stdout: structuredEnvelope([{ text: 'a quote', corrections: [] }]) },
    ]);
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.select('source-1', 'text');

    assert.deepEqual(result, [{ text: 'a quote', corrections: [] }]);
    assert.equal(fakeSpawn.calls.length, 2, 'expected exactly one retry');
  });

  await t.test('spawn error on attempt 1, success on attempt 2 -> resolves', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { error: new Error('ENOENT'), status: null, stdout: '' },
      { status: 0, stdout: structuredEnvelope([]) },
    ]);
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.deepEqual(await model.select('source-1', 'text'), []);
    assert.equal(fakeSpawn.calls.length, 2);
  });

  await t.test('unparseable output on attempt 1, success on attempt 2 -> resolves', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { status: 0, stdout: 'I am afraid I cannot do that.' },
      { status: 0, stdout: structuredEnvelope([{ text: 'a quote', corrections: [] }]) },
    ]);
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.deepEqual(await model.select('source-1', 'text'), [{ text: 'a quote', corrections: [] }]);
    assert.equal(fakeSpawn.calls.length, 2);
  });

  await t.test('always unparseable -> throws after the configured attempts, naming the count', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: 'not json at all', status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 4 });

    await assert.rejects(() => model.select('source-1', 'text'), /after 4 attempt/);
    assert.equal(fakeSpawn.calls.length, 4, 'expected exactly maxAttempts spawn invocations');
  });

  await t.test('default attempt budget is 3', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: 'not json at all', status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(() => model.select('source-1', 'text'), /after 3 attempt/);
    assert.equal(fakeSpawn.calls.length, 3);
  });

  await t.test('the thrown message carries the last underlying error and the source id', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '', status: 1 });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(
      () => model.select('source-42', 'text'),
      (err) => {
        assert.match(err.message, /exited with status 1/);
        assert.match(err.message, /source-42/);
        return true;
      }
    );
  });

  await t.test('QUOTE_MINER_MODEL_MAX_ATTEMPTS configures the budget', async () => {
    const previous = process.env.QUOTE_MINER_MODEL_MAX_ATTEMPTS;
    process.env.QUOTE_MINER_MODEL_MAX_ATTEMPTS = '2';
    try {
      const fakeSpawn = makeFakeSpawn({ stdout: 'not json', status: 0 });
      const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });
      await assert.rejects(() => model.select('source-1', 'text'), /after 2 attempt/);
      assert.equal(fakeSpawn.calls.length, 2);
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_MODEL_MAX_ATTEMPTS;
      } else {
        process.env.QUOTE_MINER_MODEL_MAX_ATTEMPTS = previous;
      }
    }
  });

  await t.test('an injected sleep is awaited between attempts and never before the first', async () => {
    const slept = [];
    const fakeSpawn = makeSequencedSpawn([
      { status: 1, stdout: '' },
      { status: 0, stdout: structuredEnvelope([]) },
    ]);
    const model = claudeModel({
      spawnImpl: fakeSpawn,
      retryDelayMs: 25,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    await model.select('source-1', 'text');

    assert.deepEqual(slept, [25], 'expected exactly one backoff, before attempt 2');
  });

  await t.test('rejects a nonsensical attempt budget instead of guessing', () => {
    assert.throws(
      () => claudeModel({ spawnImpl: makeFakeSpawn(), maxAttempts: 0 }),
      /maxAttempts/
    );
  });
});

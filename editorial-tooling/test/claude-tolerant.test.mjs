// The TOLERANT protocol: what the adapter does when the resolved command is NOT the
// default `claude` — the injected-fake seam (`QUOTE_MINER_MODEL_CMD` / `options.command`)
// that miner-bin.test.mjs and stand-in binaries use. A bare command understands neither
// `--output-format` nor `--json-schema`, so it is invoked with plain args and its stdout
// is parsed as a bare JSON array. Everything here is pre-existing behaviour that must
// keep working unchanged. The structured default path lives in claude.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { basename } from 'node:path';
import { claudeModel } from '../src/claude.mjs';

const FAKE_COMMAND = path.join('/opt', 'alt-tools', 'not-claude-binary');

function makeFakeSpawn({ stdout = '[]', status = 0, error = undefined } = {}) {
  const calls = [];
  const fn = (command, args, opts) => {
    calls.push({ command, args, opts });
    return { status, stdout, stderr: '', error };
  };
  fn.calls = calls;
  return fn;
}

/** Walks a SEQUENCE of canned results, one per attempt; the last entry repeats. */
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

/** A well-formed `claude -p --output-format json` envelope (structured default path). */
function structuredEnvelope(candidates) {
  return JSON.stringify({
    is_error: false,
    modelUsage: {
      'claude-opus-5[1m]': { outputTokens: 69, canonicalModel: 'claude-opus-5' },
    },
    result: JSON.stringify({ candidates }),
    structured_output: { candidates },
  });
}

test('claudeModel: NON-default command keeps the tolerant array protocol (backward compatibility)', async (t) => {
  await t.test('plain args, no structured flags', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '[]', status: 0 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'text');

    const { args } = fakeSpawn.calls[0];
    assert.ok(!args.includes('--output-format'), `tolerant path must not pass --output-format: ${JSON.stringify(args)}`);
    assert.ok(!args.includes('--json-schema'), `tolerant path must not pass --json-schema: ${JSON.stringify(args)}`);
  });

  await t.test('normalizes a plain-string array to the candidate object shape', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: '["a quote", "another quote"]',
      status: 0,
    });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.select('source-1', 'some source text');

    assert.deepEqual(result, [
      { text: 'a quote', corrections: [] },
      { text: 'another quote', corrections: [] },
    ]);
    assert.equal(fakeSpawn.calls.length, 1, 'expected exactly one spawn invocation');
  });

  await t.test('parses proposed OCR corrections (TASK-9)', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify([
        { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
        { text: 'a clean passage', corrections: [] },
        'a bare string candidate',
      ]),
      status: 0,
    });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.select('source-1', 'some source text');

    assert.deepEqual(result, [
      { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
      { text: 'a clean passage', corrections: [] },
      { text: 'a bare string candidate', corrections: [] },
    ]);
  });

  await t.test('tolerates stray wrapping prose around the array', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: 'Here you go:\n["a quote"]\nHope that helps.',
      status: 0,
    });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.deepEqual(await model.select('source-1', 'text'), [{ text: 'a quote', corrections: [] }]);
  });

  await t.test('throws on a candidate that is neither string nor {text}', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '[{"corrections": []}]', status: 0 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /candidate/i);
  });

  await t.test('throws on a malformed correction entry', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify([{ text: 'passage', corrections: [{ before: 5, after: 'x' }] }]),
      status: 0,
    });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.select('source-1', 'text'), /correction/i);
  });

  await t.test('the prompt asks for the object shape and forbids authoring', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '[]', status: 0 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.select('source-1', 'some source text');

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.match(prompt, /corrections/);
    assert.match(prompt, /"before"/);
    assert.match(prompt, /"after"/);
    assert.match(prompt, /paraphrase/i);
  });

  await t.test('throws when the fake spawn reports a non-zero exit', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '', status: 1 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(
      () => model.select('source-1', 'some source text'),
      /exited with status 1/
    );
  });

  await t.test('QUOTE_MINER_MODEL_CMD selects the tolerant path with empty default args', async () => {
    const previous = process.env.QUOTE_MINER_MODEL_CMD;
    process.env.QUOTE_MINER_MODEL_CMD = FAKE_COMMAND;
    try {
      const fakeSpawn = makeFakeSpawn({ stdout: '["a quote"]', status: 0 });
      const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

      assert.deepEqual(await model.select('source-1', 'text'), [{ text: 'a quote', corrections: [] }]);
      assert.equal(fakeSpawn.calls[0].command, FAKE_COMMAND);
      assert.deepEqual(fakeSpawn.calls[0].args, []);
      assert.equal(model.id, basename(FAKE_COMMAND));
    } finally {
      if (previous === undefined) {
        delete process.env.QUOTE_MINER_MODEL_CMD;
      } else {
        process.env.QUOTE_MINER_MODEL_CMD = previous;
      }
    }
  });
});

// The exact production failure this change exists to fix: over a 123-source OCR corpus
// the model hand-wrote a JSON array in prose and, on French text dense with guillemets
// and typographic quotes, emitted a text value it never closed. JSON.parse threw and the
// adapter died immediately, discarding 58 already-mined sources.
test('claudeModel: regression — unterminated string in a hand-written prose array', async (t) => {
  const MALFORMED =
    '[{"text": "Nous gardons espoir plus que jamais », "corrections": []}]';

  await t.test('tolerant path retries the malformed response, then throws (never silently succeeds)', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: MALFORMED, status: 0 });
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await assert.rejects(
      () => model.select('depeche-59', 'Il a dit : « L’avenir est à nous ».'),
      /after 3 attempt/
    );
    assert.equal(fakeSpawn.calls.length, 3, 'expected the malformed response to be retried');
  });

  await t.test('a transiently malformed response recovers on the retry', async () => {
    const fakeSpawn = makeSequencedSpawn([
      { status: 0, stdout: MALFORMED },
      { status: 0, stdout: JSON.stringify([{ text: 'Nous gardons espoir', corrections: [] }]) },
    ]);
    const model = claudeModel({ command: FAKE_COMMAND, spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.deepEqual(await model.select('depeche-59', 'text'), [
      { text: 'Nous gardons espoir', corrections: [] },
    ]);
    assert.equal(fakeSpawn.calls.length, 2);
  });

  await t.test('the structured default path does not hand-write JSON at all', async () => {
    // Same guillemet-dense passage, delivered through the CLI envelope: the CLI, not the
    // model's prose, owns the JSON encoding, so quoting can no longer corrupt the payload.
    const passage = 'Nous gardons espoir plus que jamais »';
    const fakeSpawn = makeFakeSpawn({
      stdout: structuredEnvelope([{ text: passage, corrections: [] }]),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    assert.deepEqual(await model.select('depeche-59', 'text'), [
      { text: passage, corrections: [] },
    ]);
  });
});

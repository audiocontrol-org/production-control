import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { basename } from 'node:path';
import { claudeModel } from '../src/claude.mjs';

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

test('claudeModel: id (AUDIT-21 provenance)', async (t) => {
  await t.test('default options, no env override -> id is "claude"', () => {
    const model = claudeModel({ spawnImpl: makeFakeSpawn() });
    assert.equal(model.id, 'claude');
  });

  await t.test('options.command WITHOUT env override -> id is the basename of that command (regression guard)', () => {
    const fakeCommand = path.join('/opt', 'alt-tools', 'not-claude-binary');
    const model = claudeModel({
      command: fakeCommand,
      spawnImpl: makeFakeSpawn(),
    });
    assert.equal(model.id, basename(fakeCommand));
    assert.notEqual(model.id, 'claude');
  });

  await t.test('QUOTE_MINER_MODEL_ID env var takes precedence over basename', () => {
    const previous = process.env.QUOTE_MINER_MODEL_ID;
    process.env.QUOTE_MINER_MODEL_ID = 'claude-opus-4';
    try {
      const model = claudeModel({
        command: '/opt/alt-tools/not-claude-binary',
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
      command: '/opt/alt-tools/not-claude-binary',
      modelId: 'claude-sonnet-5',
      spawnImpl: makeFakeSpawn(),
    });
    assert.equal(model.id, 'claude-sonnet-5');
  });
});

test('claudeModel: select() via injected fake spawn', async (t) => {
  await t.test('normalizes a plain-string array to the candidate object shape', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: '["a quote", "another quote"]',
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn });

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
    const model = claudeModel({ spawnImpl: fakeSpawn });

    const result = await model.select('source-1', 'some source text');

    assert.deepEqual(result, [
      { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
      { text: 'a clean passage', corrections: [] },
      { text: 'a bare string candidate', corrections: [] },
    ]);
  });

  await t.test('throws on a candidate that is neither string nor {text}', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '[{"corrections": []}]', status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn });

    await assert.rejects(() => model.select('source-1', 'text'), /candidate/i);
  });

  await t.test('throws on a malformed correction entry', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify([{ text: 'passage', corrections: [{ before: 5, after: 'x' }] }]),
      status: 0,
    });
    const model = claudeModel({ spawnImpl: fakeSpawn });

    await assert.rejects(() => model.select('source-1', 'text'), /correction/i);
  });

  await t.test('the prompt asks for the object shape and forbids authoring', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '[]', status: 0 });
    const model = claudeModel({ spawnImpl: fakeSpawn });

    await model.select('source-1', 'some source text');

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.match(prompt, /corrections/);
    assert.match(prompt, /"before"/);
    assert.match(prompt, /"after"/);
    assert.match(prompt, /paraphrase/i);
  });

  await t.test('throws when the fake spawn reports a non-zero exit', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: '', status: 1 });
    const model = claudeModel({ spawnImpl: fakeSpawn });

    await assert.rejects(
      () => model.select('source-1', 'some source text'),
      /exited with status 1/
    );
  });
});

// The SUBAGENT FAN-OUT model adapter (src/claude-agent.mjs).
//
// WHY IT EXISTS: the per-source adapter (src/claude.mjs) spawns ONE `claude -p` per
// source, and every invocation rebuilds Claude Code's system prompt and tool definitions
// — measured at 15,667-37,788 `cache_creation_input_tokens` for even a trivial prompt.
// Over a 123-source corpus that setup cost is paid 123 times. It also pushes each
// source's full text through the prompt (a 6.9 MB corpus).
//
// This adapter spawns ONE `claude` invocation for a whole BATCH of sources and asks it to
// dispatch one subagent per source (Task) that READS its own file (Read). The setup cost
// is paid once per batch, and source text never travels through the prompt — only paths.
//
// Every test here injects a fake spawn. No real `claude` process is ever launched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAgentModel } from '../src/claude-agent.mjs';

/** The batch every test asks for unless it says otherwise. */
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

/** Every requested source answered with zero candidates (a legitimate, explicit answer). */
function emptyFor(sources) {
  return sources.map((s) => ({ id: s.id, candidates: [] }));
}

test('claudeAgentModel: argv speaks the agent fan-out protocol', async (t) => {
  await t.test('spawns ONE invocation for the whole batch', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    assert.equal(fakeSpawn.calls.length, 1, 'a batch is exactly one subprocess');
    assert.equal(fakeSpawn.calls[0].command, 'claude');
  });

  await t.test('builds -p --output-format json --json-schema <inline> --allowedTools Read Task', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    const { args } = fakeSpawn.calls[0];
    assert.ok(args.includes('-p'), `expected -p in argv: ${JSON.stringify(args)}`);

    const formatIdx = args.indexOf('--output-format');
    assert.notEqual(formatIdx, -1, `expected --output-format in argv: ${JSON.stringify(args)}`);
    assert.equal(args[formatIdx + 1], 'json');

    const schemaIdx = args.indexOf('--json-schema');
    assert.notEqual(schemaIdx, -1, `expected --json-schema in argv: ${JSON.stringify(args)}`);

    const toolsIdx = args.indexOf('--allowedTools');
    assert.notEqual(toolsIdx, -1, `expected --allowedTools in argv: ${JSON.stringify(args)}`);
    // Read (a subagent reads its own file) and Task (the fan-out itself) are the whole
    // point of this adapter; without them the run cannot work at all.
    assert.deepEqual(args.slice(toolsIdx + 1, toolsIdx + 3), ['Read', 'Task']);
  });

  await t.test('the schema is INLINE and covers per-source candidates AND corrections', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    const { args } = fakeSpawn.calls[0];
    // A file path is rejected by the CLI ("--json-schema is not valid JSON"), so this
    // must parse as JSON text.
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);

    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['sources']);

    const entry = schema.properties.sources.items;
    assert.deepEqual(entry.required, ['id', 'candidates']);
    assert.equal(entry.properties.id.type, 'string');

    const candidate = entry.properties.candidates.items;
    assert.deepEqual(candidate.required, ['text', 'corrections']);
    assert.equal(candidate.properties.text.type, 'string');
    assert.deepEqual(candidate.properties.corrections.items.required, ['before', 'after']);
  });
});

test('claudeAgentModel: the prompt carries PATHS, never source text', async (t) => {
  await t.test('names every source id and path', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    const prompt = fakeSpawn.calls[0].opts.input;
    for (const source of SOURCES) {
      assert.ok(prompt.includes(source.id), `prompt should name ${source.id}`);
      assert.ok(prompt.includes(source.path), `prompt should name ${source.path}`);
    }
  });

  await t.test('does NOT contain the source text (that is the entire cost saving)', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    // The adapter is never handed text — but assert on a distinctive string anyway, so a
    // future refactor that starts inlining file contents fails here.
    await model.selectBatch(SOURCES);

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.ok(
      !prompt.includes('SOURCE_TEXT_MARKER'),
      'the batch prompt must never carry source text'
    );
    assert.ok(
      prompt.length < 8000,
      `the batch prompt should stay small (instructions + paths); got ${prompt.length} chars`
    );
  });

  await t.test('instructs a subagent per source that READS the file itself', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.match(prompt, /Task/, 'the fan-out tool must be named');
    assert.match(prompt, /Read/, 'the subagent must be told to read its own file');
    assert.match(prompt, /subagent/i);
  });

  await t.test('carries the same fidelity and corrections rules as the per-source adapter', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    await model.selectBatch(SOURCES);

    const prompt = fakeSpawn.calls[0].opts.input;
    assert.match(prompt, /EXACTLY/);
    assert.match(prompt, /OCR/);
    assert.match(prompt, /corrections/);
    assert.match(prompt, /"before"/);
    assert.match(prompt, /"after"/);
    assert.match(prompt, /paraphrase/i);
  });
});

test('claudeAgentModel: parses a well-formed batch envelope', async (t) => {
  await t.test('returns a Map of source id -> candidates, including corrections', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([
        {
          id: 'PB-P001',
          candidates: [
            { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
            { text: 'a clean passage', corrections: [] },
          ],
        },
        { id: 'PB-P002', candidates: [{ text: 'another passage', corrections: [] }] },
      ]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.selectBatch(SOURCES);

    assert.ok(result instanceof Map, 'selectBatch resolves to a Map keyed by source id');
    assert.deepEqual([...result.keys()], ['PB-P001', 'PB-P002']);
    assert.deepEqual(result.get('PB-P001'), [
      { text: 'arrested m this city', corrections: [{ before: ' m ', after: ' in ' }] },
      { text: 'a clean passage', corrections: [] },
    ]);
    assert.deepEqual(result.get('PB-P002'), [{ text: 'another passage', corrections: [] }]);
  });

  await t.test('an explicitly empty candidate list is accepted (a real answer)', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: batchEnvelope(emptyFor(SOURCES)) });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.selectBatch(SOURCES);

    assert.deepEqual(result.get('PB-P001'), []);
    assert.deepEqual(result.get('PB-P002'), []);
  });

  await t.test('a legacy plain-string candidate normalizes to zero corrections', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([
        { id: 'PB-P001', candidates: ['a bare string passage'] },
        { id: 'PB-P002', candidates: [] },
      ]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.selectBatch(SOURCES);

    assert.deepEqual(result.get('PB-P001'), [{ text: 'a bare string passage', corrections: [] }]);
  });

  await t.test('an empty batch never spawns anything', async () => {
    const fakeSpawn = makeFakeSpawn();
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0 });

    const result = await model.selectBatch([]);

    assert.equal(result.size, 0);
    assert.equal(fakeSpawn.calls.length, 0, 'nothing to ask about, nothing to spawn');
  });
});

test('claudeAgentModel: FAIL LOUD (never a fabricated "nothing quotable")', async (t) => {
  await t.test('missing structured_output throws naming it', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ is_error: false, result: '{"sources":[]}' }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /structured_output/);
  });

  await t.test('a non-JSON envelope throws', async () => {
    const fakeSpawn = makeFakeSpawn({ stdout: 'I am afraid I cannot do that.' });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /envelope/i);
  });

  await t.test('is_error: true throws', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({
        is_error: true,
        result: 'Error: rate limited',
        structured_output: { sources: [] },
      }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /is_error/);
  });

  await t.test("structured_output.sources that is not an array throws naming it", async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: JSON.stringify({ structured_output: { sources: 'nope' } }),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /structured_output\.sources/);
  });

  await t.test('an UNREQUESTED source id in the response throws naming it', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([
        ...emptyFor(SOURCES),
        { id: 'PB-P999', candidates: [{ text: 'from nowhere', corrections: [] }] },
      ]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), (err) => {
      assert.match(err.message, /PB-P999/);
      assert.match(err.message, /not requested/i);
      return true;
    });
  });

  await t.test('a REQUESTED source ABSENT from the response throws naming it (TASK-15)', async () => {
    // The decision this test pins: a requested source the model never answered for is a
    // FAILURE, not "nothing quotable". Returning it as an empty list would write the
    // claim "this source has nothing worth quoting" into the bank on the strength of a
    // dropped subagent — the exact false-clean TASK-15 documents, where a quarter of a
    // 123-source corpus vanished while the run reported success.
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([{ id: 'PB-P001', candidates: [{ text: 'a passage', corrections: [] }] }]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), (err) => {
      assert.match(err.message, /PB-P002/);
      assert.match(err.message, /missing/i);
      return true;
    });
  });

  await t.test('a duplicated source id in the response throws', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([
        { id: 'PB-P001', candidates: [] },
        { id: 'PB-P001', candidates: [{ text: 'again', corrections: [] }] },
        { id: 'PB-P002', candidates: [] },
      ]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /duplicate/i);
  });

  await t.test('a candidate that is neither string nor {text} throws', async () => {
    const fakeSpawn = makeFakeSpawn({
      stdout: batchEnvelope([
        { id: 'PB-P001', candidates: [{ corrections: [] }] },
        { id: 'PB-P002', candidates: [] },
      ]),
    });
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(() => model.selectBatch(SOURCES), /candidate/i);
  });

  await t.test('a source entry lacking a path throws BEFORE any spawn', async () => {
    const fakeSpawn = makeFakeSpawn();
    const model = claudeAgentModel({ spawnImpl: fakeSpawn, retryDelayMs: 0, maxAttempts: 1 });

    await assert.rejects(
      () => model.selectBatch([{ id: 'PB-P001' }]),
      (err) => {
        assert.match(err.message, /PB-P001/);
        assert.match(err.message, /path/);
        return true;
      }
    );
    assert.equal(fakeSpawn.calls.length, 0, 'a malformed batch must not reach the CLI');
  });
});

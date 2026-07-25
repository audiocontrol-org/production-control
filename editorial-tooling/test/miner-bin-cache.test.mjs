// The RESUMABILITY surface an operator actually sees: bin/quote-miner.mjs with
// `QUOTE_MINER_CACHE_DIR` set.
//
// The bin is where a resumed run stops being an implementation detail and becomes a claim
// about provenance, so three things are pinned here:
//   1. A resumed run makes ZERO model calls and still writes the same bank.
//   2. The stderr report and the per-source progress lines SAY the run was resumed —
//      otherwise a suspiciously fast run is indistinguishable from a run that did less.
//   3. `tool.version` reports the model identity HONESTLY: the cached identity when the run
//      was served from cache, and an explicitly `mixed(...)` tag when identities differ.
//      It never picks one identity and implies the bank came from a single model.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(thisDir, '..', 'bin', 'quote-miner.mjs');

/**
 * A stand-in model binary that answers with one grounded candidate and APPENDS the prompt
 * it received to `callLog`, so a test can count how many times the model was really called.
 */
function writeFakeModel(dir, { callLog, candidate }) {
  const modelPath = path.join(dir, 'fake-model.mjs');
  fs.writeFileSync(
    modelPath,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs';",
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      `  appendFileSync(${JSON.stringify(callLog)}, 'call\\n');`,
      `  process.stdout.write(JSON.stringify([${JSON.stringify(candidate)}]));`,
      '});',
      '',
    ].join('\n'),
    'utf8'
  );
  fs.chmodSync(modelPath, 0o755);
  return modelPath;
}

/** How many times the fake model was spawned. */
function callCount(callLog) {
  if (!fs.existsSync(callLog)) return 0;
  return fs.readFileSync(callLog, 'utf8').split('\n').filter((line) => line === 'call').length;
}

/** Build a corpus + output dir + BuildRequest, and run the bin against it. */
function makeWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-bin-cache-'));
  const sourcesDir = path.join(tmpDir, 'sources');
  const outputDir = path.join(tmpDir, 'output');
  const cacheDir = path.join(tmpDir, 'cache');
  fs.mkdirSync(sourcesDir);
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(sourcesDir, 'alpha.txt'), 'Duty is ours.\n', 'utf8');
  fs.writeFileSync(path.join(sourcesDir, 'beta.txt'), 'Duty is ours.\nAnd more.\n', 'utf8');
  const request = JSON.stringify({
    version: 1,
    target: 'quote-bank',
    inputs: { sources: { path: sourcesDir, hash: 'sha256:abc123' } },
    output_dir: outputDir,
  });
  return { tmpDir, sourcesDir, outputDir, cacheDir, request };
}

function runMiner({ request, env }) {
  return spawnSync(process.execPath, [binPath], {
    input: request,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('quote-miner bin: a resumed run is disclosed, not disguised', async (t) => {
  await t.test('second run makes no model calls and reports the sources as cached', () => {
    const { tmpDir, outputDir, cacheDir, request } = makeWorkspace();
    const callLog = path.join(tmpDir, 'calls.log');
    const modelPath = writeFakeModel(tmpDir, { callLog, candidate: 'Duty is ours.' });
    const env = {
      QUOTE_MINER_MODEL_CMD: modelPath,
      QUOTE_MINER_CACHE_DIR: cacheDir,
      QUOTE_MINER_MODEL_ID: 'fake-model-v1',
    };

    const first = runMiner({ request, env });
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`);
    assert.equal(callCount(callLog), 2, 'the first run mines both sources');
    assert.match(first.stderr, /^sources_from_cache: 0$/m);

    const bankAfterFirst = fs.readFileSync(path.join(outputDir, 'quote-bank.yaml'), 'utf8');

    const second = runMiner({ request, env });
    assert.equal(second.status, 0, `second run failed: ${second.stderr}`);
    assert.equal(callCount(callLog), 2, 'the resumed run must not spawn the model again');

    assert.match(second.stderr, /^sources_from_cache: 2$/m);
    assert.match(second.stderr, /^cached_sources: alpha, beta$/m);
    assert.match(second.stderr, /^cache_entries_ignored: 0$/m);
    assert.equal(fs.readFileSync(path.join(outputDir, 'quote-bank.yaml'), 'utf8'), bankAfterFirst);
  });

  await t.test('per-source progress lines mark which sources came from cache', () => {
    const { tmpDir, cacheDir, request } = makeWorkspace();
    const callLog = path.join(tmpDir, 'calls.log');
    const modelPath = writeFakeModel(tmpDir, { callLog, candidate: 'Duty is ours.' });
    const env = { QUOTE_MINER_MODEL_CMD: modelPath, QUOTE_MINER_CACHE_DIR: cacheDir };

    const first = runMiner({ request, env });
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`);
    for (const line of first.stderr.split('\n').filter((l) => l.startsWith('progress:'))) {
      assert.doesNotMatch(line, /cache=/, `a freshly mined source carries no cache marker: ${line}`);
    }

    const second = runMiner({ request, env });
    assert.equal(second.status, 0, `second run failed: ${second.stderr}`);
    const resumedLines = second.stderr.split('\n').filter((l) => l.startsWith('progress:'));
    assert.equal(resumedLines.length, 2);
    for (const line of resumedLines) {
      assert.match(line, /cache=hit/, `expected a resumed run's progress to say hit: ${line}`);
    }
  });

  await t.test('tool.version reports the CACHED identity on a fully cached run', () => {
    const { tmpDir, cacheDir, request } = makeWorkspace();
    const callLog = path.join(tmpDir, 'calls.log');
    const modelPath = writeFakeModel(tmpDir, { callLog, candidate: 'Duty is ours.' });

    const first = runMiner({
      request,
      env: {
        QUOTE_MINER_MODEL_CMD: modelPath,
        QUOTE_MINER_CACHE_DIR: cacheDir,
        QUOTE_MINER_MODEL_ID: 'model-one',
      },
    });
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`);
    assert.equal(JSON.parse(first.stdout).tool.version, '0.1.0+model-one');

    // The second run is served entirely from cache, so `model-two` never produced a single
    // byte of this bank. Stamping it would be a lie about provenance.
    const second = runMiner({
      request,
      env: {
        QUOTE_MINER_MODEL_CMD: modelPath,
        QUOTE_MINER_CACHE_DIR: cacheDir,
        QUOTE_MINER_MODEL_ID: 'model-two',
      },
    });
    assert.equal(second.status, 0, `second run failed: ${second.stderr}`);
    assert.equal(JSON.parse(second.stdout).tool.version, '0.1.0+model-one');
    assert.match(second.stderr, /^model_identities: model-one$/m);
  });

  await t.test('mixed identities are stamped as mixed(...) and shouted on stderr', () => {
    const { tmpDir, sourcesDir, cacheDir, request } = makeWorkspace();
    const callLog = path.join(tmpDir, 'calls.log');
    const modelPath = writeFakeModel(tmpDir, { callLog, candidate: 'Duty is ours.' });

    // Prime the cache with ONLY the first source, under model-one.
    const partialRequest = JSON.parse(request);
    const partialDir = path.join(tmpDir, 'partial');
    fs.mkdirSync(partialDir);
    fs.copyFileSync(path.join(sourcesDir, 'alpha.txt'), path.join(partialDir, 'alpha.txt'));
    partialRequest.inputs.sources.path = partialDir;
    const priming = runMiner({
      request: JSON.stringify(partialRequest),
      env: {
        QUOTE_MINER_MODEL_CMD: modelPath,
        QUOTE_MINER_CACHE_DIR: cacheDir,
        QUOTE_MINER_MODEL_ID: 'model-one',
      },
    });
    assert.equal(priming.status, 0, `priming run failed: ${priming.stderr}`);

    // Now mine the whole corpus under model-two: alpha is cached, beta is fresh.
    const mixed = runMiner({
      request,
      env: {
        QUOTE_MINER_MODEL_CMD: modelPath,
        QUOTE_MINER_CACHE_DIR: cacheDir,
        QUOTE_MINER_MODEL_ID: 'model-two',
      },
    });
    assert.equal(mixed.status, 0, `mixed run failed: ${mixed.stderr}`);
    assert.match(mixed.stderr, /^sources_from_cache: 1$/m);
    assert.match(mixed.stderr, /^model_identities: model-one, model-two$/m);
    assert.match(
      mixed.stderr,
      /WARNING: this bank was built from 2 different model identities/,
      'a mixed-provenance bank must be loud, not merely recorded'
    );
    assert.equal(JSON.parse(mixed.stdout).tool.version, '0.1.0+mixed(model-one+model-two)');
  });

  await t.test('without QUOTE_MINER_CACHE_DIR nothing is cached and no directory appears', () => {
    const { tmpDir, cacheDir, request } = makeWorkspace();
    const callLog = path.join(tmpDir, 'calls.log');
    const modelPath = writeFakeModel(tmpDir, { callLog, candidate: 'Duty is ours.' });
    const env = { QUOTE_MINER_MODEL_CMD: modelPath, QUOTE_MINER_CACHE_DIR: '' };

    const first = runMiner({ request, env });
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`);
    const second = runMiner({ request, env });
    assert.equal(second.status, 0, `second run failed: ${second.stderr}`);

    assert.equal(callCount(callLog), 4, 'every run re-mines when no cache is configured');
    assert.equal(fs.existsSync(cacheDir), false, 'no cache directory is invented');
    assert.match(second.stderr, /^sources_from_cache: 0$/m);
  });
});

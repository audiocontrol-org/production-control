// STRATEGY SELECTION at the bin (`QUOTE_MINER_STRATEGY`).
//
// The miner now has two model adapters with very different cost profiles and very
// different portability, so which one runs is an explicit operator choice rather than an
// implicit one. These tests drive bin/quote-miner.mjs end to end against a STAND-IN
// binary named `claude` — never the real CLI — and check that:
//
//   * the default is still `per-source` (the portable seam);
//   * `agent` really takes the batch path, passing PATHS and mining every source;
//   * an unrecognized strategy fails loud instead of quietly picking one.
//
// The stand-in is named `claude` on purpose: both adapters key their protocol off the
// command basename, so a differently named binary would be talking a different protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Delimits one recorded prompt from the next in the stand-in's log. Deliberately free of
// escape sequences so it survives every layer of quoting between here and the stand-in.
const PROMPT_SEPARATOR = '@@QUOTE-MINER-PROMPT-END@@';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(thisDir, '..', 'bin', 'quote-miner.mjs');

const LINES = {
  'doc-a': 'Alpha is a quotable line.',
  'doc-b': 'Beta is a quotable line.',
  'doc-c': 'Gamma is a quotable line.',
};

/**
 * Lay out a corpus, an output dir, and a stand-in `claude` that answers with `responder`
 * (a JS expression, evaluated in the stand-in with `prompt` in scope, that yields the
 * stdout string).
 */
function makeFixture(responder) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-strategy-'));
  const sourcesDir = path.join(tmpDir, 'sources');
  const outputDir = path.join(tmpDir, 'output');
  fs.mkdirSync(sourcesDir);
  fs.mkdirSync(outputDir);
  for (const [id, line] of Object.entries(LINES)) {
    fs.writeFileSync(path.join(sourcesDir, `${id}.txt`), `${line}\n`, 'utf8');
  }

  // The stand-in records every prompt it is given, so a test can prove what did (and did
  // not) cross the process boundary.
  const promptLog = path.join(tmpDir, 'prompts.log');
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir);
  const standIn = path.join(binDir, 'claude');
  // Extensionless, so Node loads it as CommonJS — `require`, not `import`.
  fs.writeFileSync(
    standIn,
    [
      '#!/usr/bin/env node',
      "const fs = require('fs');",
      "let prompt = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { prompt += chunk; });",
      "process.stdin.on('end', () => {",
      `  fs.appendFileSync(${JSON.stringify(promptLog)}, prompt + ${JSON.stringify(PROMPT_SEPARATOR)});`,
      `  process.stdout.write(${responder});`,
      '});',
    ].join('\n'),
    'utf8'
  );
  fs.chmodSync(standIn, 0o755);

  const request = {
    version: 1,
    target: 'quote-bank',
    inputs: { sources: { path: sourcesDir, hash: 'sha256:abc123' } },
    output_dir: outputDir,
  };

  return { tmpDir, sourcesDir, outputDir, standIn, promptLog, request };
}

/** Every prompt the stand-in saw, in order. */
function readPrompts(promptLog) {
  if (!fs.existsSync(promptLog)) return [];
  return fs
    .readFileSync(promptLog, 'utf8')
    .split(PROMPT_SEPARATOR)
    .filter((entry) => entry.trim() !== '');
}

function runMiner({ request, standIn, env = {} }) {
  return spawnSync(process.execPath, [binPath], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: { ...process.env, QUOTE_MINER_MODEL_CMD: standIn, ...env },
  });
}

test('quote-miner bin: QUOTE_MINER_STRATEGY selects the model adapter', async (t) => {
  await t.test('default is per-source: one invocation per source, text IN the prompt', () => {
    // A structured single-source envelope: whatever line the prompt contains is selected.
    const responder =
      "JSON.stringify({ is_error: false, modelUsage: { 'claude-opus-5': { outputTokens: 1, canonicalModel: 'claude-opus-5' } }, structured_output: { candidates: [{ text: /^(\\w+) is a quotable line\\.$/m.exec(prompt)[0], corrections: [] }] } })";
    const fx = makeFixture(responder);
    try {
      const result = runMiner(fx);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);

      const prompts = readPrompts(fx.promptLog);
      assert.equal(prompts.length, 3, 'the per-source path spawns once per source');
      // The per-source adapter's defining cost: the source text travels through the prompt.
      assert.ok(
        prompts.some((p) => p.includes(LINES['doc-a'])),
        'per-source prompts carry the source text'
      );

      const bank = parseYaml(fs.readFileSync(path.join(fx.outputDir, 'quote-bank.yaml'), 'utf8'));
      assert.deepEqual(bank.quotes.map((q) => q.source), ['doc-a', 'doc-b', 'doc-c']);
    } finally {
      fs.rmSync(fx.tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('agent: ONE invocation for the batch, PATHS in the prompt, never text', () => {
    // A batch envelope: answer every id the prompt names, reading the line back out of the
    // file the prompt pointed at — which is exactly what a subagent would do.
    const responder =
      "JSON.stringify({ is_error: false, num_turns: 8, usage: { cache_creation_input_tokens: 1234 }, modelUsage: { 'claude-opus-5': { outputTokens: 1, canonicalModel: 'claude-opus-5' } }, structured_output: { sources: [...prompt.matchAll(/- id: (\\S+)\\n  path: (\\S+)/g)].map(([, id, p]) => ({ id, candidates: [{ text: fs.readFileSync(p, 'utf8').trim(), corrections: [] }] })) } })";
    const fx = makeFixture(responder);
    try {
      const result = runMiner({ ...fx, env: { QUOTE_MINER_STRATEGY: 'agent' } });
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);

      const prompts = readPrompts(fx.promptLog);
      assert.equal(prompts.length, 1, 'the whole corpus fits one chunk at the default size');

      // The cost saving, asserted: paths cross the boundary, source text does not.
      assert.ok(prompts[0].includes(path.join(fx.sourcesDir, 'doc-a.txt')), 'the prompt names paths');
      for (const line of Object.values(LINES)) {
        assert.ok(!prompts[0].includes(line), `the batch prompt must not carry source text: ${line}`);
      }

      const bank = parseYaml(fs.readFileSync(path.join(fx.outputDir, 'quote-bank.yaml'), 'utf8'));
      assert.deepEqual(bank.quotes.map((q) => q.source), ['doc-a', 'doc-b', 'doc-c']);
      assert.deepEqual(bank.quotes.map((q) => q.text), Object.values(LINES));

      // Cost accounting is disclosed on stderr — the whole point of this strategy.
      assert.match(result.stderr, /batch-usage: sources=3 .*cache_creation_input_tokens=1234/);
      // Progress stays PER SOURCE even though the model call was per batch.
      assert.equal((result.stderr.match(/^progress: /gm) ?? []).length, 3);
      // The real model identity still reaches the BuildResponse.
      assert.match(JSON.parse(result.stdout).tool.version, /claude-opus-5$/);
    } finally {
      fs.rmSync(fx.tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('QUOTE_MINER_CHUNK_SIZE splits the batch', () => {
    const responder =
      "JSON.stringify({ is_error: false, structured_output: { sources: [...prompt.matchAll(/- id: (\\S+)\\n  path: (\\S+)/g)].map(([, id, p]) => ({ id, candidates: [{ text: fs.readFileSync(p, 'utf8').trim(), corrections: [] }] })) } })";
    const fx = makeFixture(responder);
    try {
      const result = runMiner({
        ...fx,
        env: { QUOTE_MINER_STRATEGY: 'agent', QUOTE_MINER_CHUNK_SIZE: '2', QUOTE_MINER_CONCURRENCY: '1' },
      });
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.equal(readPrompts(fx.promptLog).length, 2, 'three sources at chunk size 2 -> 2 calls');

      const bank = parseYaml(fs.readFileSync(path.join(fx.outputDir, 'quote-bank.yaml'), 'utf8'));
      assert.deepEqual(bank.quotes.map((q) => q.source), ['doc-a', 'doc-b', 'doc-c']);
    } finally {
      fs.rmSync(fx.tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('an unknown strategy fails loud and writes no bank', () => {
    const fx = makeFixture("JSON.stringify({ is_error: false, structured_output: { sources: [] } })");
    try {
      const result = runMiner({ ...fx, env: { QUOTE_MINER_STRATEGY: 'telepathy' } });

      assert.notEqual(result.status, 0, 'an unknown strategy must not be quietly ignored');
      assert.match(result.stderr, /telepathy/);
      assert.match(result.stderr, /per-source/);
      assert.ok(
        !fs.existsSync(path.join(fx.outputDir, 'quote-bank.yaml')),
        'no bank may be written for a refused run'
      );
      assert.equal(readPrompts(fx.promptLog).length, 0, 'no model call may be made');
    } finally {
      fs.rmSync(fx.tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('agent: a source the model never answers for FAILS the run (TASK-15)', () => {
    // The stand-in drops doc-b from every answer. The run must fail rather than record
    // doc-b as a source with nothing quotable.
    const responder =
      "JSON.stringify({ is_error: false, structured_output: { sources: [...prompt.matchAll(/- id: (\\S+)\\n  path: (\\S+)/g)].filter(([, id]) => id !== 'doc-b').map(([, id, p]) => ({ id, candidates: [{ text: fs.readFileSync(p, 'utf8').trim(), corrections: [] }] })) } })";
    const fx = makeFixture(responder);
    try {
      const result = runMiner({ ...fx, env: { QUOTE_MINER_STRATEGY: 'agent' } });

      assert.notEqual(result.status, 0, 'a dropped source must fail the run');
      assert.match(result.stderr, /doc-b/);
      assert.ok(
        !fs.existsSync(path.join(fx.outputDir, 'quote-bank.yaml')),
        'a failed run writes no bank (FR-015/FR-016)'
      );
    } finally {
      fs.rmSync(fx.tmpDir, { recursive: true, force: true });
    }
  });
});

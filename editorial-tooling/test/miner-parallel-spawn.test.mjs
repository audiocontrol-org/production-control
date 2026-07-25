// The model call must be NON-BLOCKING (TASK-11).
//
// Bounded concurrency in the miner buys nothing if the model adapter blocks the event
// loop while the subprocess runs: the pool would dutifully start four "concurrent" calls
// that still execute one after another. This is the end-to-end check that a real
// subprocess model actually overlaps — the only test here that measures wall clock, with a
// margin wide enough that it fails on serialization, not on a busy machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mine } from '../src/miner.mjs';
import { claudeModel } from '../src/claude.mjs';

const SHARED_LINE = 'A shared quotable line.';
const CHILD_DELAY_MS = 400;
const SOURCE_COUNT = 4;

test('miner: concurrent model subprocesses actually overlap (TASK-11)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-par-'));
  try {
    // A stand-in model that takes a known amount of wall clock per call. Serialized, four
    // of these cost >= 1600ms; overlapped at concurrency 4 they cost a little over one.
    const scriptPath = path.join(tmpDir, 'slow-model.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        'import { setTimeout as delay } from "node:timers/promises";',
        'process.stdin.resume();',
        'process.stdin.on("data", () => {});',
        'process.stdin.on("end", async () => {',
        `  await delay(${CHILD_DELAY_MS});`,
        `  process.stdout.write(JSON.stringify([${JSON.stringify(SHARED_LINE)}]));`,
        '});'
      ].join('\n'),
      'utf8'
    );

    const sources = [];
    for (let i = 0; i < SOURCE_COUNT; i++) {
      sources.push({ id: `s-${i}`, bytes: Buffer.from(`${SHARED_LINE}\n`, 'utf8') });
    }

    const model = claudeModel({ command: process.execPath, args: [scriptPath] });

    const startedAt = Date.now();
    const { bank } = await mine({ sources, model, concurrency: SOURCE_COUNT });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(bank.quotes.length, SOURCE_COUNT, 'every source should ground its line');

    const serialFloorMs = CHILD_DELAY_MS * SOURCE_COUNT;
    assert.ok(
      elapsedMs < serialFloorMs,
      `model calls did not overlap: ${elapsedMs}ms is at or beyond the ${serialFloorMs}ms ` +
        'serial floor, so the adapter is blocking the event loop'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

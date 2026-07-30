// FG-B / D1 (AUDIT-11/12/19) + D7 (AUDIT-20): the producer PRE-EMIT self-check
// refuses loudly and writes NOTHING when a compose model output declares an
// illegal `cut` / `verbatim` op, or declares an EMPTY grounding array. These are
// the value-channel cases the compose preflight previously dropped: it filtered
// op-legality failures down to `whole-unit-copy` only, so `compose-forbids-cut`
// and `compose-forbids-verbatim` slipped through and an illegal-op edition got
// WRITTEN (contracts/voice-compose-cli.md "Producer pre-emit self-check";
// Principle V -- a refused compose leaves no partial edition behind).
//
// Drives the REAL `voice-compose` binary end-to-end (mirrors
// `test/compose-preflight-no-copy.int.test.ts`). Each case must exit non-zero,
// name the violation on stderr, and leave `output_dir` with no edition written.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixturePath } from './support.ts';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPOSE_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-compose.mjs');
const SPINE_PATH = fixturePath('spine', 'minimal-spine.md');
const VOICE_PATH = fixturePath('spine', 'compose-voice.md');

function sha256Of(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

interface ComposeAttempt {
  status: number | null;
  stdout: string;
  stderr: string;
  editionExists: boolean;
  outputDirEntries: string[];
}

/** Spawn the real compose binary with `runnerFixture` as the model command. */
function runCompose(runnerFixture: string): ComposeAttempt {
  const spineBytes = fs.readFileSync(SPINE_PATH);
  const voiceBytes = fs.readFileSync(VOICE_PATH);
  const runner = fixturePath('spine', runnerFixture);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-compose-illegal-op-'));
  try {
    const outputDir = path.join(tmpBase, 'out');
    const request = {
      version: 1,
      target: 'edition',
      inputs: {
        source: { path: SPINE_PATH, hash: sha256Of(spineBytes) },
        voice: { path: VOICE_PATH, hash: sha256Of(voiceBytes) },
      },
      output_dir: outputDir,
    };
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VOICE_REVISE_MODEL: `node --import tsx ${runner}`,
    };
    const result = spawnSync(process.execPath, [COMPOSE_BIN], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      env,
    });
    const editionPath = path.join(outputDir, 'edition.md');
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      editionExists: fs.existsSync(editionPath),
      outputDirEntries: fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [],
    };
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

function assertRefusedNoWrite(attempt: ComposeAttempt, namePattern: RegExp): void {
  assert.notEqual(attempt.status, 0, `expected a non-zero exit; stdout: ${attempt.stdout}`);
  assert.equal(attempt.stdout, '', 'a refused compose must write NO BuildResponse to stdout');
  assert.match(attempt.stderr, namePattern, `the refusal must name the violation; stderr: ${attempt.stderr}`);
  assert.equal(attempt.editionExists, false, 'a refused compose must write NO edition file');
  assert.deepEqual(
    attempt.outputDirEntries,
    [],
    `output_dir must contain no written artifact; found: ${attempt.outputDirEntries.join(', ')}`,
  );
}

test('voice compose (D1): a model declaring op "cut" is REFUSED pre-emit -- non-zero exit, forbidden op named, NO edition written', () => {
  assertRefusedNoWrite(runCompose('compose-illegal-cut-runner.ts'), /forbids cut/);
});

test('voice compose (D1): a model declaring op "verbatim" is REFUSED pre-emit -- non-zero exit, forbidden op named, NO edition written', () => {
  assertRefusedNoWrite(runCompose('compose-illegal-verbatim-runner.ts'), /forbids verbatim/);
});

test('voice compose (D7): a model declaring an EMPTY grounding array is REFUSED pre-emit -- non-zero exit, grounding named, NO edition written', () => {
  assertRefusedNoWrite(runCompose('compose-empty-grounding-runner.ts'), /grounding/);
});

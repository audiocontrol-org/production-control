// T018 (US2): the producer PRE-EMIT self-check refuses loudly and writes
// NOTHING when the model's grounding does not exhaustively account for the
// composed edition units (contracts/voice-compose-cli.md "Producer pre-emit
// self-check"; spec 006 US2; Principle V -- producer success grants the
// validator nothing, and a refused compose leaves no partial edition behind).
//
// Drives the REAL `voice-compose` binary end-to-end (mirrors
// `test/compose-happy.int.test.ts`) with a stub model whose output omits the
// grounding record for the final edition unit. The binary must exit non-zero,
// name the offending unit on stderr, and leave `output_dir` with no edition
// file written.

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
const STUB_RUNNER = fixturePath('spine', 'compose-missing-grounding-runner.ts');
const SPINE_PATH = fixturePath('spine', 'minimal-spine.md');
const VOICE_PATH = fixturePath('spine', 'compose-voice.md');

function sha256Of(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('voice compose (US2): a model output omitting a grounding record is REFUSED pre-emit -- non-zero exit, offending unit named, NO edition written', () => {
  const spineBytes = fs.readFileSync(SPINE_PATH);
  const voiceBytes = fs.readFileSync(VOICE_PATH);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-compose-preflight-'));
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
      VOICE_REVISE_MODEL: `node --import tsx ${STUB_RUNNER}`,
    };

    const result = spawnSync(process.execPath, [COMPOSE_BIN], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      env,
    });

    assert.notEqual(result.status, 0, `expected a non-zero exit; stdout: ${result.stdout}`);
    assert.equal(result.stdout, '', 'a refused compose must write NO BuildResponse to stdout');
    assert.match(
      result.stderr,
      /grounding/,
      `the refusal must name the grounding violation; stderr: ${result.stderr}`,
    );

    // Principle V: nothing partial left behind. The edition file must not exist,
    // and (if the dir was created at all) it must contain no edition markdown.
    const editionPath = path.join(outputDir, 'edition.md');
    assert.equal(fs.existsSync(editionPath), false, 'a refused compose must write NO edition file');
    if (fs.existsSync(outputDir)) {
      const entries = fs.readdirSync(outputDir);
      assert.deepEqual(entries, [], `output_dir must contain no written artifact; found: ${entries.join(', ')}`);
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

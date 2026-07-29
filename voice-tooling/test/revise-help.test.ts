// T012 (spec 006): coverage for the per-verb `--help` contract text
// (`@/revise/help.ts`) and for the REAL bins actually honoring `--help` before
// ever touching stdin (contracts/voice-compose-cli.md "Invocation": "Each
// verb's `--help` states its fidelity contract", R6). Mirrors
// `test/fidelity-cli.test.ts`'s style of spawning the real bin rather than
// only exercising the in-process function, since what matters here is what a
// caller of the actual binary observes.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { helpText } from '@/revise/help.ts';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPOSE_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-compose.mjs');
const REVISE_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-revise.mjs');

// ---- helpText (pure) --------------------------------------------------

test('helpText(compose): states the compose fidelity contract -- expand, forbid verbatim/cut, grounding declared', () => {
  const text = helpText('compose');
  assert.match(text, /EXPAND/);
  assert.match(text, /NEVER "verbatim"/);
  assert.match(text, /NEVER "cut"/);
  assert.match(text, /[Gg]rounding declared/);
  assert.match(text, /whole-unit copy/);
});

test('helpText(revise): states the revise fidelity contract -- verbatim byte-exact', () => {
  const text = helpText('revise');
  assert.match(text, /VERBATIM \(byte-exact\)/);
  assert.match(text, /TASK-50/);
});

test('helpText: compose and revise texts are distinct', () => {
  assert.notEqual(helpText('compose'), helpText('revise'));
});

// ---- the real bins honor --help before ever reading stdin -------------

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runHelp(bin: string): CliResult {
  // Deliberately pass NO stdin input (spawnSync with no `input` closes stdin
  // immediately) -- if the bin read stdin before checking --help, a
  // `readStdinText()` that awaits an already-closed empty stream would still
  // resolve, so this alone would not catch a missing short-circuit; the real
  // proof is that no VOICE_REVISE_MODEL is configured below and yet the call
  // still exits 0, which only happens if the model command is never resolved.
  const result = spawnSync(process.execPath, [bin, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, VOICE_REVISE_MODEL: '' },
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('voice-compose --help: exits 0, prints the compose contract, with no model command configured', () => {
  const { code, stdout, stderr } = runHelp(COMPOSE_BIN);
  assert.equal(code, 0, `expected exit 0; stderr: ${stderr}`);
  assert.match(stdout, /voice-compose/);
  assert.match(stdout, /EXPAND/);
});

test('voice-revise --help: exits 0, prints the revise contract, with no model command configured', () => {
  const { code, stdout, stderr } = runHelp(REVISE_BIN);
  assert.equal(code, 0, `expected exit 0; stderr: ${stderr}`);
  assert.match(stdout, /voice-revise/);
  assert.match(stdout, /VERBATIM \(byte-exact\)/);
});

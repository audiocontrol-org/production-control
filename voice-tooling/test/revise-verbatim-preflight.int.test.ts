// T022/T023 (US4): the revise producer PRE-EMIT self-check refuses a DRIFTED
// `verbatim` unit BEFORE writing (spec 006 US4; TASK-50,
// .stack-control/backlog/tasks/task-50 -
// voice-revise-alters-verbatim-declared-units.md -- the empirical defect this
// task exists to close: 2/56 editions in a full-ebook run declared
// `op: verbatim` but altered the unit's bytes, and were only caught AFTER
// emission by `voice fidelity`); contracts/voice-compose-cli.md "Producer
// pre-emit self-check"; Principle V (refuse loudly BEFORE any write, never a
// partial edition left behind).
//
// `@/revise/preflight.ts`'s `runPreflight` refuses revise-mode verbatim drift
// via the shared, pure `@/policy/op-legality.ts#checkOpLegality('revise', ...)`
// predicate (its `revise-verbatim-drift` failure kind, computed by
// `collectVerbatimDrift`) wired into the revise branch of `runPreflight`; this
// test pins that behavior end-to-end through the REAL `voice-revise` binary
// (mirrors `test/compose-preflight-no-copy.int.test.ts`'s style) with a stub
// model, and separately pins a SC-006 regression: the preflight/verbatim work
// must not break a pre-006 shipped-shape revise edition (no `mode` field, no
// `grounding`).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runFidelity } from '@/fidelity/run.ts';
import { extractLedgerYaml } from '@/fidelity/check-ledger-structure.ts';
import { loadLedger } from '@/schema/ledger.ts';
import { fixturePath, readFixture } from './support.ts';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REVISE_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-revise.mjs');
const SOURCE_PATH = fixturePath('sources', 'basic-lf.md');
const VOICE_PATH = fixturePath('spine', 'compose-voice.md');
const DRIFT_RUNNER = fixturePath('revise', 'verbatim-drift-runner.ts');
const EXACT_RUNNER = fixturePath('revise', 'verbatim-exact-runner.ts');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function sha256Of(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function runRevise(requestJson: unknown, modelRunner: string): CliResult {
  const result = spawnSync(process.execPath, [REVISE_BIN], {
    input: JSON.stringify(requestJson),
    encoding: 'utf8',
    env: {
      ...process.env,
      VOICE_REVISE_MODEL: `node --import tsx ${modelRunner}`,
    },
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('voice revise (US4/TASK-50): a model output declaring a DRIFTED verbatim unit is REFUSED pre-emit -- non-zero exit, the drifted unit named on stderr, NO edition written', () => {
  const sourceBytes = fs.readFileSync(SOURCE_PATH);
  const voiceBytes = fs.readFileSync(VOICE_PATH);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-revise-verbatim-drift-'));
  try {
    const outputDir = path.join(tmpBase, 'out');

    const request = {
      version: 1,
      target: 'edition',
      inputs: {
        source: { path: SOURCE_PATH, hash: sha256Of(sourceBytes) },
        voice: { path: VOICE_PATH, hash: sha256Of(voiceBytes) },
      },
      output_dir: outputDir,
    };

    const { code, stdout, stderr } = runRevise(request, DRIFT_RUNNER);

    // `runPreflight`'s revise branch refuses this drifted `verbatim` unit BEFORE
    // any write, via `checkOpLegality('revise', ...)`'s `revise-verbatim-drift`
    // failure kind.
    assert.notEqual(code, 0, `expected a non-zero exit (pre-emit refusal); stdout: ${stdout}`);
    assert.equal(stdout, '', 'a refused revise must write NO BuildResponse to stdout');
    assert.match(
      stderr,
      /revise verbatim drift/,
      `the refusal must name the revise-verbatim-drift failure kind; stderr: ${stderr}`,
    );
    assert.match(
      stderr,
      /sha256:/,
      `the refusal must name the drifted unit's content hash; stderr: ${stderr}`,
    );

    // Principle V: nothing partial left behind.
    const editionPath = path.join(outputDir, 'edition.md');
    assert.equal(fs.existsSync(editionPath), false, 'a refused revise must write NO edition file');
    if (fs.existsSync(outputDir)) {
      const entries = fs.readdirSync(outputDir);
      assert.deepEqual(entries, [], `output_dir must contain no written artifact; found: ${entries.join(', ')}`);
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('voice revise (US4/TASK-50 non-regression): a model output whose verbatim destinations are BYTE-EXACT to source is accepted -- exit 0, edition written', () => {
  const sourceBytes = fs.readFileSync(SOURCE_PATH);
  const voiceBytes = fs.readFileSync(VOICE_PATH);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-revise-verbatim-exact-'));
  try {
    const outputDir = path.join(tmpBase, 'out');

    const request = {
      version: 1,
      target: 'edition',
      inputs: {
        source: { path: SOURCE_PATH, hash: sha256Of(sourceBytes) },
        voice: { path: VOICE_PATH, hash: sha256Of(voiceBytes) },
      },
      output_dir: outputDir,
    };

    const { code, stdout, stderr } = runRevise(request, EXACT_RUNNER);

    assert.equal(code, 0, `expected voice-revise to exit 0 for a byte-exact verbatim edition; stderr: ${stderr}`);
    const response = JSON.parse(stdout) as { tool: { name: string }; outputs: [{ path: string }] };
    assert.equal(response.tool.name, 'voice-revise');

    const editionPath = path.join(outputDir, response.outputs[0].path);
    assert.ok(fs.existsSync(editionPath), 'a byte-exact verbatim revise must write its edition file');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('SC-006 regression: a pre-006 shipped-shape revise edition (no mode field, no grounding) still validates through runFidelity, loading as mode: revise', () => {
  // Reuses the SAME fixture pair `test/fidelity-pass.test.ts` already pins as
  // a faithful US1 (pre-006) edition: its ledger carries no `mode` key and no
  // `grounding` key at all -- exactly the shape every one of the 54 shipped
  // pre-006 editions has. `loadLedger` defaults an absent `mode` to `revise`
  // (@/schema/ledger.ts). Neither T022's new fixtures/tests nor T023's future
  // preflight branch may cause this shipped shape to regress.
  const source = readFixture('sources', 'faithful-source.md');
  const edition = readFixture('editions', 'faithful-edition.md');

  // The fixture ledger itself carries neither `mode:` nor `grounding:` -- the
  // exact pre-006 shipped shape. `loadLedger` must still load it, defaulting
  // the absent `mode` to `'revise'` (backward compatibility, @/schema/ledger.ts).
  //
  // AUDIT-37 (de-tautology): assert the PRECONDITION on the raw ledger bytes --
  // that they genuinely lack a `mode:` / `grounding:` key -- BEFORE loading.
  // Without this, `ledger.mode === 'revise'` is satisfied both by "the key was
  // absent and the default fired" AND by "the fixture literally says mode:
  // revise", so a future normalization stamping `mode: revise` into the shared
  // fixture would leave this guard green while the absent-key path it exists to
  // protect stops being exercised.
  const ledgerYaml = extractLedgerYaml(edition);
  assert.doesNotMatch(
    ledgerYaml,
    /^\s*mode\s*:/m,
    'precondition: the pre-006 fixture ledger bytes must genuinely carry NO mode key',
  );
  assert.doesNotMatch(
    ledgerYaml,
    /^\s*grounding\s*:/m,
    'precondition: the pre-006 fixture ledger bytes must genuinely carry NO grounding key',
  );
  const ledger = loadLedger(ledgerYaml);
  assert.equal(
    ledger.mode,
    'revise',
    'an absent ledger `mode` must default to "revise" on read (backward compatibility, @/schema/ledger.ts)',
  );
  assert.equal(ledger.grounding, undefined, 'a pre-006 ledger declares no grounding at all');

  const result = runFidelity({
    source,
    sourceIdentity: 'source-riverbank-survey',
    edition,
  });

  assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
  assert.equal(result.passed, true, `a pre-006 shipped-shape revise edition must still pass; failures: ${result.failures.join('; ')}`);
  assert.equal(result.report.verdict, 'passed');
});

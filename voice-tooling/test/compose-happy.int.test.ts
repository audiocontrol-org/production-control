// T013 (US1, RED-first): the compose happy-path integration test
// (specs/006-voice-compose-from-spine/spec.md US1 Acceptance Scenarios 1-3,
// SC-001, SC-007; contracts/voice-compose-cli.md "Output"/"Model protocol
// (compose)"; contracts/fidelity-mode-agreement.md "Report fields";
// data-model.md "Report additions").
//
// Drives the REAL `voice-compose` binary end-to-end (mirrors
// `test/revise-help.test.ts` / `test/fidelity-cli.test.ts`'s style of
// spawning the actual bin rather than only exercising in-process functions --
// what matters here is what a real caller of the binary observes) over the
// T002 fixture spine + voice with the deterministic compose stub model
// (`test/fixtures/spine/compose-stub.ts`, run via the tiny executable wrapper
// `compose-stub-runner.ts`), then feeds the resulting source+edition straight
// into `runFidelity` (no subprocess needed there -- it is pure/deterministic)
// to confirm the independent validator accepts it and reports the FR-012
// trust-boundary fields.
//
// Scope note on "dot-zoned path" (FR-015): the ACTUAL decision to route
// impure output under production-control's `.ai/` root is made by the ROOT
// package's `src/providers/build.ts` (`impurityOf(decl, response)`, spec
// 003), strictly AFTER the provider responds -- entirely outside this
// package's boundary (`voice-tooling` never imports production-control's own
// modules; see `@/revise/request.ts`'s package-boundary discipline). What
// THIS test can and does verify at the voice-tooling layer is the two facts
// that shared, unchanged routing mechanism actually consumes: (a) the
// provider writes its edition wherever its `output_dir` names, including a
// dot-zoned one, with no resistance; and (b) the provider's `BuildResponse`
// declares `impure` with a non-empty reason (exactly like `voice revise`
// already does, unmodified) -- the signal that drives that routing to `.ai/`.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deriveUnits } from '@/units/derive.ts';
import { extractPayload } from '@/payload/extract.ts';
import { extractLedgerYaml } from '@/fidelity/check-ledger-structure.ts';
import { loadLedger } from '@/schema/ledger.ts';
import { runFidelity } from '@/fidelity/run.ts';
import { fixturePath } from './support.ts';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPOSE_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-compose.mjs');
const STUB_RUNNER = fixturePath('spine', 'compose-stub-runner.ts');
const SPINE_PATH = fixturePath('spine', 'minimal-spine.md');
const VOICE_PATH = fixturePath('spine', 'compose-voice.md');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ComposeResponse {
  version: 1;
  outputs: [{ path: string }];
  tool: { name: string; version: string };
  impure: { reason: string };
}

function sha256Of(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function runCompose(requestJson: unknown, env: NodeJS.ProcessEnv): CliResult {
  const result = spawnSync(process.execPath, [COMPOSE_BIN], {
    input: JSON.stringify(requestJson),
    encoding: 'utf8',
    env,
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('voice compose (US1 happy path): dot-zoned edition, byte-exact payload survival, mode: compose ledger, and a fidelity pass carrying the trust-boundary fields', () => {
  const spineBytes = fs.readFileSync(SPINE_PATH);
  const voiceBytes = fs.readFileSync(VOICE_PATH);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-compose-happy-'));
  try {
    // A dot-zoned destination (FR-001: a parent DIRECTORY segment begins with
    // "."), the shape a real `pc build` supplies for impure output -- see the
    // module doc's scope note.
    const outputDir = path.join(tmpBase, '.ai', 'staging');

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

    const { code, stdout, stderr } = runCompose(request, env);
    assert.equal(code, 0, `expected voice-compose to exit 0; stderr: ${stderr}`);

    const response = JSON.parse(stdout) as ComposeResponse;
    assert.equal(response.tool.name, 'voice-compose', 'BuildResponse must name the verb that actually ran');
    assert.ok(
      typeof response.impure?.reason === 'string' && response.impure.reason.trim().length > 0,
      'compose must declare impure with a non-empty reason (FR-015) -- the signal the shared, ' +
        'unchanged content-zone routing (spec 003) consumes to route this under .ai/',
    );

    // The edition landed exactly where the dot-zoned output_dir named, under a
    // directory whose own segment is dot-prefixed (AI-permitted, FR-001).
    const editionFullPath = path.join(outputDir, response.outputs[0].path);
    assert.ok(fs.existsSync(editionFullPath), 'edition must be written under the declared dot-zoned output_dir');
    const relFromBase = path.relative(tmpBase, editionFullPath).split(path.sep);
    assert.ok(
      relFromBase.some((segment) => segment.startsWith('.')),
      `edition path "${relFromBase.join('/')}" must include a dot-prefixed directory segment`,
    );

    const editionText = fs.readFileSync(editionFullPath, 'utf8');

    // mode: compose ledger with a grounding record per edition unit.
    const ledgerYaml = extractLedgerYaml(editionText);
    const ledger = loadLedger(ledgerYaml);
    assert.equal(ledger.mode, 'compose', 'the ledger must be stamped mode: compose');

    const sourceUnits = deriveUnits(spineBytes.toString('utf8'), 'spine');
    const editionUnits = deriveUnits(editionText, 'edition');
    assert.equal(sourceUnits.length, 3, 'fixture spine derives to 3 beats');
    assert.equal(editionUnits.length, 3, 'fixture stub writes 3 edition units, 1:1 with the beats');
    assert.ok(Array.isArray(ledger.grounding), 'compose requires a grounding declaration');
    assert.equal(
      ledger.grounding?.length,
      editionUnits.length,
      'every edition unit must carry exactly one grounding record',
    );

    // SC-001: every citation marker + numeral in each beat survives BYTE-EXACT
    // into that beat's represented destination edition unit. The fixture stub
    // maps beat i -> edition unit i 1:1 (`compose-stub.ts`).
    for (let i = 0; i < sourceUnits.length; i += 1) {
      const beat = sourceUnits[i];
      const destination = editionUnits[i];
      assert.ok(beat && destination, `beat/destination ${i} must exist`);
      const payload = extractPayload(beat!.content);
      for (const citation of payload.citations) {
        assert.ok(
          destination!.content.includes(citation),
          `citation ${citation} from beat ${i} must survive byte-exact into its destination`,
        );
      }
      for (const numeral of payload.numerics) {
        assert.ok(
          destination!.content.includes(numeral),
          `numeral ${numeral} from beat ${i} must survive byte-exact into its destination`,
        );
      }
    }

    // The independent `voice fidelity` validator accepts the composed edition,
    // and reports the FR-012 trust-boundary fields honestly.
    const result = runFidelity({
      source: spineBytes,
      sourceIdentity: 'spine',
      edition: editionText,
    });

    assert.equal(result.decided, true, `expected a decided outcome; failures: ${result.failures.join('; ')}`);
    assert.equal(result.passed, true, `expected a fidelity pass; failures: ${result.failures.join('; ')}`);
    assert.equal(result.report.verdict, 'passed');
    assert.equal(result.report.mode, 'compose');
    assert.equal(result.report.spine_source_fidelity, 'not-checked');
    assert.equal(result.report.composition_semantic_grounding, 'not-checkable');
    assert.equal(
      result.report.open_question_markers,
      'enforced',
      'the fixture spine declares an [OPEN-QUESTION: ...] marker (T027) and the stub edition ' +
        "preserves its bytes byte-exact, so the report must say the guarantee is actually active",
    );
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

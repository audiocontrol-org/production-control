import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import type { ValidateRequest } from '@/providers/contract.js';
import { subprocessRunner } from '@/providers/run.js';
import { subprocessValidatorRunner } from '@/providers/validate-run.js';
import { makeRequest, nodeDecl } from './provider-support.js';

/**
 * A provider's stderr is DIAGNOSTICS, and diagnostics are for the operator — on success as much
 * as on failure (contracts/provider.md § stderr; quote-miner.md FR-017).
 *
 * The bug these tests exist to prevent, observed live on a 123-source quote-bank build: the
 * runner accumulated the child's stderr into a buffer and surfaced it ONLY when the child failed.
 * A provider that streams `progress: 12/123 …` for hours therefore produced NOTHING through
 * `pc build` until the whole run ended, and a provider whose contract requires it to emit a
 * mining report on stderr had that report silently discarded on every successful run.
 *
 * The fix is to TEE, not to buffer: each chunk is handed to the caller's `onDiagnostic` sink as
 * it arrives AND still accumulated, so the verbatim-on-failure message is byte-for-byte what it
 * always was. The sink is optional and absent by default — the library never writes to a global
 * stream itself; the CLI supplies the sink that reaches the operator's terminal.
 */

/**
 * A provider written inline that writes `lines` to stderr, produces one declared output, and
 * exits 0. The lines land on stderr BEFORE the BuildResponse goes to stdout, which is the shape a
 * long-running provider has: progress first, verdict last.
 */
function successWithStderr(lines: readonly string[]): readonly string[] {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'let raw = "";',
    'process.stdin.on("data", (c) => (raw += c));',
    'process.stdin.on("end", () => {',
    '  const req = JSON.parse(raw);',
    '  fs.mkdirSync(req.output_dir, { recursive: true });',
    '  fs.writeFileSync(path.join(req.output_dir, "out.txt"), "ok");',
    ...lines.map((line) => `  process.stderr.write(${JSON.stringify(`${line}\n`)});`),
    '  process.stdout.write(JSON.stringify({version:1,outputs:[{path:"out.txt"}],tool:{name:"t",version:"1"}}));',
    '});',
  ];
}

/** A provider that writes `line` to stderr and then exits non-zero, producing nothing. */
function failureWithStderr(line: string): string {
  return [`process.stderr.write(${JSON.stringify(`${line}\n`)});`, 'process.exit(3);'].join('');
}

describe("contract: a provider's stderr reaches the operator (tee, not buffer)", () => {
  let work: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-diagnostics-'));
  });

  afterEach(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  describe('a SUCCESSFUL provider that wrote to stderr', () => {
    it('hands its diagnostics to the sink — the regression this file exists for', async () => {
      const chunks: string[] = [];
      const request = await makeRequest(work);

      const response = await subprocessRunner().run(
        request,
        nodeDecl(successWithStderr(['progress: 1/2 alpha', 'progress: 2/2 beta']).join('')),
        (chunk) => chunks.push(chunk)
      );

      // Exit 0, a well-formed response — and the diagnostics still arrived. Before the fix this
      // array was empty: the provider's entire account of a multi-hour run was dropped on the
      // floor because it had the temerity to succeed.
      expect(response.outputs).toEqual([{ path: 'out.txt' }]);
      expect(chunks.join('')).toBe('progress: 1/2 alpha\nprogress: 2/2 beta\n');
    });

    it("never routes the provider's STDOUT into the diagnostics sink", async () => {
      // stdout is the RESPONSE channel and stderr is the diagnostics channel; mixing them would
      // make the BuildResponse unparseable in one direction and the operator's log a lie in the
      // other.
      const chunks: string[] = [];
      await subprocessRunner().run(
        await makeRequest(work),
        nodeDecl(successWithStderr(['just this line']).join('')),
        (chunk) => chunks.push(chunk)
      );

      expect(chunks.join('')).not.toContain('BuildResponse');
      expect(chunks.join('')).not.toContain('outputs');
      expect(chunks.join('')).toBe('just this line\n');
    });
  });

  describe('the chunks arrive WHILE the provider is still running', () => {
    it('delivers the first line before the provider has exited', async () => {
      // Incrementality proved WITHOUT a timing assertion. The provider writes its first line and
      // then waits for a gate file that only the sink creates; if the runner buffered until exit,
      // the gate would never appear and the provider would report `gate-observed: no`. So the
      // pass condition is causal, not temporal: the second line can only say `yes` if the first
      // chunk reached the sink while the process was still alive.
      const gate = path.join(work, 'gate');
      const script = [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'let raw = "";',
        'process.stdin.on("data", (c) => (raw += c));',
        'process.stdin.on("end", () => {',
        '  const req = JSON.parse(raw);',
        '  fs.mkdirSync(req.output_dir, { recursive: true });',
        '  fs.writeFileSync(path.join(req.output_dir, "out.txt"), "ok");',
        '  process.stderr.write("progress: 1/2 first\\n");',
        '  const deadline = Date.now() + 2000;',
        '  const finish = (observed) => {',
        '    process.stderr.write("progress: 2/2 second gate-observed: " + observed + "\\n");',
        '    process.stdout.write(JSON.stringify({version:1,outputs:[{path:"out.txt"}],tool:{name:"t",version:"1"}}));',
        '  };',
        '  const tick = () => {',
        `    if (fs.existsSync(${JSON.stringify(gate)})) { finish("yes"); return; }`,
        '    if (Date.now() > deadline) { finish("no"); return; }',
        '    setTimeout(tick, 10);',
        '  };',
        '  tick();',
        '});',
      ].join('');

      const chunks: string[] = [];
      await subprocessRunner().run(await makeRequest(work), nodeDecl(script), (chunk) => {
        chunks.push(chunk);
        fs.writeFile(gate, 'go').catch(() => {
          // The gate write is the test's own signal; a failure here surfaces as `gate-observed:
          // no` below, which is the assertion that matters.
        });
      });

      expect(chunks.join('')).toContain('gate-observed: yes');
      expect(chunks.length, 'the whole of stderr arrived in one chunk at exit').toBeGreaterThan(1);
    });
  });

  describe('a FAILING provider', () => {
    it('still surfaces its stderr VERBATIM in the error, exactly as before', async () => {
      const message = 'quote-miner: source 41 has no usable quotes -- refusing';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(failureWithStderr(message)))
      ).rejects.toThrow(
        new Error(`provider "${process.execPath}" exited with code 3.\nstderr:\n${message}`)
      );
    });

    it('surfaces it verbatim AND tees it, when a sink is supplied', async () => {
      const chunks: string[] = [];
      const message = 'quote-miner: source 41 has no usable quotes -- refusing';

      await expect(
        subprocessRunner().run(
          await makeRequest(work),
          nodeDecl(failureWithStderr(message)),
          (chunk) => chunks.push(chunk)
        )
      ).rejects.toThrow(`stderr:\n${message}`);

      expect(chunks.join('')).toBe(`${message}\n`);
    });
  });

  describe('with NO sink supplied (the default)', () => {
    it('a successful provider still succeeds', async () => {
      const response = await subprocessRunner().run(
        await makeRequest(work),
        nodeDecl(successWithStderr(['nobody is listening']).join(''))
      );
      expect(response.outputs).toEqual([{ path: 'out.txt' }]);
    });

    it('a failing provider still carries its stderr in the refusal', async () => {
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(failureWithStderr('boom')))
      ).rejects.toThrow(/stderr:\nboom/);
    });
  });

  describe('the VALIDATOR runner, which is the same boundary', () => {
    async function validateRequest(): Promise<ValidateRequest> {
      const artifact = path.join(work, 'artifact.txt');
      await fs.writeFile(artifact, 'bytes\n');
      return {
        version: 1,
        target: 'quote-bank',
        artifact: { path: artifact, hash: 'sha256:0'.padEnd(71, 'a') },
        inputs: {},
      };
    }

    const passing = [
      'process.stderr.write("advisory: 3 of 123 sources contributed nothing\\n");',
      'process.stdout.write(JSON.stringify({version:1,state:"passed"}));',
    ].join('');

    it("tees a passing validator's advisories to the sink", async () => {
      const chunks: string[] = [];
      const response = await subprocessValidatorRunner().run(
        await validateRequest(),
        { cmd: [process.execPath, '-e', passing] },
        (chunk) => chunks.push(chunk)
      );

      // A validator that PASSES can still have plenty to say — "a bank may pass fidelity while
      // the report reveals weak selection; the two are separate" (quote-miner.md FR-017). A pass
      // that swallows the advisory hides exactly the half the operator has to act on.
      expect(response.state).toBe('passed');
      expect(chunks.join('')).toBe('advisory: 3 of 123 sources contributed nothing\n');
    });

    it("still surfaces a failing validator's stderr verbatim", async () => {
      await expect(
        subprocessValidatorRunner().run(await validateRequest(), {
          cmd: [process.execPath, '-e', failureWithStderr('validator: unreadable bank')],
        })
      ).rejects.toThrow(/stderr:\nvalidator: unreadable bank/);
    });
  });
});

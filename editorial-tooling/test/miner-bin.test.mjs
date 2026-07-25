import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Parse the `key: value` mining-report lines quote-miner.mjs writes to stderr
 * (see writeMiningReport in bin/quote-miner.mjs) into a plain object of numbers.
 */
function parseMiningReport(stderr) {
  const report = {};
  for (const line of stderr.split('\n')) {
    const match = /^(selected|grounded|omitted_ungrounded|sources_processed|sources_skipped|sources_failed|corrections_proposed|corrections_applied|corrections_dropped):\s*(\d+)$/.exec(
      line
    );
    if (match) {
      report[match[1]] = Number(match[2]);
    }
  }
  return report;
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(thisDir, '..', 'bin', 'quote-miner.mjs');
const validatorBinPath = path.resolve(thisDir, '..', 'bin', 'quote-validator.mjs');

test('miner-bin contract test suite', async (t) => {
  // Case 1: SUCCESS (happy path with fake model)
  await t.test('SUCCESS: happy path with fake model', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      // Create sources directory with one file
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      const sourceFile = path.join(sourcesDir, 'speech.txt');
      fs.writeFileSync(sourceFile, 'Duty is ours; results are God\'s.\nWe hold these truths.\n', 'utf8');

      // Create fake model executable
      const fakeModelPath = path.join(tmpDir, 'fake-model.mjs');
      const fakeModelCode = `#!/usr/bin/env node
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify(["Duty is ours; results are God's.", "A wholly invented line."]));
});
`;
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      // Create empty output directory
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      // Build the BuildRequest
      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: {
          sources: {
            path: sourcesDir,
            hash: 'sha256:abc123'
          }
        },
        output_dir: outputDir
      };

      // Run the miner with injected fake model
      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath }
      });

      // Assert exit status 0
      assert.equal(result.status, 0, `Expected exit status 0, got ${result.status}. stderr: ${result.stderr}`);

      // Parse and validate BuildResponse from stdout
      const response = JSON.parse(result.stdout);

      // Assert outputs array
      assert.equal(response.outputs.length, 1, 'outputs should have length 1');
      assert.equal(response.outputs[0].path, 'quote-bank.yaml', 'output path should be quote-bank.yaml');

      // Assert impure is present with non-empty reason
      assert('impure' in response, 'response must have impure property');
      assert.equal(typeof response.impure, 'object', 'impure should be an object');
      assert('reason' in response.impure, 'impure must have reason property');
      assert(response.impure.reason.length > 0, 'impure.reason should be non-empty');

      // Assert tool info
      assert.equal(response.tool.name, 'quote-miner', 'tool.name should be quote-miner');

      // Assert NO validation field
      assert(!('validation' in response), 'response must NOT have validation property');

      // Assert quote-bank.yaml exists
      const bankPath = path.join(outputDir, 'quote-bank.yaml');
      assert(fs.existsSync(bankPath), `quote-bank.yaml should exist at ${bankPath}`);

      // Open the bank and assert the central grounding contract at the bin boundary
      // (FR-014/SC-004): the grounded candidate is present, the fabricated one is not.
      const bankText = fs.readFileSync(bankPath, 'utf8');
      const bank = parseYaml(bankText);
      assert(Array.isArray(bank.quotes), 'bank should have a quotes array');

      const groundedText = "Duty is ours; results are God's.";
      const invisibleFabricatedText = 'A wholly invented line.';

      const quoteStrings = (quote) => [quote.text, ...(quote.spans ?? []).map((span) => span.raw)];

      const hasGrounded = bank.quotes.some((quote) => quoteStrings(quote).includes(groundedText));
      assert(hasGrounded, `expected a quote with text/raw '${groundedText}' to be present in the bank`);

      const hasFabricated = bank.quotes.some((quote) =>
        quoteStrings(quote).includes(invisibleFabricatedText)
      );
      assert(
        !hasFabricated,
        `expected the ungrounded candidate '${invisibleFabricatedText}' to be OMITTED from the bank`
      );

      // Assert stderr is non-empty, and parse the mining report counts rather than
      // pattern-matching for the presence of keywords: one grounded, one omitted.
      assert(result.stderr.length > 0, 'stderr should be non-empty');
      const report = parseMiningReport(result.stderr);
      assert.equal(report.selected, 2, `expected 2 selected candidates, stderr: ${result.stderr}`);
      assert.equal(report.grounded, 1, `expected 1 grounded quote, stderr: ${result.stderr}`);
      assert.equal(
        report.omitted_ungrounded,
        1,
        `expected 1 omitted ungrounded candidate, stderr: ${result.stderr}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Case 2: SOURCE FAILURE (non-UTF-8)
  await t.test('SOURCE FAILURE: non-UTF-8 file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      // Create sources directory with invalid UTF-8 file
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      const badFile = path.join(sourcesDir, 'bad.bin');
      fs.writeFileSync(badFile, Buffer.from([0xff, 0xfe, 0x00, 0x9c]));

      // Create fake model executable
      const fakeModelPath = path.join(tmpDir, 'fake-model.mjs');
      const fakeModelCode = `#!/usr/bin/env node
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify([]));
});
`;
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      // Create empty output directory
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      // Build the BuildRequest
      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: {
          sources: {
            path: sourcesDir,
            hash: 'sha256:abc123'
          }
        },
        output_dir: outputDir
      };

      // Run the miner
      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath }
      });

      // Assert exit status is non-zero
      assert.notEqual(result.status, 0, 'exit status should be non-zero on source failure');

      // Assert stderr is non-empty
      assert(result.stderr.length > 0, 'stderr should be non-empty on source failure');

      // Assert quote-bank.yaml does NOT exist (atomic: no partial bank)
      const bankPath = path.join(outputDir, 'quote-bank.yaml');
      assert(!fs.existsSync(bankPath), `quote-bank.yaml should NOT exist after source failure at ${bankPath}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Case 3: MODEL FAILURE (exit non-zero)
  await t.test('MODEL FAILURE: fake model exits non-zero', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      // Create sources directory with valid file
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      const sourceFile = path.join(sourcesDir, 'speech.txt');
      fs.writeFileSync(sourceFile, 'Some valid text.\n', 'utf8');

      // Create failing fake model executable
      const fakeModelPath = path.join(tmpDir, 'fake-model.mjs');
      const fakeModelCode = `#!/usr/bin/env node
process.exit(3);
`;
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      // Create empty output directory
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      // Build the BuildRequest
      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: {
          sources: {
            path: sourcesDir,
            hash: 'sha256:abc123'
          }
        },
        output_dir: outputDir
      };

      // Run the miner
      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath }
      });

      // Assert exit status is non-zero
      assert.notEqual(result.status, 0, 'exit status should be non-zero on model failure');

      // Assert stderr is non-empty
      assert(result.stderr.length > 0, 'stderr should be non-empty on model failure');

      // Assert quote-bank.yaml does NOT exist (atomic: no partial bank)
      const bankPath = path.join(outputDir, 'quote-bank.yaml');
      assert(!fs.existsSync(bankPath), `quote-bank.yaml should NOT exist after model failure at ${bankPath}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Case 5 (TASK-9): a model-proposed OCR correction survives end-to-end — the written
  // bank carries a disclosed ocr-fix, and the REAL validator subprocess accepts it.
  await t.test('OCR-FIX: disclosed correction in the bank passes the real validator', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      const corruptLine = 'The Marquis de Bays has been arrested m this city.';
      fs.writeFileSync(path.join(sourcesDir, 'cable.txt'), `${corruptLine}\n`, 'utf8');

      const candidates = [
        {
          text: corruptLine,
          corrections: [
            { before: 'de Bays', after: 'de Rays' },
            { before: ' m ', after: ' in ' }
          ]
        }
      ];
      const fakeModelPath = path.join(tmpDir, 'fake-model.mjs');
      const fakeModelCode =
        '#!/usr/bin/env node\n' +
        'process.stdin.on("data", () => {});\n' +
        'process.stdin.on("end", () => {\n' +
        `  process.stdout.write(${JSON.stringify(JSON.stringify(candidates))});\n` +
        '});\n';
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: { sources: { path: sourcesDir, hash: 'sha256:abc123' } },
        output_dir: outputDir
      };

      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath }
      });
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

      const bankPath = path.join(outputDir, 'quote-bank.yaml');
      const bank = parseYaml(fs.readFileSync(bankPath, 'utf8'));
      assert.equal(bank.quotes.length, 1);
      const quote = bank.quotes[0];

      const ocrFixes = quote.edits.filter((edit) => edit.op === 'ocr-fix');
      assert.equal(ocrFixes.length, 2, `expected 2 ocr-fix edits, got: ${JSON.stringify(quote.edits)}`);
      // raw stays the corrupt source bytes; text is the mechanically derived presentation.
      assert.equal(quote.spans[0].raw, corruptLine);
      assert.equal(quote.text, 'The Marquis de Rays has been arrested in this city.');

      // The mining report discloses the correction counts (FR-017 keys unchanged).
      const report = parseMiningReport(result.stderr);
      assert.equal(report.corrections_proposed, 2, `stderr: ${result.stderr}`);
      assert.equal(report.corrections_applied, 2, `stderr: ${result.stderr}`);
      assert.equal(report.corrections_dropped, 0, `stderr: ${result.stderr}`);

      // END-TO-END PROOF: the REAL validator binary accepts the corrected bank.
      const validation = spawnSync(process.execPath, [validatorBinPath], {
        input: JSON.stringify({
          version: 1,
          target: 'quote-bank',
          artifact: { path: bankPath, hash: 'sha256:placeholder' },
          inputs: { sources: { path: sourcesDir, hash: 'sha256:placeholder' } }
        }),
        encoding: 'utf8'
      });
      assert.equal(
        validation.status,
        0,
        `validator should reach a verdict; stderr: ${validation.stderr}`
      );
      const verdict = JSON.parse(validation.stdout);
      assert.equal(
        verdict.state,
        'passed',
        `validator should accept the mined bank; got: ${validation.stdout}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Case 6 (AUDIT-21 / FR-020): when the miner takes the DEFAULT structured-output path,
  // `tool.version` must carry the REAL model identity reported by the CLI envelope, not
  // the command basename — otherwise an Opus->Sonnet swap behind a fixed `claude` command
  // is invisible to producer-drift reporting. The stand-in below is NAMED `claude`, so the
  // adapter takes the structured path against it.
  await t.test('PROVENANCE: tool.version carries the real model identity on the structured path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      fs.writeFileSync(path.join(sourcesDir, 'speech.txt'), 'Duty is ours.\n', 'utf8');

      const envelope = {
        is_error: false,
        subtype: 'success',
        type: 'result',
        modelUsage: {
          'claude-opus-5[1m]': { outputTokens: 12, canonicalModel: 'claude-opus-5' }
        },
        result: '{"candidates":[{"text":"Duty is ours.","corrections":[]}]}',
        structured_output: { candidates: [{ text: 'Duty is ours.', corrections: [] }] }
      };

      // The stand-in binary's basename IS `claude`, which is what selects the structured path.
      const binDir = path.join(tmpDir, 'stub-bin');
      fs.mkdirSync(binDir);
      const fakeModelPath = path.join(binDir, 'claude');
      const fakeModelCode =
        '#!/usr/bin/env node\n' +
        'process.stdin.on("data", () => {});\n' +
        'process.stdin.on("end", () => {\n' +
        `  process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});\n` +
        '});\n';
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: { sources: { path: sourcesDir, hash: 'sha256:abc123' } },
        output_dir: outputDir
      };

      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath, QUOTE_MINER_MODEL_ID: '' }
      });

      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

      const response = JSON.parse(result.stdout);
      assert.equal(
        response.tool.version,
        '0.1.0+claude-opus-5',
        `tool.version should carry the real model identity; got: ${result.stdout}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Case 4: PROGRESS (TASK-10) — a long run must be observable while it runs, not only
  // at the end. Progress lines go to STDERR; stdout stays exactly one BuildResponse.
  await t.test('PROGRESS: per-source lines on stderr, stdout still one BuildResponse', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    try {
      const sourcesDir = path.join(tmpDir, 'sources');
      fs.mkdirSync(sourcesDir);
      fs.writeFileSync(path.join(sourcesDir, 'one.txt'), 'Alpha line one.\n', 'utf8');
      fs.writeFileSync(path.join(sourcesDir, 'two.txt'), 'Beta line two.\n', 'utf8');
      fs.writeFileSync(path.join(sourcesDir, 'three.txt'), 'Gamma line three.\n', 'utf8');

      const fakeModelPath = path.join(tmpDir, 'fake-model.mjs');
      const fakeModelCode = `#!/usr/bin/env node
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify(["Alpha line one.", "Not in any source."]));
});
`;
      fs.writeFileSync(fakeModelPath, fakeModelCode, 'utf8');
      fs.chmodSync(fakeModelPath, 0o755);

      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir);

      const req = {
        version: 1,
        target: 'quote-bank',
        inputs: { sources: { path: sourcesDir, hash: 'sha256:abc123' } },
        output_dir: outputDir
      };

      const result = spawnSync(process.execPath, [binPath], {
        input: JSON.stringify(req),
        encoding: 'utf8',
        env: { ...process.env, QUOTE_MINER_MODEL_CMD: fakeModelPath }
      });

      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

      // One progress line per source, on STDERR.
      const progressLines = result.stderr.split('\n').filter((line) => line.startsWith('progress:'));
      assert.equal(
        progressLines.length,
        3,
        `expected one progress line per source, got: ${JSON.stringify(progressLines)}`
      );
      assert.match(
        progressLines[0],
        /^progress: 1\/3 \S+ selected=\d+ grounded=\d+ omitted=\d+ corrections=\d+\/\d+$/
      );
      assert.match(progressLines[2], /^progress: 3\/3 /);
      const progressIds = progressLines.map((line) => line.split(' ')[2]).sort();
      assert.deepEqual(progressIds, ['one', 'three', 'two']);

      // The final machine-readable mining report (FR-017) is untouched.
      const report = parseMiningReport(result.stderr);
      assert.equal(report.sources_processed, 3);

      // STDOUT stays exactly one BuildResponse JSON — no progress leaks into it.
      const stdoutLines = result.stdout.split('\n').filter((line) => line.trim().length > 0);
      assert.equal(stdoutLines.length, 1, `stdout should be exactly one line: ${result.stdout}`);
      const response = JSON.parse(stdoutLines[0]);
      assert.equal(response.version, 1);
      assert.equal(response.outputs[0].path, 'quote-bank.yaml');
      assert(!result.stdout.includes('progress:'), 'progress must not appear on stdout');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

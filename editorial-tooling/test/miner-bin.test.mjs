import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(thisDir, '..', 'bin', 'quote-miner.mjs');

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

      // Assert stderr is non-empty and looks like mining report
      assert(result.stderr.length > 0, 'stderr should be non-empty');
      assert(/grounded|selected|omitted/.test(result.stderr), 'stderr should contain mining report indicators');
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
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const binPath = resolve(repoRoot, 'editorial-tooling/bin/quote-validator.mjs');
const fixturesDir = resolve(__dirname, 'fixtures');
const banksDir = resolve(fixturesDir, 'banks');
const sourcesDir = resolve(fixturesDir, 'sources');

function runValidator(request) {
  const result = spawnSync(process.execPath, [binPath], {
    input: JSON.stringify(request),
    encoding: 'utf8',
  });
  return result;
}

test('validator-bin contract', async (t) => {
  await t.test('VALID: clean bank passes validation', () => {
    const request = {
      version: 1,
      target: 'quote-bank',
      artifact: {
        path: resolve(banksDir, 'valid.yaml'),
        hash: 'sha256:placeholder',
      },
      inputs: {
        sources: {
          path: sourcesDir,
          hash: 'sha256:placeholder',
        },
      },
    };

    const result = runValidator(request);

    assert.equal(result.status, 0, `Expected exit code 0, got ${result.status}. stderr: ${result.stderr}`);

    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(`Failed to parse stdout as JSON: ${result.stdout}`, { cause: err });
    }

    assert.equal(response.version, 1);
    assert.equal(response.state, 'passed');
  });

  await t.test('FAILED verdict: fabricated span triggers errors with quote id', () => {
    const request = {
      version: 1,
      target: 'quote-bank',
      artifact: {
        path: resolve(banksDir, 'fabricated-span.yaml'),
        hash: 'sha256:placeholder',
      },
      inputs: {
        sources: {
          path: sourcesDir,
          hash: 'sha256:placeholder',
        },
      },
    };

    const result = runValidator(request);

    // A reached verdict exits 0
    assert.equal(result.status, 0, `Expected exit code 0, got ${result.status}. stderr: ${result.stderr}`);

    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(`Failed to parse stdout as JSON: ${result.stdout}`, { cause: err });
    }

    assert.equal(response.version, 1);
    assert.equal(response.state, 'failed');
    assert(Array.isArray(response.errors), 'Expected errors array');
    assert(response.errors.length > 0, 'Expected at least one error');

    const hasQuoteFab = response.errors.some((err) => err.includes('q-fab'));
    assert(hasQuoteFab, `Expected at least one error to mention 'q-fab', got: ${response.errors.join('; ')}`);
  });

  await t.test('MALFORMED REQUEST: non-JSON input exits non-zero with no passed verdict', () => {
    const result = spawnSync(process.execPath, [binPath], {
      input: 'this is not json',
      encoding: 'utf8',
    });

    // Cannot reach verdict: non-zero exit
    assert.notEqual(result.status, 0, 'Expected non-zero exit code for malformed JSON');
    assert(result.stderr.length > 0, 'Expected non-empty stderr');

    // stdout should NOT contain the substring "passed"
    assert(!result.stdout.includes('passed'), `Expected stdout to NOT contain 'passed', got: ${result.stdout}`);
  });

  await t.test('UNREADABLE SOURCE: non-existent sources dir exits non-zero with no passed verdict', () => {
    const request = {
      version: 1,
      target: 'quote-bank',
      artifact: {
        path: resolve(banksDir, 'valid.yaml'),
        hash: 'sha256:placeholder',
      },
      inputs: {
        sources: {
          path: resolve(fixturesDir, 'sources-does-not-exist'),
          hash: 'sha256:placeholder',
        },
      },
    };

    const result = runValidator(request);

    // Cannot reach verdict: non-zero exit
    assert.notEqual(result.status, 0, `Expected non-zero exit code, got ${result.status}`);
    assert(result.stderr.length > 0, 'Expected non-empty stderr');

    // stdout should NOT contain the substring "passed"
    assert(!result.stdout.includes('passed'), `Expected stdout to NOT contain 'passed', got: ${result.stdout}`);
  });
});

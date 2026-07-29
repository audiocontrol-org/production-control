// AUDIT-20260726-21: `voice-fidelity`'s CLI (`@/fidelity/cli.ts`) used to read
// `request.inputs['source']` / `request.artifact.path` straight off a bare
// `JSON.parse` result with no shape guard -- a syntactically valid but
// shape-invalid `ValidateRequest` (missing `inputs`, missing `artifact`, or a
// misspelled field) threw a raw, unnamed `TypeError` with empty stdout: a
// fourth outcome outside the contract's three (passed / decided-failure /
// cannot-decide). This file exercises the REAL `bin/voice-fidelity.mjs` entry
// point end-to-end (not just the in-process `runFidelityCli` function),
// because the bug was specifically about what reaches the process boundary
// (stdout/stderr/exit code) for a malformed request -- the same thing an
// external caller (e.g. `pc validate`) actually observes.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIDELITY_BIN = path.join(PACKAGE_ROOT, 'bin', 'voice-fidelity.mjs');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runFidelityBin(stdin: string): CliResult {
  const result = spawnSync(process.execPath, [FIDELITY_BIN], {
    input: stdin,
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('voice-fidelity CLI (AUDIT-20260726-21): a shape-invalid ValidateRequest ({}) is refused by name -- not a crash', () => {
  const { code, stdout, stderr } = runFidelityBin(JSON.stringify({}));

  assert.notEqual(code, 0, 'a shape-invalid request must never exit 0');
  assert.equal(
    stdout.trim(),
    '',
    'no ValidateResponse is ever written to stdout for a shape-invalid request',
  );
  assert.match(
    stderr,
    /voice-fidelity: ValidateRequest\.version/,
    `expected a named refusal citing the first missing field; got stderr: ${stderr}`,
  );
  assert.doesNotMatch(
    stderr,
    /TypeError|Cannot read propert/,
    'must be a named refusal, never a raw uncaught TypeError',
  );
});

test('voice-fidelity CLI (AUDIT-20260726-21): a request missing "inputs" is refused by name, not a crash', () => {
  const requestMissingInputs = {
    version: 1,
    target: 'edition',
    artifact: { path: '/tmp/does-not-matter.md', hash: 'sha256:' + 'a'.repeat(64) },
    // "inputs" deliberately absent -- this is the exact field the original
    // bug's `request.inputs['source']` access would have crashed on.
  };

  const { code, stdout, stderr } = runFidelityBin(JSON.stringify(requestMissingInputs));

  assert.notEqual(code, 0, 'a request missing "inputs" must never exit 0');
  assert.equal(stdout.trim(), '', 'no ValidateResponse is ever written for a shape-invalid request');
  assert.match(
    stderr,
    /voice-fidelity: ValidateRequest\.inputs/,
    `expected a named refusal citing "inputs"; got stderr: ${stderr}`,
  );
  assert.doesNotMatch(
    stderr,
    /TypeError|Cannot read propert/,
    'must be a named refusal, never a raw uncaught TypeError',
  );
});

test('voice-fidelity CLI (AUDIT-20260726-21): a request whose "artifact" is a misspelled/wrong-shape field is refused by name', () => {
  const requestBadArtifact = {
    version: 1,
    target: 'edition',
    // Misspelled field name -- "artifact" is entirely absent from this
    // object's own perspective, even though the request otherwise looks
    // request-shaped.
    artefact: { path: '/tmp/does-not-matter.md', hash: 'sha256:' + 'a'.repeat(64) },
    inputs: {},
  };

  const { code, stdout, stderr } = runFidelityBin(JSON.stringify(requestBadArtifact));

  assert.notEqual(code, 0);
  assert.equal(stdout.trim(), '');
  assert.match(
    stderr,
    /voice-fidelity: ValidateRequest\.artifact/,
    `expected a named refusal citing "artifact"; got stderr: ${stderr}`,
  );
  assert.doesNotMatch(stderr, /TypeError|Cannot read propert/);
});

// AUDIT-20260727-05: `JSON.parse` returns not only objects but `null`, arrays,
// and scalars for well-formed-but-wrong-shape stdin -- and `typeof null ===
// 'object'`. A shape guard that assumed "parsed => object" would read a field
// off a non-object and throw the very raw TypeError (empty stdout) the guard
// exists to close. Each channel below must be refused BY NAME, with empty
// stdout and a non-zero exit, never a raw crash. (These are the sibling channels
// to the `{}` / missing-inputs / bad-artifact cases above, which are already
// records; these exercise the NON-record parse results specifically.)
for (const { label, stdin } of [
  { label: 'null', stdin: 'null' },
  { label: 'an array ([])', stdin: '[]' },
  { label: 'a bare number (42)', stdin: '42' },
  { label: 'a bare string ("a string")', stdin: '"a string"' },
  { label: 'a bare boolean (true)', stdin: 'true' },
]) {
  test(`voice-fidelity CLI (AUDIT-20260727-05): a non-object ValidateRequest (${label}) is refused by name, never a raw TypeError`, () => {
    const { code, stdout, stderr } = runFidelityBin(stdin);

    assert.notEqual(code, 0, `a non-object request (${label}) must never exit 0`);
    assert.equal(
      stdout.trim(),
      '',
      `no ValidateResponse is ever written to stdout for a non-object request (${label})`,
    );
    assert.match(
      stderr,
      /voice-fidelity: ValidateRequest must be a JSON object/,
      `expected a named refusal for a non-object request (${label}); got stderr: ${stderr}`,
    );
    assert.doesNotMatch(
      stderr,
      /TypeError|Cannot read propert/,
      `a non-object request (${label}) must be a named refusal, never a raw uncaught TypeError`,
    );
  });
}

// spec 006 T025 (contracts/fidelity-mode-agreement.md "ValidateRequest wire
// addition"): `requested_mode` is OPTIONAL, but a present-but-invalid value
// must be refused by name, never silently ignored or read as "not supplied".
test('voice-fidelity CLI (T025): a present-but-invalid requested_mode is refused by name', () => {
  const requestBadRequestedMode = {
    version: 1,
    target: 'edition',
    artifact: { path: '/tmp/does-not-matter.md', hash: 'sha256:' + 'a'.repeat(64) },
    inputs: {},
    requested_mode: 'draft',
  };

  const { code, stdout, stderr } = runFidelityBin(JSON.stringify(requestBadRequestedMode));

  assert.notEqual(code, 0, 'a present-but-invalid requested_mode must never exit 0');
  assert.equal(stdout.trim(), '', 'no ValidateResponse is ever written for a shape-invalid request');
  assert.match(
    stderr,
    /voice-fidelity: ValidateRequest\.requested_mode must be one of compose, revise/,
    `expected a named refusal citing "requested_mode"; got stderr: ${stderr}`,
  );
  assert.doesNotMatch(stderr, /TypeError|Cannot read propert/);
});

// A valid requested_mode ("compose"/"revise") must NOT be refused for its own
// sake at the shape-validation layer -- it should pass shape validation and
// reach the same downstream "inputs.source is required" refusal that any
// other shape-valid-but-incomplete request reaches (T025 only adds the wire
// field + its own validation; sequencing it into the mode-agreement check
// itself is T026, so this request still fails, but for the pre-existing
// missing-source reason, not for its requested_mode).
for (const requestedMode of ['compose', 'revise']) {
  test(`voice-fidelity CLI (T025): a valid requested_mode ("${requestedMode}") passes shape validation`, () => {
    const requestWithValidMode = {
      version: 1,
      target: 'edition',
      artifact: { path: '/tmp/does-not-matter.md', hash: 'sha256:' + 'a'.repeat(64) },
      inputs: {},
      requested_mode: requestedMode,
    };

    const { stderr } = runFidelityBin(JSON.stringify(requestWithValidMode));

    assert.doesNotMatch(
      stderr,
      /ValidateRequest\.requested_mode/,
      `a valid requested_mode ("${requestedMode}") must not be refused at shape validation; got stderr: ${stderr}`,
    );
    assert.match(
      stderr,
      /voice-fidelity: ValidateRequest\.inputs\.source is required/,
      `expected the request to reach the pre-existing missing-source refusal; got stderr: ${stderr}`,
    );
  });
}

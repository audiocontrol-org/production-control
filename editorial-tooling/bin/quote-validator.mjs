#!/usr/bin/env node
// quote-validator: production-control validator subprocess for the quote-bank
// target. Speaks the ValidateRequest/ValidateResponse wire contract on
// stdin/stdout (see specs/002-quote-bank/contracts/quote-validator.md). Plain
// ESM, no production-control import — reads only, writes nothing but the
// single ValidateResponse line on stdout.

import { readFileSync } from 'node:fs';
import { parseBank } from '../src/schema.mjs';
import { loadSources } from '../src/sources.mjs';
import { buildSourceMap, validateBank } from '../src/validator.mjs';

function fail(message) {
  process.stderr.write(`quote-validator: ${message}\n`);
  process.exit(1);
}

function main() {
  const raw = readFileSync(0, 'utf8');

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON on stdin: ${err.message}`);
    return;
  }

  const artifactPath = request?.artifact?.path;
  const sourcesPath = request?.inputs?.sources?.path;

  if (typeof artifactPath !== 'string' || artifactPath.length === 0) {
    fail("missing or invalid 'artifact.path' in request");
    return;
  }
  if (typeof sourcesPath !== 'string' || sourcesPath.length === 0) {
    fail("missing or invalid 'inputs.sources.path' in request");
    return;
  }

  let bankText;
  try {
    bankText = readFileSync(artifactPath, 'utf8');
  } catch (err) {
    fail(`cannot read artifact at '${artifactPath}': ${err.message}`);
    return;
  }

  // Shared loader (src/sources.mjs) — the SAME id->bytes mapping the miner used:
  // manifest ids when `sources.yaml` is present, the v1 filename-stem rule otherwise.
  // A refusal names every bad source at once. "No verdict" is never "passed" (FR-006b),
  // so a load refusal exits non-zero with a diagnostic and NOTHING on stdout.
  let files;
  try {
    files = loadSources(sourcesPath).files;
  } catch (err) {
    fail(err.message);
    return;
  }

  // Defense in depth: loadSources already refuses an ambiguous mapping, but the FR-018
  // check stays here so the validator's verdict never depends on the loader alone.
  const { sources, errors: mapErrors } = buildSourceMap(files);
  if (mapErrors.length > 0) {
    fail(`ambiguous source mapping:\n${mapErrors.join('\n')}`);
    return;
  }

  let bank;
  try {
    bank = parseBank(bankText);
  } catch (err) {
    fail(err.message);
    return;
  }

  const verdict = validateBank(bank, sources);

  if (verdict.advisories.length > 0) {
    process.stderr.write(`quote-validator advisories:\n${verdict.advisories.join('\n')}\n`);
  }

  const response =
    verdict.state === 'passed'
      ? { version: 1, state: 'passed' }
      : { version: 1, state: 'failed', errors: verdict.errors };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

main();

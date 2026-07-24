#!/usr/bin/env node
// quote-validator: production-control validator subprocess for the quote-bank
// target. Speaks the ValidateRequest/ValidateResponse wire contract on
// stdin/stdout (see specs/002-quote-bank/contracts/quote-validator.md). Plain
// ESM, no production-control import — reads only, writes nothing but the
// single ValidateResponse line on stdout.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseBank } from '../src/schema.mjs';
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

  let entries;
  try {
    entries = readdirSync(sourcesPath);
  } catch (err) {
    fail(`cannot read sources directory at '${sourcesPath}': ${err.message}`);
    return;
  }

  const files = [];
  for (const name of entries) {
    const fullPath = join(sourcesPath, name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch (err) {
      fail(`cannot stat source entry '${fullPath}': ${err.message}`);
      return;
    }
    if (!stats.isFile()) {
      continue;
    }
    const bytes = readFileSync(fullPath);
    files.push({ id: basename(name, extname(name)), bytes });
  }

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

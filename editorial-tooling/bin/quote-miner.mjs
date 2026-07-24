#!/usr/bin/env node
// quote-miner: production-control provider subprocess for the quote-bank
// target. Speaks the BuildRequest/BuildResponse wire contract on
// stdin/stdout (see specs/002-quote-bank/contracts/quote-miner.md). Plain
// ESM, no production-control import. Selects quotable passages via an
// injected model, grounds them deterministically, and writes the bank
// atomically into output_dir. Never emits a partial or replaced artifact on
// failure (FR-015/FR-016); never reports a validation verdict (FR-013).

import { readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { mine, serializeBank } from '../src/miner.mjs';
import { claudeModel } from '../src/claude.mjs';

function fail(message) {
  process.stderr.write(`quote-miner: ${message}\n`);
  process.exit(1);
}

function writeMiningReport(report) {
  const lines = [];
  lines.push(`selected: ${report.selected}`);
  lines.push(`grounded: ${report.grounded}`);
  lines.push(`omitted_ungrounded: ${report.omitted_ungrounded}`);
  lines.push(`sources_processed: ${report.sources_processed}`);
  lines.push(`sources_skipped: ${report.sources_skipped}`);
  lines.push(`sources_failed: ${report.sources_failed}`);
  for (const src of report.per_source ?? []) {
    lines.push(
      `source ${src.id}: selected=${src.selected} grounded=${src.grounded} omitted=${src.omitted}`
    );
  }
  process.stderr.write(lines.join('\n') + '\n');
}

async function main() {
  const raw = readFileSync(0, 'utf8');

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON on stdin: ${err.message}`);
    return;
  }

  const sourcesPath = request?.inputs?.sources?.path;
  const outputDir = request?.output_dir;

  if (typeof sourcesPath !== 'string' || sourcesPath.length === 0) {
    fail("missing or invalid 'inputs.sources.path' in request");
    return;
  }
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    fail("missing or invalid 'output_dir' in request");
    return;
  }

  let entries;
  try {
    entries = readdirSync(sourcesPath);
  } catch (err) {
    fail(`cannot read sources directory at '${sourcesPath}': ${err.message}`);
    return;
  }

  const sources = [];
  for (const name of entries) {
    const full = join(sourcesPath, name);
    let stats;
    try {
      stats = statSync(full);
    } catch (err) {
      fail(`cannot stat source entry '${full}': ${err.message}`);
      return;
    }
    if (!stats.isFile()) {
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(full);
    } catch (err) {
      fail(`cannot read source file '${full}': ${err.message}`);
      return;
    }
    sources.push({ id: basename(name, extname(name)), bytes });
  }

  const model = claudeModel();

  let result;
  try {
    result = await mine({ sources, model });
  } catch (err) {
    process.stderr.write(`quote-miner: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const yamlText = serializeBank(result.bank);
  const tmpPath = join(outputDir, '.quote-bank.yaml.tmp');
  const finalPath = join(outputDir, 'quote-bank.yaml');
  try {
    writeFileSync(tmpPath, yamlText, 'utf8');
    renameSync(tmpPath, finalPath);
  } catch (err) {
    fail(`cannot write bank to '${outputDir}': ${err.message}`);
    return;
  }

  writeMiningReport(result.report);

  const response = {
    version: 1,
    outputs: [{ path: 'quote-bank.yaml' }],
    tool: { name: 'quote-miner', version: `0.1.0+${model.id}` },
    impure: {
      reason: 'selects quotable passages via a language model; selection varies by model and run',
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

main();

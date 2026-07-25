#!/usr/bin/env node
// quote-miner: production-control provider subprocess for the quote-bank
// target. Speaks the BuildRequest/BuildResponse wire contract on
// stdin/stdout (see specs/002-quote-bank/contracts/quote-miner.md). Plain
// ESM, no production-control import. Selects quotable passages via an
// injected model, grounds them deterministically, and writes the bank
// atomically into output_dir. Never emits a partial or replaced artifact on
// failure (FR-015/FR-016); never reports a validation verdict (FR-013).

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { mine, serializeBank } from '../src/miner.mjs';
import { loadSources } from '../src/sources.mjs';
import { claudeModel } from '../src/claude.mjs';

function fail(message) {
  process.stderr.write(`quote-miner: ${message}\n`);
  process.exit(1);
}

// Per-source progress (TASK-10), written to STDERR the moment a source completes so a
// long run is observable while it runs. These are ADDITIONAL diagnostics: the final
// mining report below is unchanged (FR-017), and stdout stays exactly one BuildResponse.
function writeProgress(event) {
  process.stderr.write(
    `progress: ${event.index}/${event.total} ${event.id}` +
      ` selected=${event.selected} grounded=${event.grounded} omitted=${event.omitted}` +
      ` corrections=${event.corrections_applied}/${event.corrections_proposed}\n`
  );
}

function writeMiningReport(report) {
  const lines = [];
  lines.push(`selected: ${report.selected}`);
  lines.push(`grounded: ${report.grounded}`);
  lines.push(`omitted_ungrounded: ${report.omitted_ungrounded}`);
  lines.push(`sources_processed: ${report.sources_processed}`);
  lines.push(`sources_skipped: ${report.sources_skipped}`);
  lines.push(`sources_failed: ${report.sources_failed}`);
  // Disclosed OCR corrections (TASK-9): proposed by the model, applied only after the
  // tool verified `before` against the grounded source bytes, dropped otherwise.
  lines.push(`corrections_proposed: ${report.corrections_proposed}`);
  lines.push(`corrections_applied: ${report.corrections_applied}`);
  lines.push(`corrections_dropped: ${report.corrections_dropped}`);
  for (const src of report.per_source ?? []) {
    lines.push(
      `source ${src.id}: selected=${src.selected} grounded=${src.grounded} omitted=${src.omitted}` +
        ` corrections_proposed=${src.corrections_proposed}` +
        ` corrections_applied=${src.corrections_applied}` +
        ` corrections_dropped=${src.corrections_dropped}`
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

  // Shared loader (src/sources.mjs): manifest ids when `sources.yaml` is present, the
  // v1 filename-stem rule otherwise. A refusal names EVERY bad source at once, so a
  // large corpus is fixable in one pass instead of one run per bad file.
  let sources;
  try {
    sources = loadSources(sourcesPath).files;
  } catch (err) {
    fail(err.message);
    return;
  }

  const model = claudeModel();

  let result;
  try {
    result = await mine({ sources, model, onProgress: writeProgress });
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

  // PROVENANCE ORDERING (AUDIT-21/FR-020): the adapter only learns the REAL model the
  // CLI used from the response envelope, so the identity must be read AFTER mining.
  // Reading it earlier would stamp every bank with the command name (`claude`) and hide
  // a model swap behind a fixed command from producer-drift reporting.
  const response = {
    version: 1,
    outputs: [{ path: 'quote-bank.yaml' }],
    tool: { name: 'quote-miner', version: `0.1.0+${model.resolvedId()}` },
    impure: {
      reason: 'selects quotable passages via a language model; selection varies by model and run',
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

main();

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
import { claudeAgentModel } from '../src/claude-agent.mjs';

function fail(message) {
  process.stderr.write(`quote-miner: ${message}\n`);
  process.exit(1);
}

// WHICH MODEL ADAPTER MINES THIS CORPUS — an explicit operator choice, never an implicit
// one (`QUOTE_MINER_STRATEGY`):
//
//   per-source (DEFAULT) — src/claude.mjs: one `claude -p` per source. It needs only "a
//     CLI that takes a prompt and returns JSON", so it is the portable seam and the one
//     with the most test coverage. It also pays Claude Code's system-prompt and
//     tool-definition setup on every single source.
//
//   agent — src/claude-agent.mjs: one `claude` invocation per CHUNK of sources, fanned out
//     to one subagent per source. Dramatically cheaper on a large corpus (setup paid once
//     per chunk, and source text never enters a prompt), but Claude-Code-specific:
//     subagents, the Task and Read tools, `--json-schema`.
//
// The default stays per-source; the agent strategy is opt-in. An unrecognized value FAILS
// rather than quietly falling back — an operator who asked for the cheap path and silently
// got the expensive one would have no way to tell.
const STRATEGIES = new Map([
  ['per-source', () => claudeModel()],
  ['agent', () => claudeAgentModel({ onDiagnostic: writeUsage })],
]);

// Cost accounting from the batch envelope, stderr only. The whole reason the agent
// strategy exists is token cost, so it is reported rather than discarded.
function writeUsage(event) {
  process.stderr.write(
    `batch-usage: sources=${event.sources} turns=${event.num_turns}` +
      ` cache_creation_input_tokens=${event.cache_creation_input_tokens}` +
      ` cache_read_input_tokens=${event.cache_read_input_tokens}` +
      ` input_tokens=${event.input_tokens} output_tokens=${event.output_tokens}\n`
  );
}

// Per-source progress (TASK-10), written to STDERR the moment a source completes so a
// long run is observable while it runs. These are ADDITIONAL diagnostics: the final
// mining report below is unchanged (FR-017), and stdout stays exactly one BuildResponse.
//
// Sources are mined concurrently (TASK-11), so completions do not arrive in source order.
// The counter is `completed` — the number of sources DONE, which only ever climbs — so the
// line still reads as forward progress, while `[source N]` names which of the original
// sources this row is about.
//
// A source replayed from the cache is marked ` cache=hit` (src/cache.mjs). Without it, an
// operator watching a 123-source corpus fly past in seconds has no way to tell "resumed from
// disk" apart from "quietly did much less work". The marker is APPENDED and only for hits,
// so a run with no cache configured — still the default — emits exactly the line it always
// did; a resumed run is the one that reads differently, which is the right way round.
function writeProgress(event) {
  process.stderr.write(
    `progress: ${event.completed}/${event.total} ${event.id} [source ${event.index}]` +
      ` selected=${event.selected} grounded=${event.grounded} omitted=${event.omitted}` +
      ` corrections=${event.corrections_applied}/${event.corrections_proposed}` +
      `${event.from_cache ? ' cache=hit' : ''}\n`
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
  // RESUMPTION (src/cache.mjs). A run served from cache is dramatically cheaper than a
  // fresh one, so the report says how much of it was, which sources, and whether any
  // entries were unusable — a rotting cache shows up as a number rather than as a run that
  // is mysteriously slower than it should be.
  lines.push(`sources_from_cache: ${report.sources_from_cache}`);
  lines.push(`cached_sources: ${(report.cached_sources ?? []).join(', ')}`);
  lines.push(`cache_entries_ignored: ${report.cache_entries_ignored}`);
  lines.push(`model_identities: ${report.model_identities.join(', ')}`);
  // A resumed run may legitimately mix models (cached sources from an earlier model, fresh
  // ones from today's). That is a real provenance fact about the bank, so it is SHOUTED
  // rather than buried in a list an operator might skim past.
  if (report.model_identities.length > 1) {
    lines.push(
      `WARNING: this bank was built from ${report.model_identities.length} different model ` +
        `identities (${report.model_identities.join(', ')}); ` +
        `${report.sources_from_cache} of ${report.sources_processed} source(s) were replayed ` +
        'from the cache. Delete the cache directory and re-run for a single-model bank.'
    );
  }
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

/**
 * The model identity stamped into `tool.version`, which production-control records for
 * producer-drift reporting (FR-020). It must describe what ACTUALLY produced this bank.
 *
 * Three cases, chosen deterministically:
 *
 *   ONE identity — stamp it. This covers a fully cached run too, where the identity comes
 *   from the cache entries rather than from a model this process never called: stamping the
 *   configured-but-unused model would attribute the bank to something that produced none
 *   of it.
 *
 *   SEVERAL identities — a resumed run legitimately mixed models. Stamp
 *   `mixed(<id>+<id>+...)` over the SORTED identity list. Sorted so the tag is stable run to
 *   run, and explicitly labelled `mixed` so producer-drift reporting sees a mixed-provenance
 *   bank as its own distinct thing. Picking one identity would be the actively harmful
 *   option: it would claim uniformity that does not exist.
 *
 *   NONE (an empty corpus) — fall back to the adapter's own late-read identity, which is the
 *   only thing there is to say.
 *
 * @param {{ model_identities: string[] }} report
 * @param {{ resolvedId: () => string }} model
 * @returns {string}
 */
function provenanceTag(report, model) {
  const identities = report.model_identities;
  if (identities.length === 0) return model.resolvedId();
  if (identities.length === 1) return identities[0];
  return `mixed(${identities.join('+')})`;
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

  const strategyName = process.env.QUOTE_MINER_STRATEGY ?? 'per-source';
  const makeModel = STRATEGIES.get(strategyName);
  if (makeModel === undefined) {
    fail(
      `unknown QUOTE_MINER_STRATEGY '${strategyName}'; expected one of: ` +
        `${[...STRATEGIES.keys()].join(', ')}`
    );
    return;
  }
  const model = makeModel();

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
    tool: { name: 'quote-miner', version: `0.1.0+${provenanceTag(result.report, model)}` },
    impure: {
      reason: 'selects quotable passages via a language model; selection varies by model and run',
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

main();

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { parse as parseYamlText, stringify } from 'yaml';
import { z } from 'zod';
import { readLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  REPO_ROOT,
  StatusJsonSchema,
} from './support.js';

/**
 * T023 [US3] — a voice edit RESTALES its dependent editions, report-only; a producer/tool
 * VERSION change is reported as DRIFT, distinct from stale, and never auto-restales
 * (specs/004-voice-editions, US3 Acceptance Scenarios 1-2, FR-027, D18).
 *
 * D18/FR-027 requires REUSE of the EXISTING freshness/drift mechanisms — no `src/` change.
 * Every fact below rides mechanisms that already ship, over the EXISTING `voice-revise` fixture
 * (`tests/fixtures/voice-revise/`, T018/T020) exactly as `voice-inputs.test.ts` (T022) does:
 *
 *   1. **Restale.** `voice` is already a declared INPUT of the `edition` target (T022 fact 1) —
 *      an ordinary identity in `inputs`, resolved and hashed the same way `source` is. Editing
 *      `voice.yaml` changes what that identity resolves to, so `state/freshness.ts`'s
 *      `findMovedInput` (the declared-vs-recorded comparison already covering every input) finds
 *      `voice`'s current hash no longer matches what the ledger recorded at build time and
 *      reports `input-changed` — `resolveStatus` (`src/state/resolve.ts`) maps that straight to
 *      `stale`. Nothing new: this is the SAME path `swap.test.ts`'s "podcast reports stale
 *      because voiceover changed" case already exercises, with `voice` standing in for the
 *      dependency instead of a sibling derived node. And it is report-only by construction —
 *      `pc status` (`src/cli/status.ts`) never writes (FR-010): reading it can only ever compare,
 *      never rebuild, so the ledger record and the on-disk edition survive an arbitrary number of
 *      `pc status` calls unchanged, and only an explicit `pc build` would ever regenerate.
 *
 *   2. **Drift, not stale.** `producerDriftFor` (`src/state/resolve.ts`) reports drift by
 *      comparing `producer.tool`/`producer.version` ACROSS every artifact already recorded in one
 *      ledger — the exact mechanism `tests/unit/state/producer-drift.test.ts` (T061) and
 *      `swap.test.ts`'s "producer version drift is REPORTED and never by itself staling" (T072)
 *      already cover. This file mirrors `swap.test.ts`'s technique precisely: a second,
 *      independent target built by a STAND-IN script reporting the SAME tool name
 *      (`voice-revise`) the real provider reports, at a DIFFERENT version — written to the temp
 *      episode copy at test time, never into `tests/fixtures/` (real bytes, real subprocess, real
 *      ledger; no hand-authored ledger standing in for one). Two artifacts naming one tool at two
 *      recorded versions IS the drift (`producerDriftFor`'s own docstring); neither target's
 *      inputs or output ever move, so both stay `fresh` throughout.
 */

const TARGET = 'edition';
const REVISE_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-revise.mjs');
const FIDELITY_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-fidelity.mjs');
const STUB_MODEL = path.join(REPO_ROOT, 'tests', 'fixtures', 'voice-revise', 'stub-model.mjs');
const BUILD_ENV = { ...process.env, VOICE_REVISE_MODEL: `node ${STUB_MODEL}` };

const StatusResultSchema = StatusJsonSchema;

afterAll(cleanupFixtureCopies);

// ---------------------------------------------------------------------------
// Fact 1 — a voice edit restales the edition; reporting it is the whole effect (FR-027).
// ---------------------------------------------------------------------------

/** The single-target `voice-editions` profile, wired to the REAL provider/validator, exactly as `voice-revise.test.ts` and `voice-inputs.test.ts` wire it. */
async function singleTargetEpisode(): Promise<string> {
  const dir = await copyFixture('voice-revise');
  const profile = {
    version: 1,
    targets: {
      [TARGET]: {
        inputs: ['source', 'voice'],
        provider: {
          cmd: ['node', REVISE_BIN],
          impure: { reason: 'voice-freshness fixture target: model-produced edition' },
        },
        validator: { cmd: ['node', FIDELITY_BIN] },
      },
    },
  };
  await fs.writeFile(path.join(dir, 'voice-editions.yaml'), stringify(profile), 'utf8');
  return dir;
}

describe('T023 fact 1: editing the voice document RESTALES the edition — reported only, never auto-rebuilt', () => {
  it('a real build is fresh; editing `voice.yaml` alone reports `edition` stale via `input-changed` naming `voice`, and neither the ledger record nor the on-disk edition ever moves on their own', async () => {
    const dir = await singleTargetEpisode();

    const built = await pc(['build', TARGET, '--episode', dir, '--json'], { env: BUILD_ENV });
    expect(built.code, built.stderr).toBe(0);

    const beforeLedger = await readLedger(dir);
    const beforeRecord = beforeLedger.artifacts[TARGET];
    if (beforeRecord === undefined) {
      throw new Error(`no ledger record for "${TARGET}" after a build that reported success`);
    }
    const editionPath = path.join(dir, beforeRecord.output.path);
    const beforeBytes = await fs.readFile(editionPath, 'utf8');

    // Non-vacuity: before the edit, the edition is genuinely fresh.
    const preStatus = await pc(['status', '--episode', dir, '--json']);
    expect(preStatus.code, preStatus.stderr).toBe(0);
    const preNode = node(StatusResultSchema.parse(parseJsonText(preStatus.stdout)), TARGET);
    expect(preNode.state).toBe('fresh');
    expect(preNode.cause.code).toBe('ok');

    // A voice edit: append a materially different field to the voice document, changing its
    // content hash. A voice document is not decoration — it materially determines the output — so
    // editing it must be exactly as restale-worthy as editing the source draft.
    const voicePath = path.join(dir, 'voice.yaml');
    const voiceText = await fs.readFile(voicePath, 'utf8');
    await fs.writeFile(
      voicePath,
      `${voiceText}\nedited_marker: "T023 restale probe — a materially different voice edit"\n`,
      'utf8'
    );

    // THE ASSERTION: `edition` reports stale, naming `voice` as the input that moved.
    const postStatus = await pc(['status', '--episode', dir, '--json']);
    expect(postStatus.code, postStatus.stderr).toBe(0);
    const postNode = node(StatusResultSchema.parse(parseJsonText(postStatus.stdout)), TARGET);
    expect(postNode.state).toBe('stale');
    expect(postNode.cause.code).toBe('input-changed');
    expect(postNode.cause.identity).toBe('voice');

    // REPORT-ONLY: the ledger's record of the earlier build is byte-for-byte what it was, and the
    // edition on disk is untouched — asking `pc status` a stale question never rebuilds anything.
    // Regeneration remains the operator's explicit call (`pc build`), never a side effect of a
    // read verb.
    const afterLedger = await readLedger(dir);
    expect(afterLedger.artifacts[TARGET]).toEqual(beforeRecord);
    expect(await fs.readFile(editionPath, 'utf8')).toBe(beforeBytes);

    // And it does not decay or accumulate: asking again reports the identical fact, still without
    // touching anything.
    const postStatusAgain = await pc(['status', '--episode', dir, '--json']);
    expect(postStatusAgain.code, postStatusAgain.stderr).toBe(0);
    const postNodeAgain = node(
      StatusResultSchema.parse(parseJsonText(postStatusAgain.stdout)),
      TARGET
    );
    expect(postNodeAgain.state).toBe('stale');
    expect(postNodeAgain.cause.identity).toBe('voice');
    const afterLedgerAgain = await readLedger(dir);
    expect(afterLedgerAgain.artifacts[TARGET]).toEqual(beforeRecord);
    expect(await fs.readFile(editionPath, 'utf8')).toBe(beforeBytes);
  });
});

// ---------------------------------------------------------------------------
// Fact 2 — a producer/tool VERSION change is DRIFT, distinct from stale, and never restales
// (FR-016, applied to the voice-editions producer).
// ---------------------------------------------------------------------------

/**
 * A tiny CommonJS stand-in provider (mirrors `swap.test.ts`'s `providerSource` exactly), written
 * into the TEMP episode copy at test time — never into `tests/fixtures/`. It reports the SAME
 * tool name the real `voice-revise` binary reports (`'voice-revise'`, `voice-tooling/src/revise/emit.ts`),
 * at a version this test supplies — the only lever this file needs to create genuine producer
 * drift without ever touching `voice-tooling`'s own real `package.json` version (which would
 * change what EVERY OTHER test observes, not just this one).
 */
function driftProviderSource(toolVersion: string): string {
  return [
    "const { mkdirSync, writeFileSync } = require('node:fs');",
    "const { join } = require('node:path');",
    '',
    'function readStdin() {',
    '  return new Promise((resolve, reject) => {',
    '    const chunks = [];',
    "    process.stdin.on('data', (chunk) => chunks.push(chunk));",
    "    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));",
    "    process.stdin.on('error', reject);",
    '  });',
    '}',
    '',
    'readStdin().then((raw) => {',
    '  const request = JSON.parse(raw);',
    '  mkdirSync(request.output_dir, { recursive: true });',
    "  const outputName = request.target + '.out';",
    '  const identities = Object.keys(request.inputs).sort();',
    "  const lines = identities.map((id) => id + ':' + request.inputs[id].hash);",
    "  lines.push('target:' + request.target);",
    "  writeFileSync(join(request.output_dir, outputName), lines.join('\\n') + '\\n');",
    '  process.stdout.write(JSON.stringify({',
    '    version: 1,',
    '    outputs: [{ path: outputName }],',
    `    tool: { name: 'voice-revise', version: '${toolVersion}' },`,
    '  }));',
    '});',
    '',
  ].join('\n');
}

/** Writes the stand-in drift provider into `dir` and returns its `provider.cmd`. */
async function writeDriftProvider(
  dir: string,
  toolVersion: string
): Promise<readonly [string, string]> {
  const file = path.join(dir, 'drift-provider.cjs');
  await fs.writeFile(file, driftProviderSource(toolVersion), 'utf8');
  return [process.execPath, file] as const;
}

/**
 * Two INDEPENDENT targets, both fed directly from `source`/`voice` (never from each other) — the
 * shape `swap.test.ts`'s own drift scenario needs: if the second target derived from the first,
 * a version bump would also change an INPUT, and the drift would be entangled with a stale
 * question rather than isolated from one. `edition` is built by the REAL `voice-revise` binary;
 * `edition-drift` is built by the stand-in above, reporting the same tool name at a different
 * version. Writes the profile into `dir` (an already-copied fixture instance) and returns it.
 *
 * `buildGraph` (`src/graph/build.ts`) admits a profile target only when it is reachable from
 * `manifest.targets` — the closure the operator actually asked for, never the profile's whole
 * catalogue. `edition-drift` is a second, independent thing the operator asked for, so the
 * fixture's `episode.yaml` `targets:` list is extended to name it too (mirrors
 * `voice-inputs.test.ts`'s own pattern of rewriting the fixture manifest at test time for a fact
 * the base fixture does not already declare).
 */
async function driftEpisode(dir: string, driftCmd: readonly string[]): Promise<string> {
  const profile = {
    version: 1,
    targets: {
      [TARGET]: {
        inputs: ['source', 'voice'],
        provider: {
          cmd: ['node', REVISE_BIN],
          impure: { reason: 'voice-freshness fixture target: model-produced edition' },
        },
        validator: { cmd: ['node', FIDELITY_BIN] },
      },
      'edition-drift': {
        inputs: ['source', 'voice'],
        provider: { cmd: [...driftCmd] },
      },
    },
  };
  await fs.writeFile(path.join(dir, 'voice-editions.yaml'), stringify(profile), 'utf8');

  const manifestPath = path.join(dir, 'episode.yaml');
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = parseYamlText(manifestText) as Record<string, unknown>;
  manifest['targets'] = [TARGET, 'edition-drift'];
  await fs.writeFile(manifestPath, stringify(manifest), 'utf8');

  return dir;
}

const BuildProducerJsonSchema = z.object({
  producer: z.object({ tool: z.string(), version: z.string() }),
});

describe('T023 fact 2: a producer/tool VERSION change is reported as DRIFT, distinct from stale, and never restales', () => {
  it('two independent editions built by the same tool name at different recorded versions both stay `fresh` and both report the reciprocal drift', async () => {
    // The bumped version only has to differ from whatever `voice-revise`'s real package.json
    // reports right now — never hard-coded to a specific real value, since asserting drift must
    // not depend on knowing that number in advance.
    const driftVersion = '0.0.0-t023-drift-probe';

    const dir = await copyFixture('voice-revise');
    const driftCmd = await writeDriftProvider(dir, driftVersion);
    const episodeDir = await driftEpisode(dir, driftCmd);

    const editionBuilt = await pc(['build', TARGET, '--episode', episodeDir, '--json'], {
      env: BUILD_ENV,
    });
    expect(editionBuilt.code, editionBuilt.stderr).toBe(0);
    const editionAnswer = BuildProducerJsonSchema.parse(parseJsonText(editionBuilt.stdout));
    const realVersion = editionAnswer.producer.version;
    expect(realVersion).not.toBe(driftVersion);

    const driftBuilt = await pc(['build', 'edition-drift', '--episode', episodeDir, '--json']);
    expect(driftBuilt.code, driftBuilt.stderr).toBe(0);
    const driftAnswer = BuildProducerJsonSchema.parse(parseJsonText(driftBuilt.stdout));
    expect(driftAnswer.producer.version).toBe(driftVersion);

    const statusResult = await pc(['status', '--episode', episodeDir, '--json']);
    expect(statusResult.code, statusResult.stderr).toBe(0);
    const status = StatusResultSchema.parse(parseJsonText(statusResult.stdout));

    // THE ASSERTION. Both nodes stay fresh — a version bump elsewhere in the ledger never
    // restales a sibling that never itself moved — and each reports the OTHER's version as the
    // drift, never folded into `cause`.
    const editionNode = node(status, TARGET);
    expect(editionNode.state).toBe('fresh');
    expect(editionNode.cause.code).toBe('ok');
    expect(editionNode.producer_drift).toEqual({
      tool: 'voice-revise',
      recorded: realVersion,
      others: [driftVersion],
    });

    const driftNode = node(status, 'edition-drift');
    expect(driftNode.state).toBe('fresh');
    expect(driftNode.cause.code).toBe('ok');
    expect(driftNode.producer_drift).toEqual({
      tool: 'voice-revise',
      recorded: driftVersion,
      others: [realVersion],
    });

    // Drift is a fact about the ledger's history, not something that decays or accumulates:
    // reading status again, with no further build, reports exactly the same thing.
    const statusAgain = await pc(['status', '--episode', episodeDir, '--json']);
    expect(StatusResultSchema.parse(parseJsonText(statusAgain.stdout))).toEqual(status);
  });
});

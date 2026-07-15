import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { stringify } from 'yaml';
import { z } from 'zod';
import { hashFile } from '@/hash/content.js';
import { readLedger } from '@/ledger/store.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  FIXTURES,
  StatusJsonSchema,
  type StatusJson,
} from './support.js';

/**
 * User Story 5 — replacing a craft tool must not invalidate the production (T072, FR-034,
 * FR-016, contracts/provider.md).
 *
 * Every build in this file goes through the REAL `pc build`, spawning a REAL subprocess — never
 * a hand-written ledger standing in for one. The whole question this file answers is whether
 * rebinding `provider.cmd` to a genuinely different tool leaves the graph, the ledger, and the
 * oracle's answers valid, so a test that faked the ledger would answer a different, easier
 * question.
 *
 * Two tools participate, both written to the TEMP episode copy at test time (never into
 * `tests/fixtures/`, which is shared and committed) so their difference is visible in this file
 * rather than hidden in a second committed fixture:
 *
 *   - `FAKE_PROVIDER` — the committed test double (contracts/provider.md § Test double),
 *     reporting itself as `fake-provider` 1.0.0.
 *   - `otherProvider` — a second, unrelated tool. Different name (`other-tooling`), different
 *     version, and a DIFFERENT ENCODING of its output bytes, so the swap is observable in the
 *     artifact itself and not merely in the ledger's `producer` field.
 *   - `driftProvider` — reports the SAME name as the fake provider (`fake-provider`) at a
 *     DIFFERENT version, so building with it creates producer drift (FR-016) without swapping
 *     which tool is bound to anything.
 *
 * Both stand-ins are invoked as `[node, <script>]` — a legitimate `provider.cmd` (the contract
 * places no requirement that argv 0 be the tool itself; it must merely be "argv exactly as the
 * profile declares it") and one that sidesteps ESM/CJS module-type detection entirely, since a
 * script written into a bare temp directory has no `package.json` to declare one.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');
const NARRATION = 'assets/narration/take-01.wav';

/**
 * A tiny CommonJS provider (no `require`-of-anything-fancy, no template literals, no build
 * step) satisfying contracts/provider.md exactly: reads a `BuildRequest`, writes bytes derived
 * from its inputs, returns a well-formed `BuildResponse`. Plain CommonJS so it runs correctly
 * regardless of any `package.json` `"type"` field in whatever directory it lands in — the point
 * here is the swap, not module-resolution trivia.
 */
function providerSource(toolName: string, toolVersion: string, marker: string): string {
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
    // The content is deliberately NOT the fake provider's own encoding: a different marker,
    // built from the request in a different shape, so the produced bytes differ by
    // construction rather than by coincidence.
    `  const content = '${marker}:' + JSON.stringify(request.inputs) + ':' + request.target;`,
    '  writeFileSync(join(request.output_dir, outputName), content);',
    '  process.stdout.write(JSON.stringify({',
    '    version: 1,',
    '    outputs: [{ path: outputName }],',
    `    tool: { name: '${toolName}', version: '${toolVersion}' },`,
    "    validation: { state: 'passed' },",
    '  }));',
    '});',
    '',
  ].join('\n');
}

/**
 * Writes a provider script into the episode copy and returns its `provider.cmd`, as a genuine
 * 2-tuple (never a bare `string[]`) — so destructuring it back into `command` and `args` stays
 * exactly `string`, not `string | undefined`, under `noUncheckedIndexedAccess`.
 */
async function writeProvider(
  dir: string,
  filename: string,
  source: string
): Promise<readonly [string, string]> {
  const file = path.join(dir, filename);
  await fs.writeFile(file, source, 'utf8');
  return [process.execPath, file];
}

/**
 * The `chain` fixture (`voiceover ← [narration]`, `podcast ← [voiceover]`), profiled with
 * whatever `provider.cmd` each target is given — so a caller can bind `voiceover` to one tool
 * and rebind it later without touching `podcast`.
 */
async function chainEpisode(
  voiceoverCmd: readonly string[],
  podcastCmd: readonly string[]
): Promise<string> {
  const dir = await copyFixture('chain');
  await writeProfile(dir, voiceoverCmd, podcastCmd);
  return dir;
}

async function writeProfile(
  dir: string,
  voiceoverCmd: readonly string[],
  podcastCmd: readonly string[]
): Promise<void> {
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd: [...voiceoverCmd] } },
      podcast: { inputs: ['voiceover'], provider: { cmd: [...podcastCmd] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
}

/**
 * The `chain` fixture profiled with `voiceover` and `podcast` as two INDEPENDENT targets, both
 * fed directly from `narration` — the shape FR-016's drift scenario needs. If `podcast` derived
 * from `voiceover` (as in `chainEpisode` above), building `podcast` at a new tool version would
 * also make `voiceover` irrelevant to the comparison; independence is what isolates "a tool
 * moved" from "an input moved".
 */
async function writeIndependentProfile(
  dir: string,
  voiceoverCmd: readonly string[],
  podcastCmd: readonly string[]
): Promise<void> {
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd: [...voiceoverCmd] } },
      podcast: { inputs: ['narration'], provider: { cmd: [...podcastCmd] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
}

async function independentEpisode(
  voiceoverCmd: readonly string[],
  podcastCmd: readonly string[]
): Promise<string> {
  const dir = await copyFixture('chain');
  await writeIndependentProfile(dir, voiceoverCmd, podcastCmd);
  return dir;
}

async function build(dir: string, target: string) {
  return pc(['build', target, '--episode', dir]);
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

async function recordOf(dir: string, target: string): Promise<ArtifactRecord> {
  const ledger = await readLedger(dir);
  const record = ledger.artifacts[target];
  if (record === undefined) {
    const present = Object.keys(ledger.artifacts).join(', ');
    throw new Error(`No ledger record for "${target}". Recorded: ${present || '(none)'}.`);
  }
  return record;
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('rebinding a target to a DIFFERENT producing tool leaves the production valid (T072, FR-034)', () => {
  it('the graph still builds and validates, the prior record survives, and status still answers', async () => {
    const dir = await chainEpisode([FAKE_PROVIDER], [FAKE_PROVIDER]);

    expect((await build(dir, 'voiceover')).code).toBe(0);
    expect((await build(dir, 'podcast')).code).toBe(0);
    const voiceoverBefore = await recordOf(dir, 'voiceover');
    expect(voiceoverBefore.producer).toEqual({ tool: 'fake-provider', version: '1.0.0' });

    // Rebind voiceover to a DIFFERENT executable. Nobody rebuilds yet.
    const other = await writeProvider(
      dir,
      'other-provider.js',
      providerSource('other-tooling', '9.9.9', 'other-tooling')
    );
    await writeProfile(dir, other, [FAKE_PROVIDER]);

    // The graph still builds (buildGraph) and validates (validateGraph) with the new binding —
    // `pc status` exercises both on every call, and a structurally broken graph would refuse
    // here rather than answer.
    const afterRebind = await statusOf(dir);
    expect(node(afterRebind, 'voiceover').state).toBe('fresh');

    // The EXISTING ledger record is untouched and still means exactly what it did: built by
    // fake-provider 1.0.0, from these bytes. Rebinding a target's future producer does not
    // rewrite what a past build recorded.
    const voiceoverStillThere = await recordOf(dir, 'voiceover');
    expect(voiceoverStillThere).toEqual(voiceoverBefore);

    // Rebuild with the NEW tool. The output bytes are a different encoding entirely, so the
    // hash MUST move.
    expect((await build(dir, 'voiceover')).code).toBe(0);
    const rebuilt = await recordOf(dir, 'voiceover');
    expect(rebuilt.producer).toEqual({ tool: 'other-tooling', version: '9.9.9' });
    expect(rebuilt.output.hash).not.toBe(voiceoverBefore.output.hash);
    expect(rebuilt.output.hash).toBe(await hashFile(path.join(dir, 'dist/voiceover.out')));

    // Downstream, which never rebuilt, now reports stale — naming voiceover, because the bytes
    // it was built from really did change. Nothing here branched on WHICH tool produced them:
    // the same `pc build` / `pc status` surface handled fake-provider and other-tooling
    // identically (FR-034).
    const podcast = node(await statusOf(dir), 'podcast');
    expect(podcast.state).toBe('stale');
    expect(podcast.cause.code).toBe('input-changed');
    expect(podcast.cause.identity).toBe('voiceover');

    // And rebuilding podcast resolves it, through the identical build path.
    expect((await build(dir, 'podcast')).code).toBe(0);
    expect(node(await statusOf(dir), 'podcast').state).toBe('fresh');
  });
});

describe('producer version drift is REPORTED and never by itself staling (T072, FR-016)', () => {
  it('bumping a tool leaves every artifact fresh, with the drift surfaced BESIDE the state', async () => {
    const dir = await independentEpisode([FAKE_PROVIDER], [FAKE_PROVIDER]);
    const drift = await writeProvider(
      dir,
      'drift-provider.js',
      providerSource('fake-provider', '2.0.0', 'fake-provider')
    );

    // voiceover, built by fake-provider at 1.0.0 — recorded once and never touched again.
    expect((await build(dir, 'voiceover')).code).toBe(0);
    const voiceoverBefore = await recordOf(dir, 'voiceover');
    expect(voiceoverBefore.producer.version).toBe('1.0.0');

    // Non-vacuity: before the second build, there is only one recorded version of
    // `fake-provider`, so drift must be absent.
    const beforeDrift = await statusOf(dir);
    expect(node(beforeDrift, 'voiceover').producer_drift).toBeNull();

    // podcast, built by a tool reporting the SAME NAME at a DIFFERENT VERSION — this is what
    // creates the drift, and it happens WITHOUT touching voiceover at all.
    await writeIndependentProfile(dir, [FAKE_PROVIDER], drift);
    expect((await build(dir, 'podcast')).code).toBe(0);

    const status = await statusOf(dir);

    // ** THE ASSERTION. ** voiceover was never rebuilt, its recorded bytes are untouched, and it
    // is still `fresh` — a version bump elsewhere in the ledger must not restale it. The drift is
    // reported ALONGSIDE the state, never folded into it: `cause.code` stays `ok`, never
    // something like "producer-drift".
    const voiceover = node(status, 'voiceover');
    expect(voiceover.state).toBe('fresh');
    expect(voiceover.cause.code).toBe('ok');
    expect(voiceover.producer_drift).toEqual({
      tool: 'fake-provider',
      recorded: '1.0.0',
      others: ['2.0.0'],
    });

    // podcast, built by the newer version, is likewise fresh and reports the reciprocal drift.
    const podcast = node(status, 'podcast');
    expect(podcast.state).toBe('fresh');
    expect(podcast.cause.code).toBe('ok');
    expect(podcast.producer_drift).toEqual({
      tool: 'fake-provider',
      recorded: '2.0.0',
      others: ['1.0.0'],
    });

    // voiceover's own record is byte-for-byte what it was before the drift existed — nothing
    // about reading status a second time rewrote anything.
    expect(await recordOf(dir, 'voiceover')).toEqual(voiceoverBefore);

    // And reading status again, still without any further build, reports exactly the same
    // thing — drift is a fact about the ledger's history, not something that decays or
    // accumulates across reads.
    expect(await statusOf(dir)).toEqual(status);
  });
});

describe('a provider is runnable by hand, outside the system, with the same local inputs (FR-034 scenario 3)', () => {
  it('the fake provider and the swapped-in tool both run standalone against the recorded input', async () => {
    const dir = await chainEpisode([FAKE_PROVIDER], [FAKE_PROVIDER]);
    expect((await build(dir, 'voiceover')).code).toBe(0);

    // The exact request pc would have sent, assembled by hand from what is actually on disk —
    // no production-control process runs any of this.
    const outputDir = path.join(dir, 'dist', '.by-hand');
    await fs.mkdir(outputDir, { recursive: true });
    const requestJson = JSON.stringify({
      version: 1,
      target: 'voiceover',
      inputs: {
        narration: {
          path: path.join(dir, NARRATION),
          hash: await hashFile(path.join(dir, NARRATION)),
        },
      },
      output_dir: outputDir,
    });

    const other = await writeProvider(
      dir,
      'standalone-provider.js',
      providerSource('other-tooling', '1.0.0', 'other-tooling')
    );

    const { execFile } = await import('node:child_process');
    const run = (command: string, args: readonly string[]) =>
      new Promise<{ stdout: string }>((resolve, reject) => {
        const child = execFile(command, [...args], (error, stdout) => {
          if (error !== null) {
            reject(error instanceof Error ? error : new Error(`"${command}" failed to run`));
            return;
          }
          resolve({ stdout });
        });
        child.stdin?.end(requestJson);
      });

    const fromFake = await run(FAKE_PROVIDER, []);
    const [otherCommand, ...otherArgs] = other;
    const fromOther = await run(otherCommand, otherArgs);

    // Both are well-formed BuildResponses, produced with no production-control present.
    const ToolNameSchema = z.object({ tool: z.object({ name: z.string() }) });
    expect(ToolNameSchema.parse(parseJsonText(fromFake.stdout)).tool.name).toBe('fake-provider');
    expect(ToolNameSchema.parse(parseJsonText(fromOther.stdout)).tool.name).toBe('other-tooling');
  });
});

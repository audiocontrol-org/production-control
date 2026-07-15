import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { stringify } from 'yaml';
import { hashFile } from '@/hash/content.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
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
 * `pc build` — **building and recording as one indivisible act** (T053, T054, T055, FR-013,
 * FR-014, FR-017, FR-036, quickstart S5/S8).
 *
 * Every build here is a REAL one: the real `pc` binary spawns the real `tests/fixtures/fake-provider`
 * as a real subprocess, and every hash asserted against comes from `hashFile` over bytes that are
 * really on disk. Nothing in this file writes a ledger by hand to stand in for a build — the
 * whole question is whether `pc build` records what actually happened, and a hand-written record
 * would answer it by assumption.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');
const NARRATION = 'assets/narration/take-01.wav';

/**
 * The `chain` fixture with its profile pointed at the fake provider.
 *
 * The profile is written INTO the episode copy, which `loadProfile` searches before the shared
 * `profiles/` directory — so this shadows `profiles/editorial-audio.yaml` without touching the
 * committed one. The shared profile names craft tools nobody has installed (that is what
 * `offline.test.ts` proves), so it cannot be used to test a real build.
 *
 * The edges are the fixture's own: `voiceover ← [narration]`, `podcast ← [voiceover]`. That is
 * what makes the chain test at the bottom a test of transitive staleness rather than of two
 * unrelated builds.
 */
async function chainEpisode(cmd: readonly string[] = [FAKE_PROVIDER]): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd: [...cmd] } },
      podcast: { inputs: ['voiceover'], provider: { cmd: [...cmd] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

/** `FAKE_PROVIDER_MODE` reaches the provider through `pc`'s own environment, as it would in life. */
function withMode(mode: string): { readonly env: NodeJS.ProcessEnv } {
  return { env: { ...process.env, FAKE_PROVIDER_MODE: mode } };
}

async function build(dir: string, target: string, mode?: string) {
  const args = ['build', target, '--episode', dir];
  return mode === undefined ? pc(args) : pc(args, withMode(mode));
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

/** Reads a record, failing loudly (rather than returning undefined) when the build wrote none. */
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

describe('a build records what it actually did (T053, FR-013)', () => {
  it('**writes a record naming each input hash, the tool, and its version**', async () => {
    const dir = await chainEpisode();

    const result = await build(dir, 'voiceover');
    expect(result.stderr, 'build refused').toBe('');
    expect(result.code).toBe(0);

    const record = await recordOf(dir, 'voiceover');

    // The input hash, against the REAL bytes the provider was handed.
    expect(record.inputs.narration).toBe(await hashFile(path.join(dir, NARRATION)));

    // The tool and version, as the provider reported them (FR-016's basis).
    expect(record.producer).toEqual({ tool: 'fake-provider', version: '1.0.0' });

    // The output hash, computed by production-control from the ingested bytes — the provider
    // never reports one, and this is what a future `pc status` compares against.
    expect(record.output.path).toBe('dist/voiceover.out');
    expect(record.output.hash).toBe(await hashFile(path.join(dir, 'dist/voiceover.out')));

    // `built_at` is recorded (FR-013) — and read by nothing (research R7; asserted below).
    expect(new Date(record.built_at).toISOString()).toBe(record.built_at);

    // The provider's verdict, carried into the record rather than invented.
    expect(record.validation?.state).toBe('passed');

    // A referentially transparent provider declares itself by SAYING NOTHING (FR-032).
    expect(record.producer_impure).toBeUndefined();
  });

  it('**the recorded input hashes are the ones actually supplied** — change an input, rebuild, the record moves', async () => {
    const dir = await chainEpisode();
    await build(dir, 'voiceover');
    const before = await recordOf(dir, 'voiceover');

    // Revise the narration. The record must follow the BYTES, not a name or a path.
    await fs.appendFile(path.join(dir, NARRATION), 'a second take\n', 'utf8');
    const revised = await hashFile(path.join(dir, NARRATION));
    expect(revised, 'the fixture edit changed nothing').not.toBe(before.inputs.narration);

    expect((await build(dir, 'voiceover')).code).toBe(0);
    const after = await recordOf(dir, 'voiceover');

    // If this ever fails, the ledger is recording something other than what was fed in — and
    // every freshness answer downstream is computed against fiction.
    expect(after.inputs.narration).toBe(revised);
    expect(after.inputs.narration).not.toBe(before.inputs.narration);

    // The output moved with it (the fake provider derives its bytes from its inputs), and the
    // recorded output hash is again the real one.
    expect(after.output.hash).not.toBe(before.output.hash);
    expect(after.output.hash).toBe(await hashFile(path.join(dir, 'dist/voiceover.out')));
  });

  it("records an impure provider's REASON, not merely the fact (T060, FR-032)", async () => {
    const dir = await chainEpisode();

    expect((await build(dir, 'voiceover', 'impure')).code).toBe(0);
    const record = await recordOf(dir, 'voiceover');

    // The reason is the point: a bare flag says "expect different bytes", where this says which
    // KIND of impurity — and therefore whether it is fixable, incidental, or inherent.
    expect(record.producer_impure?.reason).toBe(
      'emits a per-run timestamp and random nonce; output varies by invocation'
    );

    // And the artifact is still fully recorded: impurity costs re-derivability, not provenance.
    // The podcast is built from THESE bytes, whose hash is recorded, whatever made them.
    expect(record.output.hash).toBe(await hashFile(path.join(dir, 'dist/voiceover.out')));
  });

  it('`built_at` is recorded and NEVER read by a decision (T060, research R7)', async () => {
    const dir = await chainEpisode();
    await build(dir, 'voiceover');
    const before = await statusOf(dir);

    // Rewrite the timestamp to something absurd — a year in the past, then a year in the future.
    // If any decision consulted it, one of these would move an answer.
    for (const at of ['2001-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z']) {
      const ledger = await readLedger(dir);
      const record = await recordOf(dir, 'voiceover');
      await writeLedger(dir, {
        ...ledger,
        artifacts: { ...ledger.artifacts, voiceover: { ...record, built_at: at } },
      });

      expect(
        await statusOf(dir),
        `rewriting built_at to ${at} changed an answer — a timestamp is deciding something`
      ).toEqual(before);
    }
  });
});

describe('a FAILED build writes no record claiming success (T053, FR-017)', () => {
  it('**leaves no record at all when the target was never built**', async () => {
    const dir = await chainEpisode();

    const result = await build(dir, 'voiceover', 'fail');
    expect(result.code).toBe(1);

    // The provider's own diagnostic is surfaced verbatim — it is the only account of what went
    // wrong, and paraphrasing it would throw that away.
    expect(result.stderr).toMatch(/simulated failure/);
    expect(result.stdout, 'a failed build wrote an answer to stdout').toBe('');

    // Nothing. Not a record with a null output, not a record marked failed — nothing.
    expect((await readLedger(dir)).artifacts).toEqual({});
  });

  it('**leaves a previous record untouched** — a failure never rewrites a success', async () => {
    const dir = await chainEpisode();
    expect((await build(dir, 'voiceover')).code).toBe(0);
    const before = await readLedger(dir);

    // The inputs move, so a rebuild is genuinely called for — and the rebuild fails.
    await fs.appendFile(path.join(dir, NARRATION), 'a second take\n', 'utf8');
    expect((await build(dir, 'voiceover', 'fail')).code).toBe(1);

    // The record still describes the build that DID happen. Silently updating it here would
    // claim the failed run produced the artifact on disk.
    expect(await readLedger(dir)).toEqual(before);

    // And the state is honest about it: the inputs moved, so the recorded artifact is stale.
    // The failed build did not quietly make it look current.
    expect(node(await statusOf(dir), 'voiceover').state).toBe('stale');
  });

  it('a provider that exits 0 with NO outputs is a failure, and records nothing ("silence is failure", FR-033)', async () => {
    const dir = await chainEpisode();

    const result = await build(dir, 'voiceover', 'silent');
    expect(result.code).toBe(1);
    expect((await readLedger(dir)).artifacts).toEqual({});
  });

  it('a provider that emits an UNDECLARED file is a failure, and records nothing (FR-033, contract Rule 5)', async () => {
    const dir = await chainEpisode();

    const result = await build(dir, 'voiceover', 'undeclared');
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/undeclared/i);
    expect((await readLedger(dir)).artifacts).toEqual({});
  });
});

/**
 * T054 — **the indivisibility of build-and-record, asserted against the SURFACE.**
 *
 * Every other test here proves that a build DOES record. These prove something stronger and
 * stranger: that there is no way to ask it not to. The guarantee FR-014 makes is the ABSENCE OF
 * AN ALTERNATIVE PATH, and an absence is only real if something checks for it — so this asserts
 * on the shipped CLI surface, which is the thing an operator or an agent could actually reach
 * for. If a `--no-record` flag or a `record` verb is ever added, these go red.
 */
describe('T054: there is NO path that builds without recording (FR-014, SC-009, quickstart S8)', () => {
  it('**`pc build --help` exposes no `--no-record`**', async () => {
    const result = await pc(['build', '--help']);
    expect(result.code).toBe(0);

    expect(result.stdout).toMatch(/--episode/); // non-vacuity: this IS build's help
    expect(result.stdout, 'a --no-record flag exists — FR-014 is gone').not.toMatch(/no-record/i);
    expect(result.stdout).not.toMatch(/--dry-run|--skip-record|--no-ledger/i);
  });

  it('**`pc --help` lists no `record` verb**', async () => {
    const result = await pc(['--help']);
    expect(result.code).toBe(0);

    expect(result.stdout).toMatch(/^\s+build\b/m); // non-vacuity: the verb list is really here
    expect(
      result.stdout,
      'a `record` verb exists — recording is separable, and FR-014 is gone'
    ).not.toMatch(/^\s+record\b/m);
  });

  it('the flag is not merely undocumented — `--no-record` is REFUSED, and nothing is built', async () => {
    // A help text that omits a flag which still works would be worse than a documented one.
    const dir = await chainEpisode();
    const result = await pc(['build', 'voiceover', '--no-record', '--episode', dir]);

    expect(result.code, 'exit 2: an unknown flag is the caller`s mistake (FR-035)').toBe(2);
    expect((await readLedger(dir)).artifacts).toEqual({});
    await expect(fs.stat(path.join(dir, 'dist/voiceover.out'))).rejects.toThrow();
  });

  it('the verb is not merely unlisted — `pc record` is REFUSED', async () => {
    const dir = await chainEpisode();
    const result = await pc(['record', 'voiceover', '--episode', dir]);

    expect(result.code).toBe(2);
    expect((await readLedger(dir)).artifacts).toEqual({});
  });
});

describe('T055: a missing provider fails loud, naming it (FR-036, spec § Edge Cases)', () => {
  const MISSING = '/nonexistent/pc-definitely-not-a-real-tool';

  it('**names the command that is missing** and exits 1', async () => {
    const dir = await chainEpisode([MISSING]);

    const result = await build(dir, 'voiceover');
    expect(result.code).toBe(1);

    // NAMING it is the requirement. "Build failed" would send an operator to read their manifest,
    // their inputs, and their profile before discovering the tool was simply not installed.
    expect(result.stderr).toContain(MISSING);
    expect(result.stderr).toMatch(/not found/i);
  });

  it('**does not skip the target, and substitutes no default**', async () => {
    const dir = await chainEpisode([MISSING]);
    await build(dir, 'voiceover');

    // No record — a skipped target reporting green is worse than a failure: a failure gets
    // fixed, a false green gets shipped.
    expect((await readLedger(dir)).artifacts).toEqual({});

    // No output invented in its place. Not an empty file, not a copy of an input.
    await expect(fs.stat(path.join(dir, 'dist/voiceover.out'))).rejects.toThrow();

    // And the oracle still says exactly what is true: it was never built.
    const voiceover = node(await statusOf(dir), 'voiceover');
    expect(voiceover.state).toBe('missing');
    expect(voiceover.cause.code).toBe('never-built');
  });

  it('an ABSENT INPUT is refused before the provider is ever invoked, naming the input (FR-030, FR-036)', async () => {
    const dir = await chainEpisode();
    await fs.rm(path.join(dir, NARRATION));

    const result = await build(dir, 'voiceover');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('narration');
    expect(result.stderr).toContain(NARRATION);
    expect((await readLedger(dir)).artifacts).toEqual({});
  });

  it('a derived input that was never built is refused, naming IT rather than the target', async () => {
    // `podcast ← [voiceover]`, and voiceover has never been built. The remedy is voiceover's, so
    // the message must be about voiceover.
    const dir = await chainEpisode();

    const result = await build(dir, 'podcast');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('voiceover');
    expect(result.stderr).toMatch(/never been built/i);
    expect((await readLedger(dir)).artifacts).toEqual({});
  });
});

describe('a real build feeds the real state model (FR-017a, quickstart S5)', () => {
  it('after a build the target is `fresh`; editing the output bytes makes it `modified`', async () => {
    const dir = await chainEpisode();
    expect((await build(dir, 'voiceover')).code).toBe(0);

    expect(node(await statusOf(dir), 'voiceover').state).toBe('fresh');

    // A human edits a machine-made file. Nothing about the inputs moved.
    await fs.appendFile(path.join(dir, 'dist/voiceover.out'), 'hand-tweaked\n', 'utf8');

    // `modified`, never `stale`: the remedies are opposite. Rebuilding a stale node is correct;
    // rebuilding this one destroys the edit (FR-017a). The check reads the record `pc build`
    // wrote — so this is FR-017a holding through a real build, not a hand-written ledger.
    const voiceover = node(await statusOf(dir), 'voiceover');
    expect(voiceover.state).toBe('modified');
    expect(voiceover.cause.code).toBe('output-edited');
  });

  it('**the chain: rebuilding `voiceover` makes `podcast` stale, naming it** (SC-003, FR-009)', async () => {
    const dir = await chainEpisode();

    // Two real builds, in order. podcast's declared input is voiceover's artifact.
    expect((await build(dir, 'voiceover')).code).toBe(0);
    expect((await build(dir, 'podcast')).code).toBe(0);

    // Non-vacuity: the chain starts clean. Every assertion below is about a signal TURNING ON.
    const clean = await statusOf(dir);
    expect(node(clean, 'voiceover').state).toBe('fresh');
    expect(node(clean, 'podcast').state).toBe('fresh');

    const podcastBefore = await recordOf(dir, 'podcast');

    // Rebuild voiceover from DIFFERENT content, so its output really moves.
    await fs.appendFile(path.join(dir, NARRATION), 'a second take\n', 'utf8');
    expect((await build(dir, 'voiceover')).code).toBe(0);
    expect((await recordOf(dir, 'voiceover')).output.hash).not.toBe(podcastBefore.inputs.voiceover);

    // ** THE ASSERTION. ** podcast is stale, and nothing propagated it: podcast's own recorded
    // input hash simply no longer matches what voiceover's record now claims. No walk over
    // consumers marked anything — if a propagation pass was ever written, it is a bug (FR-009).
    const podcast = node(await statusOf(dir), 'podcast');
    expect(podcast.state).toBe('stale');
    expect(podcast.cause.code).toBe('input-changed');
    expect(podcast.cause.identity, 'the cause must NAME what moved').toBe('voiceover');

    // podcast's record is untouched by voiceover's rebuild — it still states what podcast was
    // really built from. That is what makes the comparison above a comparison of two records.
    expect(await recordOf(dir, 'podcast')).toEqual(podcastBefore);

    // And rebuilding podcast resolves it, because the record then moves to the new bytes.
    expect((await build(dir, 'podcast')).code).toBe(0);
    expect(node(await statusOf(dir), 'podcast').state).toBe('fresh');
  });
});

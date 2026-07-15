import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  ReleaseCheckJsonSchema,
  StatusJsonSchema,
  type StatusJson,
} from './support.js';

/**
 * **Dual-signal independence** (T048, FR-022a, quickstart S7) — the subtlest requirement in the
 * spec.
 *
 * The `dual-signal` fixture is the one place an advisory edge and a real edge touch the same
 * node. `spoken` is BOTH the script `narration` is a performance of (`narration follows spoken`,
 * an observation) AND a declared input of `transcript` (`transcript ← [narration, spoken]`, a
 * dependency). One edit to `script.md` therefore poses two entirely different questions:
 *
 *   - to `narration`: "you are a recording of a script that changed — is take-03 still right?"
 *     Only a human can answer that, and the answer may well be "yes, it was a typo fix".
 *   - to `transcript`: "you were built from bytes that changed." A machine answers that, by
 *     rebuilding. No judgement is involved.
 *
 * **Two resolutions to two problems, and neither is the other.** Rebuilding the transcript
 * teaches nobody anything about whether take-03 still matches the script; waiving the review says
 * nothing about whether the transcript on disk was aligned against the current text. The failure
 * this file exists to catch is one signal being wired to clear the other — the cheapest,
 * most natural-looking implementation of "resolve the drift", and a false clean in both
 * directions: a rebuilt transcript would silently answer a human's question on their behalf, and
 * a waived review would silently mark a stale artifact as current.
 */

const BUILT_AT = '2026-07-15T00:00:00.000Z';
const REBUILT_AT = '2026-07-16T00:00:00.000Z';
const TRANSCRIPT_PATH = 'dist/transcript.txt';
const NARRATION_PATH = 'assets/narration/take-03.wav';

/**
 * Records `transcript` as built from whatever `narration` and `spoken` currently are — the
 * ledger write a real `pc build` will perform in Milestone 2, done by hand because Milestone 1
 * has no builder.
 *
 * Every hash comes from `hashFile` over bytes on disk. Fabricating one would make `transcript`
 * report `stale` from the first run, and the independence assertions would then pass or fail for
 * reasons having nothing to do with the two signals.
 *
 * `validation` is recorded `passed` alongside, standing in for the build-and-validate a human
 * would actually run, so that the release question below is answerable at all.
 */
async function recordTranscriptBuild(dir: string, bytes: string, at: string): Promise<void> {
  const narrationHash = await hashFile(path.join(dir, NARRATION_PATH));
  const spokenHash = await hashFile(path.join(dir, 'script.md'));

  await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
  await fs.writeFile(path.join(dir, TRANSCRIPT_PATH), bytes, 'utf8');
  const transcriptHash = await hashFile(path.join(dir, TRANSCRIPT_PATH));

  const ledger = await readLedger(dir);
  await writeLedger(dir, {
    ...ledger,
    artifacts: {
      ...ledger.artifacts,
      transcript: {
        producer: { tool: 'alignment-tooling', version: '1.0.0' },
        inputs: { narration: narrationHash, spoken: spokenHash },
        output: { path: TRANSCRIPT_PATH, hash: transcriptHash },
        built_at: at,
        validation: { state: 'passed', at },
      },
    },
  });
}

/**
 * The `dual-signal` fixture in a genuinely clean state: `transcript` built from the current
 * script and narration, and a waiver recording that a human HAS confirmed take-03 against the
 * script as it currently stands.
 *
 * Both are required for a clean start, and for different reasons — which is itself the shape of
 * FR-022a. Without the build, `transcript` is `missing`; without the review, `narration` is
 * `needs-review` because nobody has ever confirmed it. A test starting from either would not be
 * observing one edit fire two signals; it would be observing a signal that was already on.
 */
async function buildDualSignalEpisode(): Promise<string> {
  const dir = await copyFixture('dual-signal');

  await recordTranscriptBuild(dir, 'aligned transcript bytes', BUILT_AT);

  const spokenHash = await hashFile(path.join(dir, 'script.md'));
  const ledger = await readLedger(dir);
  await writeLedger(dir, {
    ...ledger,
    reviews: {
      narration: {
        waived_hash: spokenHash,
        reason: 'take-03 delivers this script as recorded',
        at: BUILT_AT,
      },
    },
  });

  return dir;
}

/** The one edit that poses both questions at once. */
async function reviseScript(dir: string): Promise<void> {
  await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');
}

/** What a machine does about `stale`: rebuild, and record the build. */
async function rebuildTranscript(dir: string): Promise<void> {
  await recordTranscriptBuild(dir, 'realigned transcript bytes', REBUILT_AT);
}

/** What a human does about `needs-review`: decide, and record the decision. */
async function waiveNarration(dir: string): Promise<void> {
  const result = await pc([
    'review',
    'narration',
    '--waive',
    '--reason',
    'the revision was a typo fix; take-03 still delivers it',
    '--episode',
    dir,
  ]);
  expect(result.stderr, 'review refused').toBe('');
  expect(result.code).toBe(0);
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('FR-022a: one edit, two independent signals', () => {
  it('the episode starts clean — narration present, transcript fresh', async () => {
    // Non-vacuity. Every assertion below is about a signal TURNING ON; if either were already on
    // here, the whole file would be measuring nothing.
    const status = await statusOf(await buildDualSignalEpisode());

    expect(node(status, 'spoken').state).toBe('present');
    expect(node(status, 'narration').state).toBe('present');
    expect(node(status, 'transcript').state).toBe('fresh');
  });

  it('**changing `spoken` raises needs-review on narration AND stale on transcript**', async () => {
    const dir = await buildDualSignalEpisode();
    await reviseScript(dir);

    const status = await statusOf(dir);

    // The HUMAN's question, on the node that follows the script.
    const narration = node(status, 'narration');
    expect(
      narration.state,
      'the script changed and the recording of it reported clean — the advisory edge is dead'
    ).toBe('needs-review');
    expect(narration.cause.identity, 'the question must name the script').toBe('spoken');

    // The MACHINE's question, on the node built from the script. Same edit, same instant, and
    // an entirely different kind of answer.
    const transcript = node(status, 'transcript');
    expect(
      transcript.state,
      'the transcript was built from bytes that changed and reported fresh — a declared input ' +
        'moved and nothing noticed'
    ).toBe('stale');
    expect(transcript.cause.identity).toBe('spoken');

    // Both. At once. Neither implies, suppresses, or stands in for the other — an implementation
    // that fired only one of these would pass a test that checked only one of these.
    expect([narration.state, transcript.state]).toEqual(['needs-review', 'stale']);
  });

  it('the two signals name the same cause but are of different KINDS — a rebuild resolves one, a human the other', async () => {
    const dir = await buildDualSignalEpisode();
    await reviseScript(dir);
    const status = await statusOf(dir);

    // `needs-review` is an authored state and `stale` is a derived one; the state model itself
    // keeps them apart (FR-006), which is why neither node can be talked into the other's state.
    expect(node(status, 'narration').kind).toBe('authored');
    expect(node(status, 'transcript').kind).toBe('derived');
  });
});

describe('FR-022a: rebuilding the derived output MUST NOT clear the review', () => {
  it('**transcript goes fresh again, and narration STILL needs review**', async () => {
    const dir = await buildDualSignalEpisode();
    await reviseScript(dir);
    await rebuildTranscript(dir);

    const status = await statusOf(dir);

    // The machine's problem is solved. Nothing was asked of a human to solve it.
    expect(node(status, 'transcript').state).toBe('fresh');

    // ** THE ASSERTION THIS FILE EXISTS FOR (first direction). **
    //
    // A rebuild is not an answer to "is take-03 still right?". Nobody listened to the audio;
    // nobody compared it to the new line. If a rebuild ever clears this, the system will have
    // answered a human's question on their behalf, by doing something entirely unrelated to it —
    // and it will report green while a recording drifts from the script it claims to deliver.
    expect(
      node(status, 'narration').state,
      "rebuilding the transcript cleared narration's review. A machine rebuilt an artifact; " +
        'that is not a human deciding take-03 still matches the script (FR-022a)'
    ).toBe('needs-review');
    expect(node(status, 'narration').cause.identity).toBe('spoken');

    // And the ledger agrees: the review baseline is untouched by a build. Only `pc review`
    // writes there.
    const ledger = await readLedger(dir);
    const currentSpoken = await hashFile(path.join(dir, 'script.md'));
    expect(
      ledger.reviews.narration?.waived_hash,
      'the build moved the review baseline — a build must never write a human decision'
    ).not.toBe(currentSpoken);
  });

  it('rebuilding does not silently invent or delete a review record', async () => {
    const dir = await buildDualSignalEpisode();
    const before = await readLedger(dir);
    await reviseScript(dir);
    await rebuildTranscript(dir);

    expect((await readLedger(dir)).reviews, 'a build touched the reviews').toEqual(before.reviews);
  });
});

describe("FR-022a: waiving the review MUST NOT change the derived output's state", () => {
  it('**narration clears to present, and transcript is STILL stale**', async () => {
    const dir = await buildDualSignalEpisode();
    await reviseScript(dir);
    await waiveNarration(dir);

    const status = await statusOf(dir);

    // The human's problem is solved: they listened, they decided, they recorded why.
    expect(node(status, 'narration').state).toBe('present');

    // ** THE ASSERTION THIS FILE EXISTS FOR (second direction). **
    //
    // A human saying "the recording is still fine" says NOTHING about the transcript, which was
    // aligned against text that no longer exists. If a waiver ever clears this, a human's
    // judgement about audio will have marked a genuinely out-of-date artifact as current — and
    // the transcript will ship describing a script nobody wrote.
    expect(
      node(status, 'transcript').state,
      "waiving narration's review made the transcript fresh. A human made a judgement about a " +
        'recording; that is not a rebuild of an artifact whose input moved (FR-022a)'
    ).toBe('stale');
    expect(node(status, 'transcript').cause.identity).toBe('spoken');

    // The build record is untouched: `pc review` writes a decision, never a build.
    const ledger = await readLedger(dir);
    const currentSpoken = await hashFile(path.join(dir, 'script.md'));
    expect(
      ledger.artifacts.transcript?.inputs.spoken,
      "the waiver rewrote the transcript's recorded inputs — a review must never fake a build"
    ).not.toBe(currentSpoken);
    expect(ledger.artifacts.transcript?.built_at).toBe(BUILT_AT);
  });

  it('waiving does not touch the derived output bytes', async () => {
    const dir = await buildDualSignalEpisode();
    const before = await fs.readFile(path.join(dir, TRANSCRIPT_PATH), 'utf8');

    await reviseScript(dir);
    await waiveNarration(dir);

    expect(await fs.readFile(path.join(dir, TRANSCRIPT_PATH), 'utf8')).toBe(before);
  });
});

describe('FR-022a: the two resolutions are separately required', () => {
  it('neither resolution alone releases the episode; both together do', async () => {
    // The capstone. Each signal must be resolved on its own terms, and the gate is what proves
    // the system never accepted one as payment for the other.
    const rebuiltOnly = await buildDualSignalEpisode();
    await reviseScript(rebuiltOnly);
    await rebuildTranscript(rebuiltOnly);
    expect(
      (await pc(['release-check', '--episode', rebuiltOnly])).code,
      'a rebuild alone released an episode with an open human question'
    ).toBe(1);

    const waivedOnly = await buildDualSignalEpisode();
    await reviseScript(waivedOnly);
    await waiveNarration(waivedOnly);
    expect(
      (await pc(['release-check', '--episode', waivedOnly])).code,
      'a waiver alone released an episode with a stale target'
    ).toBe(1);

    const both = await buildDualSignalEpisode();
    await reviseScript(both);
    await rebuildTranscript(both);
    await waiveNarration(both);

    const result = await pc(['release-check', '--episode', both, '--json']);
    expect(result.stderr, 'release-check refused').toBe('');
    expect(result.code).toBe(0);
    const verdict = ReleaseCheckJsonSchema.parse(parseJsonText(result.stdout));
    expect(verdict.releasable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it('the order of the two resolutions does not matter — they are independent, not sequenced', async () => {
    const dir = await buildDualSignalEpisode();
    await reviseScript(dir);

    // Waive FIRST, then rebuild. The reverse order is covered above; if one signal secretly
    // depended on the other, exactly one of these two orders would come out wrong.
    await waiveNarration(dir);
    await rebuildTranscript(dir);

    const status = await statusOf(dir);
    expect(node(status, 'narration').state).toBe('present');
    expect(node(status, 'transcript').state).toBe('fresh');
    expect((await pc(['release-check', '--episode', dir])).code).toBe(0);
  });
});

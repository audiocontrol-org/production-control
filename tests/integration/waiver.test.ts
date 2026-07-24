import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
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
 * `pc review <node> --waive --reason "<text>"` (T046, T047; FR-021, FR-022, FR-022b, SC-006,
 * quickstart S6).
 *
 * **The mechanism under test is `waived_hash`, not a flag.** A waiver pins the followed node's
 * hash at the moment of the decision, so it applies to THE CHANGE IT WAS RECORDED AGAINST and
 * nothing else. A boolean `waived: true` would pass a naive "waiving clears needs-review" test
 * and then silently swallow every subsequent revision of the script — the exact false-clean the
 * advisory edge exists to catch. The re-raise test below is therefore not an edge case; it is
 * the point, and it is the assertion that fails if anyone ever "simplifies" the pin away.
 */

const BUILT_AT = '2026-07-15T00:00:00.000Z';

/** The wire shape of `pc review --json`. Parsing IS the shape assertion (contracts/cli.md). */
const ReviewJsonSchema = z.object({
  episode: z.string(),
  node: z.string(),
  disposition: z.literal('waived'),
  follows: z.string(),
  waived_hash: z.string(),
  reason: z.string(),
  at: z.string(),
});

/**
 * The `advisory` fixture (`voiceover ← [narration]`, `podcast ← [voiceover]`, `narration follows
 * spoken`) genuinely BUILT, with both targets validated — and with NO review recorded.
 *
 * No `reviews` entry is the honest starting point for this file: nobody has ever confirmed that
 * take-03 answers this script, so narration reports `needs-review` on its own. That is the state
 * a waiver is FOR, and starting there means the first test observes the verb doing real work
 * rather than agreeing with a baseline the harness pre-installed.
 *
 * Every hash is computed from bytes that exist — never fabricated. A ledger pinned to an invented
 * hash would report `stale` from the first run and every assertion below would pass or fail for a
 * reason having nothing to do with waivers.
 *
 * The targets are validated `passed` so that the ONLY thing standing between this episode and a
 * release is the human question on narration. That isolation is what makes the release test below
 * mean what it says.
 */
async function buildAdvisoryEpisode(): Promise<string> {
  const dir = await copyFixture('advisory');

  const narrationHash = await hashFile(path.join(dir, 'assets/narration/take-03.wav'));

  await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
  await fs.writeFile(path.join(dir, 'dist/voiceover.wav'), 'mastered audio bytes', 'utf8');
  const voiceoverHash = await hashFile(path.join(dir, 'dist/voiceover.wav'));
  await fs.writeFile(path.join(dir, 'dist/podcast.mp3'), 'published audio bytes', 'utf8');
  const podcastHash = await hashFile(path.join(dir, 'dist/podcast.mp3'));

  await writeLedger(dir, {
    version: 1,
    artifacts: {
      voiceover: {
        producer: { tool: 'audio-tooling', version: '1.0.0' },
        inputs: { narration: narrationHash },
        output: { path: 'dist/voiceover.wav', hash: voiceoverHash },
        built_at: BUILT_AT,
        validation: { state: 'passed', at: BUILT_AT },
      },
      // podcast's recorded input is voiceover's recorded OUTPUT hash — two different records,
      // written at two different builds, whose agreement is what `fresh` means here.
      podcast: {
        producer: { tool: 'audio-tooling', version: '1.0.0' },
        inputs: { voiceover: voiceoverHash },
        output: { path: 'dist/podcast.mp3', hash: podcastHash },
        built_at: BUILT_AT,
        validation: { state: 'passed', at: BUILT_AT },
      },
    },
    reviews: {},
  });

  return dir;
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

/** The waiver as it exists ON DISK, re-read through the real reader — never an in-memory copy. */
async function waiverOnDisk(dir: string, id: string): Promise<unknown> {
  const ledger = await readLedger(dir);
  return ledger.reviews[id];
}

async function reviseScript(dir: string, line: string): Promise<void> {
  await fs.appendFile(path.join(dir, 'script.md'), `\n${line}\n`, 'utf8');
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('pc review --waive: a human decides, and the decision is recorded (FR-021)', () => {
  it('the episode starts with an unanswered question — narration needs review, nothing else does', async () => {
    // Without this, every assertion below could pass against an episode that was never in the
    // state a waiver is for.
    const status = await statusOf(await buildAdvisoryEpisode());

    const narration = node(status, 'narration');
    expect(narration.state).toBe('needs-review');
    expect(narration.cause.identity, 'the question must NAME the script it is about').toBe(
      'spoken'
    );

    // The advisory edge does not propagate: the targets are untouched by the open question.
    expect(node(status, 'voiceover').state).toBe('fresh');
    expect(node(status, 'podcast').state).toBe('fresh');
  });

  it('waiving with a reason clears needs-review to present, and the reason is IN the ledger', async () => {
    const dir = await buildAdvisoryEpisode();

    const result = await pc([
      'review',
      'narration',
      '--waive',
      '--reason',
      'take-03 delivers this script as recorded',
      '--episode',
      dir,
    ]);
    expect(result.stderr, 'review refused').toBe('');
    expect(result.code).toBe(0);

    // The question is answered.
    expect(node(await statusOf(dir), 'narration').state).toBe('present');

    // The REASON is the product here — a waiver whose reason is not recoverable is not a
    // record of a decision, it is just a suppressed signal.
    const waiver = await waiverOnDisk(dir, 'narration');
    expect(waiver).toMatchObject({ reason: 'take-03 delivers this script as recorded' });
  });

  it("pins the followed node's CURRENT hash — the waiver is against a specific script, hashed from real bytes", async () => {
    const dir = await buildAdvisoryEpisode();

    await pc(['review', 'narration', '--waive', '--reason', 'wording only', '--episode', dir]);

    // The pin is not a fabricated or placeholder string: it is the hash of the script.md that
    // was on disk at the moment of the decision. This is the assertion that makes the re-raise
    // test below meaningful rather than accidental.
    const spokenHash = await hashFile(path.join(dir, 'script.md'));
    const waiver = await waiverOnDisk(dir, 'narration');
    expect(waiver).toMatchObject({ waived_hash: spokenHash });
  });

  it('records a timestamp that is a real ISO-8601 UTC instant', async () => {
    const dir = await buildAdvisoryEpisode();
    await pc(['review', 'narration', '--waive', '--reason', 'wording only', '--episode', dir]);

    const waiver = await waiverOnDisk(dir, 'narration');
    const at = z.object({ at: z.string().datetime({ offset: true }) }).parse(waiver).at;
    expect(Number.isNaN(Date.parse(at)), `"${at}" is not a parseable instant`).toBe(false);
  });

  it('answers --json with the record it wrote', async () => {
    const dir = await buildAdvisoryEpisode();

    const result = await pc([
      'review',
      'narration',
      '--waive',
      '--reason',
      'wording only',
      '--episode',
      dir,
      '--json',
    ]);
    expect(result.code).toBe(0);

    const answer = ReviewJsonSchema.parse(parseJsonText(result.stdout));
    expect(answer.node).toBe('narration');
    expect(answer.follows).toBe('spoken');
    expect(answer.reason).toBe('wording only');

    // The answer describes the record that actually landed, not a hopeful echo of the request.
    expect(await waiverOnDisk(dir, 'narration')).toMatchObject({
      waived_hash: answer.waived_hash,
      reason: answer.reason,
      at: answer.at,
    });
  });
});

describe('FR-022: a waiver applies ONLY to the change it was recorded against', () => {
  it('**re-raises needs-review when the script changes AGAIN** — this is what waived_hash buys', async () => {
    const dir = await buildAdvisoryEpisode();

    await pc([
      'review',
      'narration',
      '--waive',
      '--reason',
      'take-03 delivers this script as recorded',
      '--episode',
      dir,
    ]);
    expect(node(await statusOf(dir), 'narration').state, 'the waiver never landed').toBe('present');

    // A SECOND revision of the script. The human accepted take-03 against the script as it stood;
    // they have said nothing whatsoever about this new line.
    await reviseScript(dir, 'A line nobody has recorded.');

    const status = await statusOf(dir);
    const narration = node(status, 'narration');

    // ** THE REGRESSION GUARD. **
    //
    // If `waived_hash` is ever replaced with a boolean — or the comparison is ever dropped —
    // this is the assertion that goes red, and it is the only one that does. Everything else in
    // this file passes happily against a waiver that silences the node forever, which is a
    // false clean: the narration would answer a script that no longer exists, and `pc status`
    // would report green about it.
    expect(
      narration.state,
      'the script changed after the waiver and narration reported clean — the waiver swallowed a ' +
        'revision no human ever saw (FR-022)'
    ).toBe('needs-review');
    expect(narration.cause.identity).toBe('spoken');

    // The old waiver is still on disk — re-raising is a comparison against the recorded
    // baseline, not a deletion of the record. The reason a human gave for the LAST decision
    // does not evaporate because a new question was asked.
    expect(await waiverOnDisk(dir, 'narration')).toMatchObject({
      reason: 'take-03 delivers this script as recorded',
    });
  });

  it('re-waiving the new change clears it again, against the new baseline', async () => {
    const dir = await buildAdvisoryEpisode();
    await pc(['review', 'narration', '--waive', '--reason', 'first pass', '--episode', dir]);
    await reviseScript(dir, 'A line nobody has recorded.');
    expect(node(await statusOf(dir), 'narration').state).toBe('needs-review');

    await pc(['review', 'narration', '--waive', '--reason', 'second pass', '--episode', dir]);

    expect(node(await statusOf(dir), 'narration').state).toBe('present');

    // The record now describes the NEW decision — reason and pin move together, so the ledger
    // never claims a reason was given about a script it was not given about.
    const spokenHash = await hashFile(path.join(dir, 'script.md'));
    expect(await waiverOnDisk(dir, 'narration')).toMatchObject({
      reason: 'second pass',
      waived_hash: spokenHash,
    });
  });
});

describe('FR-021: the waiver is durable and is not re-litigated on every run', () => {
  it('survives being re-read from disk, by a process that never saw the write', async () => {
    const dir = await buildAdvisoryEpisode();
    await pc(['review', 'narration', '--waive', '--reason', 'wording only', '--episode', dir]);

    // Re-read through the real reader: the waiver lives in the committed ledger, not in the
    // memory of the process that recorded it.
    const ledger = await readLedger(dir);
    expect(ledger.reviews.narration).toMatchObject({ reason: 'wording only' });

    // And a fresh `pc` process — a genuinely separate process from the one that waived — reads
    // it back as answered. Every invocation below is a new process, which is the whole claim.
    expect(node(await statusOf(dir), 'narration').state).toBe('present');
    expect(node(await statusOf(dir), 'narration').state).toBe('present');
    expect(node(await statusOf(dir), 'narration').state).toBe('present');
  });

  it('leaves the rest of the ledger exactly as it was — a waiver records a review, not a build', async () => {
    const dir = await buildAdvisoryEpisode();
    const before = await readLedger(dir);

    await pc(['review', 'narration', '--waive', '--reason', 'wording only', '--episode', dir]);

    const after = await readLedger(dir);
    expect(after.artifacts, 'waiving disturbed the build records').toEqual(before.artifacts);
    expect(after.version).toBe(before.version);
  });
});

describe('SC-006: an open question blocks release; a decided one does not', () => {
  it('an unwaived needs-review blocks release, naming narration', async () => {
    const dir = await buildAdvisoryEpisode();

    const result = await pc(['release-check', '--episode', dir, '--json']);
    // A gate ran and said no (FR-035).
    expect(result.code).toBe(1);

    const verdict = ReleaseCheckJsonSchema.parse(parseJsonText(result.stdout));
    expect(verdict.releasable).toBe(false);
    expect(verdict.blockers.map((blocker) => blocker.id)).toContain('narration');

    // The targets themselves are fine. The ONLY thing in the way is the human question — which
    // is what makes the next test's pass attributable to the waiver and nothing else.
    expect(verdict.blockers.map((blocker) => blocker.id)).toEqual(['narration']);
  });

  it('after waiving, release-check passes', async () => {
    const dir = await buildAdvisoryEpisode();
    await pc([
      'review',
      'narration',
      '--waive',
      '--reason',
      'take-03 delivers this script as recorded',
      '--episode',
      dir,
    ]);

    const result = await pc(['release-check', '--episode', dir, '--json']);
    expect(result.stderr, 'release-check refused').toBe('');
    expect(result.code).toBe(0);

    const verdict = ReleaseCheckJsonSchema.parse(parseJsonText(result.stdout));
    expect(verdict.releasable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it('a change after the waiver blocks release again — the gate re-closes with the question', async () => {
    const dir = await buildAdvisoryEpisode();
    await pc(['review', 'narration', '--waive', '--reason', 'wording only', '--episode', dir]);
    expect((await pc(['release-check', '--episode', dir])).code).toBe(0);

    await reviseScript(dir, 'A line nobody has recorded.');

    const result = await pc(['release-check', '--episode', dir, '--json']);
    expect(result.code, 'a waived-then-revised episode was reported releasable').toBe(1);
    const verdict = ReleaseCheckJsonSchema.parse(parseJsonText(result.stdout));
    expect(verdict.blockers.map((blocker) => blocker.id)).toContain('narration');
  });
});

// ---------------------------------------------------------------------------
// T047 — a waiver without a reason is not a decision (FR-022b)
// ---------------------------------------------------------------------------

describe('FR-022b: a waiver MUST carry a non-empty reason', () => {
  /** Every refusal must leave the ledger untouched — a refused waiver is not a partial one. */
  async function expectRefusedAndUnwritten(dir: string, args: readonly string[]): Promise<void> {
    const result = await pc(['review', 'narration', ...args, '--episode', dir]);

    // The CALLER made a mistake: not the production's fault, not a gate's verdict (FR-035).
    expect(result.code, `expected a usage refusal for: ${args.join(' ')}`).toBe(2);
    expect(result.stdout, 'a refusal wrote to stdout').toBe('');
    expect(result.stderr, 'the refusal did not name the reason').toMatch(/reason/i);

    // Nothing was recorded. A waiver that is refused but written anyway would be the worst of
    // both worlds: the signal silenced, with no decision behind it.
    expect(
      (await readLedger(dir)).reviews.narration,
      'a refused waiver was written to the ledger anyway'
    ).toBeUndefined();
    expect(node(await statusOf(dir), 'narration').state).toBe('needs-review');
  }

  it('refuses an EMPTY reason', async () => {
    await expectRefusedAndUnwritten(await buildAdvisoryEpisode(), ['--waive', '--reason', '']);
  });

  it('refuses a WHITESPACE-ONLY reason', async () => {
    await expectRefusedAndUnwritten(await buildAdvisoryEpisode(), [
      '--waive',
      '--reason',
      '   \t  ',
    ]);
  });

  it('refuses a reason of only newlines', async () => {
    await expectRefusedAndUnwritten(await buildAdvisoryEpisode(), ['--waive', '--reason', '\n\n']);
  });

  it('refuses a MISSING --reason', async () => {
    await expectRefusedAndUnwritten(await buildAdvisoryEpisode(), ['--waive']);
  });
});

describe('pc review: usage refusals name what is wrong (exit 2)', () => {
  it('refuses an unknown node, naming it and listing the known ones', async () => {
    const dir = await buildAdvisoryEpisode();
    const result = await pc([
      'review',
      'nonesuch',
      '--waive',
      '--reason',
      'wording only',
      '--episode',
      dir,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nonesuch');
    // "Unknown node" without the alternatives just moves the guess.
    expect(result.stderr).toContain('narration');
  });

  it('refuses a node with no `follows`, naming it — there is nothing to review', async () => {
    const dir = await buildAdvisoryEpisode();
    const result = await pc([
      'review',
      'spoken',
      '--waive',
      '--reason',
      'wording only',
      '--episode',
      dir,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('spoken');
    expect(result.stderr).toMatch(/follows/i);

    // Nothing was recorded against a node that tracks nothing.
    expect((await readLedger(dir)).reviews.spoken).toBeUndefined();
  });

  it('refuses a DERIVED node — a rebuild, not a review, is what resolves one', async () => {
    const dir = await buildAdvisoryEpisode();
    const result = await pc([
      'review',
      'voiceover',
      '--waive',
      '--reason',
      'wording only',
      '--episode',
      dir,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('voiceover');
    expect((await readLedger(dir)).reviews.voiceover).toBeUndefined();
  });

  it('refuses when no disposition is given at all', async () => {
    const dir = await buildAdvisoryEpisode();
    const result = await pc(['review', 'narration', '--reason', 'wording only', '--episode', dir]);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/--waive/);
    expect((await readLedger(dir)).reviews.narration).toBeUndefined();
  });

  it('refuses an unknown flag', async () => {
    const dir = await buildAdvisoryEpisode();
    const result = await pc([
      'review',
      'narration',
      '--waive',
      '--reason',
      'ok',
      '--nonesuch',
      '--episode',
      dir,
    ]);
    expect(result.code).toBe(2);
  });
});

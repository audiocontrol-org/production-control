import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import { writeLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  ExplainJsonSchema,
  StatusJsonSchema,
  type ExplainJson,
} from './support.js';

/**
 * `pc explain` (T043/T044, FR-011a).
 *
 * **The verb exists because the chain is counter-intuitive**, and this file is the proof.
 * With `profiles/editorial-audio.yaml` (`voiceover ← [narration]`, `podcast ← [voiceover]`,
 * `narration follows spoken`), revising `spoken` leaves `voiceover` and `podcast` FRESH and
 * raises `needs-review` on `narration`. The change flows THROUGH a human: only re-recording
 * narration carries it downstream. A reader who understands the design still predicts
 * `spoken → voiceover → podcast`, reasoning about the podcast as "a performance of the script"
 * rather than about the declared inputs — so an explanation implying that propagation would be
 * worse than no explanation at all.
 */

const BUILT_AT = '2026-07-15T00:00:00.000Z';

/**
 * The `advisory` fixture with voiceover and podcast genuinely BUILT, and a waiver recorded
 * against `spoken` as it currently stands.
 *
 * Every hash here is computed from real bytes on disk — never a fabricated string. A waiver
 * pinned to an invented hash would make the "revise and watch it re-raise" step below prove
 * nothing, because the baseline would never have matched in the first place.
 */
async function buildAdvisoryEpisode(): Promise<string> {
  const dir = await copyFixture('advisory');

  const spokenHash = await hashFile(path.join(dir, 'script.md'));
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
      },
      // podcast's recorded input is voiceover's recorded OUTPUT hash — the two different
      // records whose agreement is what "fresh" means for a derived node.
      podcast: {
        producer: { tool: 'audio-tooling', version: '1.0.0' },
        inputs: { voiceover: voiceoverHash },
        output: { path: 'dist/podcast.mp3', hash: podcastHash },
        built_at: BUILT_AT,
      },
    },
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

async function statusOf(dir: string): Promise<ReturnType<typeof StatusJsonSchema.parse>> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

async function explainOf(dir: string, target: string): Promise<ExplainJson> {
  const result = await pc(['explain', target, '--episode', dir, '--json']);
  expect(result.stderr, `explain ${target} refused`).toBe('');
  // A read verb: it answers, so it exits 0 (FR-035).
  expect(result.code).toBe(0);
  return ExplainJsonSchema.parse(parseJsonText(result.stdout));
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('pc explain: propagation halts at a human decision (FR-011a)', () => {
  it('the built episode starts clean — every node fresh or present', async () => {
    const dir = await buildAdvisoryEpisode();
    const status = await statusOf(dir);

    // Without this, every assertion below could pass for the wrong reason.
    expect(node(status, 'narration').state).toBe('present');
    expect(node(status, 'voiceover').state).toBe('fresh');
    expect(node(status, 'podcast').state).toBe('fresh');
  });

  it('revising `spoken` raises needs-review on narration and leaves voiceover and podcast FRESH', async () => {
    const dir = await buildAdvisoryEpisode();
    await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');

    const status = await statusOf(dir);

    // The human's question is raised, naming the node that moved.
    const narration = node(status, 'narration');
    expect(narration.state).toBe('needs-review');
    expect(narration.cause.identity).toBe('spoken');

    // And it goes NO FURTHER. `voiceover ← [narration]`, and narration's BYTES have not
    // changed — only the script it answers did. This is the whole design in two assertions.
    expect(node(status, 'voiceover').state).toBe('fresh');
    expect(node(status, 'podcast').state).toBe('fresh');
  });

  it('explains voiceover as fresh, halting the chain at narration and never reaching spoken', async () => {
    const dir = await buildAdvisoryEpisode();
    await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');

    const explained = await explainOf(dir, 'voiceover');
    expect(explained.state).toBe('fresh');

    const ids = explained.chain.map((link) => link.id);
    expect(ids).toEqual(['voiceover', 'narration']);

    // The link is NAMED as a dependency (FR-011a: "naming each link").
    const narration = explained.chain[1];
    expect(narration?.via).toBe('dependency');
    expect(narration?.from).toBe('voiceover');
    expect(narration?.state).toBe('needs-review');

    // The chain SAYS it stops, and says why.
    expect(narration?.halt?.kind).toBe('pending-human-decision');

    // **The assertion this verb exists for.** `spoken` changed, and `spoken` is nowhere in the
    // chain that explains voiceover — because it is not why voiceover is anything. Listing it
    // here would lay `spoken → voiceover` out on the page and invite exactly the propagation
    // the design forbids.
    expect(ids).not.toContain('spoken');
  });

  it('explains podcast without implying spoken -> voiceover -> podcast', async () => {
    const dir = await buildAdvisoryEpisode();
    await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');

    const explained = await explainOf(dir, 'podcast');
    expect(explained.state).toBe('fresh');

    const ids = explained.chain.map((link) => link.id);
    expect(ids).toEqual(['podcast', 'voiceover', 'narration']);
    expect(ids).not.toContain('spoken');

    // Each dependency link names the node it was reached from, so the path is unambiguous.
    expect(explained.chain[1]?.from).toBe('podcast');
    expect(explained.chain[2]?.from).toBe('voiceover');
    expect(explained.chain[2]?.halt?.kind).toBe('pending-human-decision');
  });

  it('distinguishes an observation from a dependency when explaining the node awaiting the decision', async () => {
    const dir = await buildAdvisoryEpisode();
    await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');

    const explained = await explainOf(dir, 'narration');
    expect(explained.state).toBe('needs-review');

    // Asked about narration itself, the chain DOES name spoken — that is the honest answer to
    // "why does narration need review?" — but it names the edge as an observation, and there
    // is no downstream node in this chain for a reader to propagate into.
    const observed = explained.chain.find((link) => link.id === 'spoken');
    expect(observed?.via).toBe('observation');
    expect(observed?.from).toBe('narration');
    expect(observed?.halt?.kind).toBe('observation-does-not-propagate');

    // The two relationship kinds are never rendered as the same arrow.
    expect(explained.chain[0]?.via).toBe('root');
    expect(explained.chain.map((link) => link.via)).not.toContain('dependency');
  });

  it('human output says the chain stops, in words', async () => {
    const dir = await buildAdvisoryEpisode();
    await fs.appendFile(path.join(dir, 'script.md'), '\nA revised line.\n', 'utf8');

    const result = await pc(['explain', 'podcast', '--episode', dir]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('podcast');
    expect(result.stdout).toContain('narration');
    expect(result.stdout).toMatch(/stops here/i);
    expect(result.stdout).toMatch(/human/i);
  });
});

describe('pc explain: the chain reaches the authored inputs responsible', () => {
  it('names each link back from a never-built target to its authored input', async () => {
    const explained = await explainOf('tests/fixtures/chain', 'podcast');

    const ids = explained.chain.map((link) => link.id);
    expect(ids).toEqual(['podcast', 'voiceover', 'narration']);

    // narration here is a plain authored node (no `follows`), so it is the natural end of the
    // chain: an authored input, arrived at. Not a halt — nothing surprising happened.
    const narration = explained.chain[2];
    expect(narration?.state).toBe('present');
    expect(narration?.halt).toBeNull();
  });
});

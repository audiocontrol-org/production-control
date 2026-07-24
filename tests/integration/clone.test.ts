import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import { writeLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyDir,
  copyFixture,
  node,
  parseJsonText,
  pc,
  ExplainJsonSchema,
  StatusJsonSchema,
  type ExplainJson,
  type StatusJson,
} from './support.js';

/**
 * A fresh clone answers from content and records alone (T026, SC-004, FR-015, quickstart S4).
 *
 * SC-004 is TWO properties, and they are not the same claim. Conflating them is the mistake this
 * file exists to prevent, in both directions:
 *
 *   1. **Timestamps are never a signal.** With the built bytes present, every answer is identical
 *      no matter what the filesystem says about when anything happened. Not one answer may move.
 *
 *   2. **Provenance survives the artifacts being gone.** `dist/` is gitignored and the ledger is
 *      committed, so a real clone has the records and none of the bytes. Every derived node then
 *      reports that it needs building ON ITS OWN ACCOUNT, and NO node is blocked on account of
 *      another node's absent artifact.
 *
 * Property 2's states deliberately do NOT match property 1's, and asserting that they differ is
 * itself load-bearing (see the last test). A clone genuinely has no artifacts; reporting them
 * fresh would assert that bytes nobody has are the bytes we recorded. A clone reports the same
 * *provenance*, not the same *artifacts*.
 */

const BUILT_AT = '2026-07-15T00:00:00.000Z';

/**
 * Where each derived node of the `chain` fixture records its output — its OWN account, and the
 * thing property 2 turns on. `podcast` must be reported against `dist/podcast.mp3` and never
 * against `dist/voiceover.wav`.
 */
const OUTPUT_PATHS = new Map<string, string>([
  ['voiceover', 'dist/voiceover.wav'],
  ['podcast', 'dist/podcast.mp3'],
]);

function outputPathOf(id: string): string {
  const recorded = OUTPUT_PATHS.get(id);
  if (recorded === undefined) {
    throw new Error(
      `No recorded output path for derived node "${id}". Known: ${[...OUTPUT_PATHS.keys()].join(', ')}. ` +
        `The fixture grew a derived node this test does not know how to check, which would make ` +
        `the "on its own account" assertion skip it silently.`
    );
  }
  return recorded;
}

/**
 * The `chain` fixture (`podcast ← voiceover ← narration`) genuinely BUILT: real output bytes on
 * disk, and a ledger whose every hash is computed from them.
 *
 * Every hash here comes from `hashFile` over bytes that exist — never a fabricated string. A
 * ledger pinned to an invented hash would report `stale` from the first run, and every assertion
 * below would then pass or fail for a reason having nothing to do with cloning.
 */
async function buildChainEpisode(): Promise<string> {
  const dir = await copyFixture('chain');

  const narrationHash = await hashFile(path.join(dir, 'assets/narration/take-01.wav'));

  await fs.mkdir(path.join(dir, 'dist'), { recursive: true });

  const voiceoverPath = outputPathOf('voiceover');
  await fs.writeFile(path.join(dir, voiceoverPath), 'mastered audio bytes', 'utf8');
  const voiceoverHash = await hashFile(path.join(dir, voiceoverPath));

  const podcastPath = outputPathOf('podcast');
  await fs.writeFile(path.join(dir, podcastPath), 'published audio bytes', 'utf8');
  const podcastHash = await hashFile(path.join(dir, podcastPath));

  await writeLedger(dir, {
    version: 1,
    artifacts: {
      voiceover: {
        producer: { tool: 'audio-tooling', version: '1.0.0' },
        inputs: { narration: narrationHash },
        output: { path: voiceoverPath, hash: voiceoverHash },
        built_at: BUILT_AT,
      },
      // podcast's recorded input is voiceover's recorded OUTPUT hash — two different records,
      // written at two different builds, whose agreement is what `fresh` means here.
      podcast: {
        producer: { tool: 'audio-tooling', version: '1.0.0' },
        inputs: { voiceover: voiceoverHash },
        output: { path: podcastPath, hash: podcastHash },
        built_at: BUILT_AT,
      },
    },
    reviews: {},
  });

  return dir;
}

/**
 * A clone of a built episode WITH its artifacts — the S4a shape. `dist/` and
 * `.production/ledger.yaml` both come along, because the question here is only about times.
 */
async function cloneWithArtifacts(built: string): Promise<string> {
  const clone = await copyDir(built, 'clone-with-dist');
  await expect(
    fs.stat(path.join(clone, 'dist/voiceover.wav')),
    'the clone was taken without the artifacts; property 1 would be testing the wrong thing'
  ).resolves.toBeDefined();
  return clone;
}

/**
 * A clone of a built episode WITHOUT its artifacts — what a real clone looks like (S4b). The
 * repo's `.gitignore` carries `dist/`, which matches the nested `dist/` under any episode, so a
 * `git clone` brings the committed ledger and none of the built bytes (FR-015).
 */
async function cloneWithoutArtifacts(built: string): Promise<string> {
  const clone = await copyDir(built, 'clone-no-dist');
  await fs.rm(path.join(clone, 'dist'), { recursive: true, force: true });

  // Non-vacuity, in both directions: the bytes really are gone, and the records really came.
  await expect(fs.stat(path.join(clone, 'dist')), 'dist/ survived the clone').rejects.toThrow();
  await expect(
    fs.stat(path.join(clone, '.production/ledger.yaml')),
    'the ledger did not survive the clone; FR-015 is not being tested at all'
  ).resolves.toBeDefined();

  return clone;
}

const EPOCH = new Date(0);
const FAR_FUTURE = new Date('2099-12-31T23:59:59.000Z');

/** Every path under `dir`, deepest first, with `dir` itself last. */
async function pathsDeepestFirst(dir: string): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await pathsDeepestFirst(full)));
    } else {
      found.push(full);
    }
  }
  found.push(dir);
  return found;
}

/**
 * Rewrites the modification time of EVERY file and directory under `dir` — the artifacts, the
 * authored inputs, the ledger, the manifest, the directories themselves.
 *
 * `fs.utimes` with a stated time rather than `touch`: `touch` sets "now", which is only a few
 * milliseconds from the times a fresh copy already carries, so a surviving mtime comparison
 * could plausibly still come out the same way by luck. An explicit epoch — and an explicit far
 * future — cannot.
 *
 * Deepest-first so a directory's own time is set after its children's.
 */
async function rewriteEveryMtime(dir: string, when: (fullPath: string) => Date): Promise<void> {
  for (const full of await pathsDeepestFirst(dir)) {
    const stamp = when(full);
    await fs.utimes(full, stamp, stamp);
  }
}

function isArtifact(fullPath: string): boolean {
  return fullPath.split(path.sep).includes('dist');
}

async function mtimeOf(dir: string, relPath: string): Promise<number> {
  return (await fs.stat(path.join(dir, relPath))).mtimeMs;
}

async function statusOf(dir: string): Promise<StatusJson> {
  const result = await pc(['status', '--episode', dir, '--json']);
  expect(result.stderr, 'status refused').toBe('');
  expect(result.code).toBe(0);
  return StatusJsonSchema.parse(parseJsonText(result.stdout));
}

async function explainOf(dir: string, target: string): Promise<ExplainJson> {
  const result = await pc(['explain', target, '--episode', dir, '--json']);
  expect(result.stderr, `explain ${target} refused`).toBe('');
  expect(result.code).toBe(0);
  return ExplainJsonSchema.parse(parseJsonText(result.stdout));
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('SC-004 property 1: a timestamp is never a signal', () => {
  it('baseline — the built episode reports every node fresh or present', async () => {
    // Without this, every assertion below could pass while comparing two identical piles of
    // wrong answers.
    const status = await statusOf(await buildChainEpisode());
    expect(node(status, 'narration').state).toBe('present');
    expect(node(status, 'spoken').state).toBe('present');
    expect(node(status, 'voiceover').state).toBe('fresh');
    expect(node(status, 'podcast').state).toBe('fresh');
  });

  it('a clone WITH its artifacts answers identically after every mtime is rewritten', async () => {
    const built = await buildChainEpisode();
    const original = await statusOf(built);
    const clone = await cloneWithArtifacts(built);

    // Round 1 — everything at the epoch. Whole-report equality, not a state-by-state spot
    // check: SC-004 says not one answer may move, and that includes every cause message and
    // every recorded hash quoted inside one.
    await rewriteEveryMtime(clone, () => EPOCH);
    expect(await mtimeOf(clone, 'dist/voiceover.wav'), 'the epoch rewrite did not land').toBe(0);
    expect(await statusOf(clone)).toEqual(original);

    // Round 2 — the inputs in the far future, the artifacts at the epoch. This is the
    // make-style relation INVERTED: every input is now "newer" than the output built from it,
    // which is the exact arrangement that makes a timestamp-based tool rebuild the world. The
    // answers still may not move.
    await rewriteEveryMtime(clone, (full) => (isArtifact(full) ? EPOCH : FAR_FUTURE));
    expect(await mtimeOf(clone, 'dist/voiceover.wav')).toBe(0);
    expect(
      await mtimeOf(clone, 'assets/narration/take-01.wav'),
      'the far-future rewrite did not land, so the inversion never happened'
    ).toBeGreaterThan(Date.now());
    expect(await statusOf(clone)).toEqual(original);
  });
});

describe('SC-004 property 2: provenance survives the artifacts being gone (FR-015)', () => {
  it("no node is blocked on another node's absent artifact, and each needs building on its own account", async () => {
    const status = await statusOf(await cloneWithoutArtifacts(await buildChainEpisode()));

    // ** THE REGRESSION GUARD, first so its failure is the message a reader sees. **
    //
    // The bug was real: resolving a derived input by hashing the bytes at its `output.path`
    // made `podcast` report `blocked` naming `voiceover`'s missing bytes — one absent directory
    // becoming a cascade of blame pointing at innocent upstream nodes. A node is `blocked` only
    // when an input genuinely has no answer. An artifact that was built, recorded, and simply is
    // not present in this working tree is not that: its record answers for it (S4b).
    const blocked = status.nodes.filter((reported) => reported.state === 'blocked');
    expect(
      blocked.map((reported) => `${reported.id}: ${reported.cause.message}`),
      "A clone has no dist/. No node may be blamed for another node's absent artifact — the " +
        'ledger records what each was built from, and that record answers for the bytes.'
    ).toEqual([]);

    const derived = status.nodes.filter((reported) => reported.kind === 'derived');
    expect(
      derived.map((reported) => reported.id).sort(),
      'the fixture no longer has the derived nodes this test checks; it would be vacuous'
    ).toEqual(['podcast', 'voiceover']);

    for (const reported of derived) {
      const own = outputPathOf(reported.id);

      // It needs building, and it says so about ITSELF.
      expect(reported.state, `"${reported.id}" should report that IT is not built here`).toBe(
        'missing'
      );
      expect(reported.cause.code).toBe('path-absent');
      expect(
        reported.cause.message,
        `"${reported.id}" must name its OWN output path ("${own}")`
      ).toContain(own);

      // `missing` on its own account carries no identity: there is no other node at fault.
      expect(
        reported.cause.identity,
        `"${reported.id}" named "${String(reported.cause.identity)}" as responsible for its own unbuilt output`
      ).toBeNull();

      // And it blames nobody else's bytes.
      for (const other of derived) {
        if (other.id === reported.id) {
          continue;
        }
        expect(
          reported.cause.message,
          `"${reported.id}" is reported against "${other.id}"'s artifact`
        ).not.toContain(outputPathOf(other.id));
      }
    }

    // The specific wrong-node cascade, named. `podcast` is not blocked on `voiceover`; nothing
    // about `voiceover` is podcast's problem.
    expect(node(status, 'podcast').cause.message).not.toContain('voiceover');
  });

  it('the provenance chain is still answerable end to end with the built bytes gone', async () => {
    const clone = await cloneWithoutArtifacts(await buildChainEpisode());

    // Provenance is the product; the artifacts are reproducible from it. With not one built byte
    // present, every link back to the authored input is still named (SC-002, FR-015).
    const explained = await explainOf(clone, 'podcast');
    expect(explained.chain.map((link) => link.id)).toEqual(['podcast', 'voiceover', 'narration']);
    expect(explained.chain[1]?.from).toBe('podcast');
    expect(explained.chain[2]?.from).toBe('voiceover');

    // The chain reaches a real authored input that IS here — which is why nothing is blocked.
    expect(explained.chain[2]?.state).toBe('present');
    expect(explained.chain[2]?.halt).toBeNull();
  });

  it('does NOT report what property 1 reports — a clone has no artifacts, and reporting them fresh would be a lie about bytes nobody has', async () => {
    const built = await buildChainEpisode();
    const withArtifacts = await statusOf(built);
    const withoutArtifacts = await statusOf(await cloneWithoutArtifacts(built));

    // This assertion exists so nobody "restores" the old false claim that a clone reports
    // identically in every respect. It must not be deleted to make a stronger-sounding one pass.
    expect(
      withoutArtifacts,
      'a clone with no built bytes reported exactly what a working copy with them reports'
    ).not.toEqual(withArtifacts);

    expect(node(withArtifacts, 'voiceover').state).toBe('fresh');
    expect(node(withoutArtifacts, 'voiceover').state).toBe('missing');
    expect(node(withArtifacts, 'podcast').state).toBe('fresh');
    expect(node(withoutArtifacts, 'podcast').state).toBe('missing');

    // What legitimately does NOT vary: the authored content, which is committed and therefore
    // present in both. The reasoning never varies; only what happens to be built locally does.
    expect(node(withoutArtifacts, 'narration')).toEqual(node(withArtifacts, 'narration'));
    expect(node(withoutArtifacts, 'spoken')).toEqual(node(withArtifacts, 'spoken'));
  });
});

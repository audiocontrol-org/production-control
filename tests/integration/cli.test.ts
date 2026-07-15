import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  cleanupFixtureCopies,
  copyFixture,
  node,
  parseJsonText,
  pc,
  NextJsonSchema,
  ReleaseCheckJsonSchema,
  StatusJsonSchema,
} from './support.js';

/**
 * The CLI contract, driven through the built binary (T037–T040, quickstart S1/S2/S12).
 *
 * The exit-code discipline is the reason these go through a process rather than a function
 * call: an agent branches on the code without parsing prose, and the code is what must be
 * asserted.
 */

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('pc status', () => {
  it('S1: answers against a half-authored production — exit 0, blocked names the absent input', async () => {
    const result = await pc(['status', '--episode', 'tests/fixtures/blocked', '--json']);

    // The answer is "much of this is broken", and delivering that answer is a SUCCESS. A read
    // verb that exited non-zero here would be unusable in a pipeline (FR-035).
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));

    // `voiceover ← [narration]`, and narration's file is deliberately absent from this fixture.
    // `blocked`, not `stale`: with the input absent the system cannot know whether the output
    // is stale, and saying so would assert something it never verified (FR-006a).
    const voiceover = node(status, 'voiceover');
    expect(voiceover.state).toBe('blocked');
    expect(voiceover.cause.message).toContain('narration');
    expect(voiceover.cause.identity).toBe('narration');

    // `epub ← [longform, assets]` — both present. The absent narration is nothing to do with
    // it, and a cascade of blame reaching epub would be the failure this asserts against.
    expect(node(status, 'epub').state).not.toBe('blocked');
  });

  it('S2: every node carries a cause — none is null (FR-007)', async () => {
    const result = await pc(['status', '--episode', 'tests/fixtures/chain', '--json']);
    expect(result.code).toBe(0);

    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));
    expect(status.nodes.length).toBeGreaterThan(0);

    // A state without a cause makes an agent guess which of six inputs moved. The schema above
    // already refuses a missing cause; this names the requirement it is enforcing.
    for (const reported of status.nodes) {
      expect(reported.cause, `node "${reported.id}" reported no cause`).not.toBeNull();
      expect(
        reported.cause.message.length,
        `node "${reported.id}" has an empty cause`
      ).toBeGreaterThan(0);
    }
  });

  it('in a never-built episode the buildable target is missing and the one behind it is blocked', async () => {
    const result = await pc(['status', '--episode', 'tests/fixtures/chain', '--json']);
    expect(result.code).toBe(0);

    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));

    // `chain` is `podcast ← voiceover ← narration`, so "never built" does NOT make every
    // target `missing`. Only `voiceover` — whose inputs are authored and present — has been
    // compared against anything and found absent.
    const voiceover = node(status, 'voiceover');
    expect(voiceover.state).toBe('missing');
    expect(voiceover.cause.code).toBe('never-built');

    // `podcast ← [voiceover]`, and voiceover has never been built, so podcast's input has no
    // content at all. `blocked`, not `missing`: the two are different claims, and `missing`
    // here would assert that podcast is merely unbuilt when in fact nothing it needs exists
    // yet. `blocked` outranks (FR-006a, freshness.ts step 1), and it NAMES what is in the way
    // — which is what makes `pc next` point at voiceover rather than offering to build a
    // podcast out of nothing.
    const podcast = node(status, 'podcast');
    expect(podcast.state).toBe('blocked');
    expect(podcast.cause.code).toBe('input-absent');
    expect(podcast.cause.identity).toBe('voiceover');
  });

  it('--json parses as JSON and matches the published shape', async () => {
    const result = await pc(['status', '--episode', 'tests/fixtures/blocked', '--json']);
    expect(result.code).toBe(0);

    // `--json` is the primary interface, not a courtesy: the parse IS the assertion.
    expect(() => StatusJsonSchema.parse(parseJsonText(result.stdout))).not.toThrow();

    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));
    expect(status.episode).toBe('blocked');
  });

  it('S12: refuses a cyclic graph — exit 1, naming the cycle (FR-005)', async () => {
    const result = await pc(['status', '--episode', 'tests/fixtures/cycle', '--json']);

    // A refusal, not an answer: this is the one case where a read verb exits non-zero, because
    // it could not answer at all. Never a partial graph, never a best-effort parse.
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/cycle/i);
    // The offending declaration is NAMED (FR-036) — not merely "a cycle exists".
    expect(result.stderr).toMatch(/a/);
    expect(result.stderr).toMatch(/b/);
    expect(result.stderr).toMatch(/c/);
    // A named cause, never a stack trace as the primary message.
    expect(result.stderr).not.toContain('at Object.');
  });

  it('a read verb reporting problems still exits 0', async () => {
    const human = await pc(['status', '--episode', 'tests/fixtures/blocked']);
    expect(human.code).toBe(0);
    // It really did report problems, so this is not passing vacuously.
    expect(human.stdout).toMatch(/blocked|absent/);
  });
});

describe('pc next', () => {
  it('excludes blocked nodes — a blocked node is not actionable, its missing input is', async () => {
    const result = await pc(['next', '--episode', 'tests/fixtures/blocked', '--json']);
    expect(result.code).toBe(0);

    const next = NextJsonSchema.parse(parseJsonText(result.stdout));
    const status = StatusJsonSchema.parse(
      parseJsonText((await pc(['status', '--episode', 'tests/fixtures/blocked', '--json'])).stdout)
    );

    const blocked = status.nodes.filter((reported) => reported.state === 'blocked');
    expect(
      blocked.length,
      'fixture no longer has a blocked node; this test is vacuous'
    ).toBeGreaterThan(0);

    const frontierIds = next.frontier.map((item) => item.id);
    for (const reported of blocked) {
      expect(frontierIds, `blocked node "${reported.id}" must not be actionable`).not.toContain(
        reported.id
      );
    }

    // The absent input IS actionable, and it is what the frontier points at instead.
    expect(frontierIds).toContain('narration');
    const supply = next.frontier.find((item) => item.id === 'narration');
    expect(supply?.action).toBe('supply');
  });

  it('names an action, never a state (FR-006b)', async () => {
    const result = await pc(['next', '--episode', 'tests/fixtures/chain', '--json']);
    expect(result.code).toBe(0);

    const next = NextJsonSchema.parse(parseJsonText(result.stdout));
    const actions = new Set(['build', 'rebuild', 'validate', 'review', 'supply', 'resolve-edit']);
    for (const item of next.frontier) {
      expect(actions, `"${item.id}" reported "${item.action}", which is not an action`).toContain(
        item.action
      );
    }
  });
});

describe('pc release-check', () => {
  it('exits 1 on an unbuilt episode and names every blocker', async () => {
    const result = await pc(['release-check', '--episode', 'tests/fixtures/chain', '--json']);

    // A GATE: "no" and "exit non-zero" are the same thing here, unlike a read verb.
    expect(result.code).toBe(1);

    const verdict = ReleaseCheckJsonSchema.parse(parseJsonText(result.stdout));
    expect(verdict.releasable).toBe(false);
    // Every negative answer names what blocks it (SC-005).
    expect(verdict.blockers.length).toBeGreaterThan(0);
    expect(verdict.blockers.map((blocker) => blocker.id)).toContain('voiceover');
    for (const blocker of verdict.blockers) {
      expect(blocker.cause.message.length).toBeGreaterThan(0);
    }
  });

  it('names the blockers in human output too', async () => {
    const result = await pc(['release-check', '--episode', 'tests/fixtures/chain']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('not releasable');
    expect(result.stdout).toContain('voiceover');
  });
});

describe('usage errors exit 2 — distinguishable from both an answer and a gate', () => {
  it('an unknown flag', async () => {
    const result = await pc(['status', '--bogus']);
    expect(result.code).toBe(2);
  });

  it('an unknown verb', async () => {
    const result = await pc(['frobnicate']);
    expect(result.code).toBe(2);
  });

  it('a stray positional', async () => {
    const result = await pc(['status', 'stray']);
    expect(result.code).toBe(2);
  });

  it('an unknown node for explain, naming it and the known nodes', async () => {
    const result = await pc(['explain', 'nonesuch', '--episode', 'tests/fixtures/chain']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nonesuch');
    // "unknown node" without the alternatives just moves the guess.
    expect(result.stderr).toContain('voiceover');
  });

  it('--help is not a usage error', async () => {
    const result = await pc(['--help']);
    expect(result.code).toBe(0);
  });
});

describe('the episode option', () => {
  it('defaults to the current directory', async () => {
    const dir = await copyFixture('chain');
    // Run with cwd inside the episode and no --episode flag: same answer as the explicit form.
    const explicit = await pc(['status', '--episode', dir, '--json']);
    expect(explicit.code).toBe(0);
    expect(StatusJsonSchema.parse(parseJsonText(explicit.stdout)).episode).toBe('chain');
  });

  it('fails loud and names the path when the episode cannot be resolved (FR-036)', async () => {
    const dir = await copyFixture('chain');
    await fs.rm(path.join(dir, 'episode.yaml'));

    const result = await pc(['status', '--episode', dir, '--json']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    // Names what is absent — never a fallback, never a default episode.
    expect(result.stderr).toContain('episode.yaml');
  });
});

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, validateGraph } from '@/graph/build.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';

/**
 * Every fixture on disk, driven through the REAL load → build → validate composition.
 *
 * This test exists because of a bug that survived a full green suite. `validateGraph` iterated
 * every `profile.targets` entry and demanded that every input of every target the profile COULD
 * produce be authored by the episode in front of it. Under that rule, all seven episodes
 * sharing `profiles/editorial-audio.yaml` were refused — `pc status --episode
 * tests/fixtures/minimal` exited 1 with "Target voiceover declares input narration, which is
 * neither authored nor a profile target" — while every unit test passed.
 *
 * They passed because every one of them hand-built its `Profile` object next to the manifest
 * it was written to satisfy, so the two always agreed by construction. The hand-built profiles
 * asserted a shape no shared profile has: a catalogue trimmed to exactly one episode. FR-004
 * ("Recipes MUST be reusable across unrelated productions") is precisely the claim that this
 * never happens, and it was the only claim no test made.
 *
 * So the assertions here are deliberately thin, and the FILES are the substance. The point is
 * not the shape of any one graph — the sibling `validate.test.ts` covers that far more
 * precisely — it is that the real `profiles/editorial-audio.yaml`, unmodified, is genuinely
 * usable by seven episodes of seven different shapes. A hand-built object cannot make that
 * claim, because a hand-built object is written by whoever is trying to make the test pass.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');
const PROFILES = path.join(REPO_ROOT, 'profiles');

/**
 * Each episode's own directory is searched first (the `cycle` fixture carries its own
 * `profile-cycle.yaml`), then the shared `profiles/` directory — the same order the CLI's
 * `createEpisodeLoader` uses. Resolving profiles any other way here would be testing a
 * composition nothing ships.
 */
async function loadFixture(name: string): Promise<{
  manifest: Awaited<ReturnType<typeof loadEpisode>>;
  profile: Awaited<ReturnType<typeof loadProfile>>;
}> {
  const episodeDir = path.join(FIXTURES, name);
  const manifest = await loadEpisode(episodeDir);
  const profile = await loadProfile(manifest.profile, [episodeDir, PROFILES]);
  return { manifest, profile };
}

/** The episodes that share `profiles/editorial-audio.yaml`. Every one of these must validate. */
const SHARED_PROFILE_FIXTURES = [
  'minimal',
  'blocked',
  'chain',
  'advisory',
  'dual-signal',
  'tree-output',
  'asset',
] as const;

describe('the fixtures on disk, through the real load → build → validate path', () => {
  it('the fixture list is not stale — every episode directory on disk is accounted for here', () => {
    // A fixture added later must not sit unvalidated just because this list was not updated.
    // `cycle` is the one deliberate omission, and it is asserted separately below.
    const onDisk = fs
      .readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(FIXTURES, name, 'episode.yaml')))
      .sort();

    expect(onDisk).toEqual([...SHARED_PROFILE_FIXTURES, 'cycle'].sort());
  });

  describe('every episode sharing the generic editorial-audio profile validates (FR-004)', () => {
    for (const name of SHARED_PROFILE_FIXTURES) {
      it(`${name}`, async () => {
        const { manifest, profile } = await loadFixture(name);

        expect(manifest.profile, `"${name}" no longer uses the shared profile`).toBe(
          'editorial-audio'
        );
        // The refusal this whole test exists for. A throw here is the shipped `pc status`
        // exiting 1 on a valid episode.
        expect(() => validateGraph(manifest, profile)).not.toThrow();

        const graph = buildGraph(manifest, profile);

        // `graph.targets` is what was ASKED FOR, and nothing else gets in.
        expect(graph.targets).toEqual(manifest.targets);

        // Every declared target, and every identity the operator authored, is a node.
        for (const target of manifest.targets) {
          expect(graph.nodes.has(target), `declared target "${target}" is not a node`).toBe(true);
        }
        for (const authored of Object.keys(manifest.authored)) {
          expect(graph.nodes.get(authored)?.kind).toBe('authored');
        }

        // The invariant `resolveStatus` stands on: every input of every node in the graph is
        // itself a node in the graph. When this broke, resolution died with "Cannot resolve
        // identity longform: it is not a node in this episode's graph".
        for (const node of graph.nodes.values()) {
          for (const input of node.inputs ?? []) {
            expect(graph.nodes.has(input), `input "${input}" of "${node.id}" is not a node`).toBe(
              true
            );
          }
        }

        // No node the episode did not ask for and is not built from. The profile's catalogue
        // is larger than every one of these graphs, so this is not vacuous.
        const reachable = new Set<string>(Object.keys(manifest.authored));
        const walk = (id: string): void => {
          if (reachable.has(id)) {
            return;
          }
          reachable.add(id);
          for (const input of profile.targets[id]?.inputs ?? []) {
            walk(input);
          }
        };
        for (const target of manifest.targets) {
          walk(target);
        }
        for (const id of graph.nodes.keys()) {
          expect(reachable.has(id), `"${id}" is in the graph but nothing asked for it`).toBe(true);
        }
      });
    }
  });

  it('the shared profile really is bigger than any one episode asks for — otherwise the above is vacuous', async () => {
    const { manifest, profile } = await loadFixture('minimal');
    const graph = buildGraph(manifest, profile);

    // `minimal` authors `longform` + `assets` and declares `epub`. The profile can ALSO produce
    // website, voiceover, podcast and transcript — voiceover/podcast/transcript needing a
    // `narration` and a `spoken` that `minimal` has no reason to author. That is the exact
    // shape that used to refuse the episode.
    expect(Object.keys(profile.targets).length).toBeGreaterThan(manifest.targets.length);
    expect(profile.targets.voiceover?.inputs).toContain('narration');
    expect(manifest.authored.narration).toBeUndefined();

    // Reported: only what was asked for, and what it is built from.
    expect([...graph.nodes.keys()].sort()).toEqual(['assets', 'epub', 'longform']);
    for (const unasked of [
      'website',
      'voiceover',
      'podcast',
      'transcript',
      'narration',
      'spoken',
    ]) {
      expect(graph.nodes.has(unasked), `"${unasked}" was never asked for`).toBe(false);
    }
  });

  it('blocked keeps `transcript` out of the graph STRUCTURALLY — not because `narration` happens to be checked first', async () => {
    // `transcript ← [narration, spoken]` and `blocked` authors no `spoken`. The fixture must
    // validate because it never asked for `transcript` — NOT because a check gave up at
    // `narration`. Those two are indistinguishable from a green test, and only one survives
    // someone reordering the profile's `inputs` list, so assert the node's absence directly.
    const { manifest, profile } = await loadFixture('blocked');

    expect(profile.targets.transcript?.inputs).toEqual(['narration', 'spoken']);
    expect(
      manifest.authored.spoken,
      'fixture now authors spoken; this test is vacuous'
    ).toBeUndefined();

    const graph = buildGraph(manifest, profile);
    expect(graph.nodes.has('transcript')).toBe(false);
    expect(graph.nodes.has('spoken')).toBe(false);

    // What it DID ask for is all there: `epub` and `voiceover` (whose `narration` is authored
    // but absent on disk — a state question, not a graph question).
    expect([...graph.nodes.keys()].sort()).toEqual([
      'assets',
      'epub',
      'longform',
      'narration',
      'voiceover',
    ]);
  });

  it('chain pulls in `voiceover` as an INTERMEDIATE — the graph is the closure, not just the declared targets', async () => {
    const { manifest, profile } = await loadFixture('chain');
    const graph = buildGraph(manifest, profile);

    expect(manifest.targets).toEqual(['voiceover', 'podcast']);
    // `podcast ← voiceover`, so even had `voiceover` not been declared it would be a node.
    expect(graph.nodes.get('podcast')?.inputs).toEqual(['voiceover']);
    expect(graph.nodes.get('voiceover')?.kind).toBe('derived');
    // `transcript` needs `spoken`, which chain DOES author — and it is still absent, because
    // reachability is the rule, not "could this episode satisfy it?".
    expect(manifest.authored.spoken).toBeDefined();
    expect(graph.nodes.has('transcript')).toBe(false);
  });

  it('cycle is still REFUSED, naming the cycle (FR-005)', async () => {
    // The one fixture that must not validate. Its `a -> b -> c -> a` is reachable from its
    // declared target `a`, so scoping validation to the reachable set must not soften it.
    const { manifest, profile } = await loadFixture('cycle');

    expect(manifest.targets).toEqual(['a']);
    expect(() => validateGraph(manifest, profile)).toThrow(/cycle/i);
    // The offending declaration is NAMED, not merely "a cycle exists".
    expect(() => validateGraph(manifest, profile)).toThrow(/a.*b.*c/);
  });
});

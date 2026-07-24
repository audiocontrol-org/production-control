import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { untrackedCheck, type TrackedCheck } from '@/assets/git-tracked.js';
import type { InputResolver } from '@/assets/resolve.js';
import { buildGraph, type Node } from '@/graph/build.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import { resolveInputs, type InputContext } from '@/providers/inputs.js';
import { copyFixture, node, parseJsonText, pc, REPO_ROOT, StatusJsonSchema } from './support.js';

/**
 * The FR-026 tracked-file guard is wired at the layer where it belongs (AUDIT-20260716-02,
 * AUDIT-20260716-26).
 *
 * A git-tracked oversized authored file must RESOLVE for build (its exception was inert before,
 * because no production caller passed a `TrackedCheck`). An untracked oversized file with no
 * stand-in must be REFUSED at build, naming the path. And `pc status` — which cannot spawn git
 * offline and must always answer (FR-010) — must ANSWER on that same untracked file rather than
 * hard-failing, because the refusal's teeth belong at build/asset-add, not in the read path.
 *
 * `narration` in the `chain` fixture is a plain authored input of the `voiceover` target. Here it
 * is overwritten with bytes over the 5 MiB inline threshold so the guard's three inputs (size,
 * stand-in, tracked-ness) are all in play.
 */

/** Just over `DEFAULT_MAX_INLINE_BYTES` (5 MiB) — enough to trip the size half of the guard. */
const OVERSIZED = 5 * 1024 * 1024 + 1;
const NARRATION_REL = path.join('assets', 'narration', 'take-01.wav');

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A resolver that must never be consulted — `narration` is a plain on-disk file, never fetched. */
function noAssets(): InputResolver {
  return {
    resolveToLocalPath: () => {
      throw new Error('the asset resolver was consulted; a plain authored file must not fetch');
    },
  };
}

/** A stub `TrackedCheck` reporting a fixed answer for every path — no git needed. */
function stubTrackedCheck(tracked: boolean): TrackedCheck {
  return { isTracked: () => Promise.resolve(tracked) };
}

/** A copy of `chain` whose `narration` authored input is oversized and has no stand-in. */
async function oversizedChain(): Promise<string> {
  const dir = await copyFixture('chain');
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, NARRATION_REL), Buffer.alloc(OVERSIZED, 1));
  return dir;
}

async function voiceoverContext(
  dir: string,
  tracked: TrackedCheck
): Promise<{
  context: InputContext;
  target: Node;
}> {
  const manifest = await loadEpisode(dir);
  const profile = await loadProfile(manifest.profile, [dir, path.join(REPO_ROOT, 'profiles')]);
  const graph = buildGraph(manifest, profile);
  const ledger = await readLedger(dir);
  const target = graph.nodes.get('voiceover');
  if (target === undefined) {
    throw new Error('the chain fixture no longer has a "voiceover" target');
  }
  return { context: { episodeDir: dir, graph, ledger, assets: noAssets(), tracked }, target };
}

describe('FR-026 tracked-file guard is wired at build and disabled in the read path', () => {
  it('a git-tracked oversized authored file RESOLVES for build (the exception is now active)', async () => {
    const dir = await oversizedChain();
    const { context, target } = await voiceoverContext(dir, stubTrackedCheck(true));

    const resolved = await resolveInputs(context, target);
    // The oversized `narration` resolved to a real local path — no FR-026 refusal, because the
    // injected check reports it tracked. Before this wiring, every large file was treated as
    // untracked and this would have thrown.
    expect(resolved['narration']?.path).toBe(path.join(dir, NARRATION_REL));
  });

  it('an untracked oversized authored file is REFUSED at build, naming the path', async () => {
    const dir = await oversizedChain();
    const { context, target } = await voiceoverContext(dir, untrackedCheck());

    await expect(resolveInputs(context, target)).rejects.toThrow(
      new RegExp(`take-01\\.wav[\\s\\S]*pc asset add`)
    );
  });

  it('`pc status` ANSWERS on the same untracked oversized file (exit 0), never hard-failing (FR-010)', async () => {
    const dir = await oversizedChain();

    const result = await pc(['status', '--episode', dir, '--json']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const status = StatusJsonSchema.parse(parseJsonText(result.stdout));
    // Status hashed the oversized authored file and reported it — tracked-ness never entered into
    // it, which is exactly why the read path can answer offline.
    expect(node(status, 'narration').state).toBe('present');
  });

  it('`pc build` REFUSES the untracked oversized file end-to-end (exit 1), naming the path', async () => {
    const dir = await oversizedChain();

    // `pc` runs with cwd at the repo root, and the copied episode lives in the system temp dir —
    // outside any git repository — so the real `gitTrackedCheck()` reports it untracked and the
    // FR-026 refusal fires before any provider is spawned.
    const result = await pc(['build', 'voiceover', '--episode', dir, '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/take-01\.wav/);
    expect(result.stderr).toMatch(/pc asset add/);
    expect(result.stdout).toBe('');
  });
});

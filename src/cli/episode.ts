import * as path from 'node:path';
import { buildGraph, type Graph } from '@/graph/build.js';
import type { Ledger } from '@/ledger/schema.js';
import { readLedger } from '@/ledger/store.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import type { EpisodeManifest, Profile } from '@/manifest/schema.js';
import { resolveStatus, type EpisodeStatus } from '@/state/resolve.js';

/**
 * The one composition of load → build → resolve that every verb shares (T037–T040, T044).
 *
 * Every verb asks the same question first ("what is true about this episode?") and differs
 * only in what it does with the answer. Composing that once here is what keeps `status`,
 * `next`, `release-check`, and `explain` provably consistent: they cannot disagree about an
 * episode's state, because there is only one place that computes it.
 *
 * Nothing here is reimplemented. `loadEpisode`, `loadProfile`, `readLedger`, `buildGraph`, and
 * `resolveStatus` already exist and already refuse loudly; this module's whole job is to hand
 * them each other's output in the right order and get out of the way.
 *
 * Note what is absent: any network client, any process spawn, any craft tool (FR-010, FR-025).
 * The oracle answers from declared content and the committed ledger, so the CLI over it needs
 * nothing else either.
 */
export interface EpisodeContext {
  /** Absolute. Every declared and recorded path in the episode is relative to this. */
  readonly episodeDir: string;
  readonly manifest: EpisodeManifest;
  readonly profile: Profile;
  readonly ledger: Ledger;
  readonly graph: Graph;
  readonly status: EpisodeStatus;
}

export interface EpisodeLoader {
  /**
   * Loads and resolves an episode, or throws NAMING what could not be resolved — a missing
   * manifest, an unresolvable profile, a malformed ledger, a graph that does not hold together
   * (FR-005, FR-036). There is no partial context: a caller either gets a whole answer or an
   * error, never a report over an episode that was only half understood.
   */
  load(episodeOption: string | undefined): Promise<EpisodeContext>;
}

export interface EpisodeLoaderConfig {
  /** `--episode` is resolved against this; the seam that keeps `process.cwd()` out of here. */
  readonly cwd: string;
  /**
   * Where to look for a profile AFTER the episode's own directory. Ordered — first match wins
   * (`loadProfile`'s contract). The episode dir is searched first because a fixture (or any
   * episode) may carry its own profile beside its `episode.yaml`; the shared `profiles/`
   * directory is the fallback for the normal case.
   */
  readonly profileDirs: readonly string[];
}

export function createEpisodeLoader(config: EpisodeLoaderConfig): EpisodeLoader {
  return {
    async load(episodeOption: string | undefined): Promise<EpisodeContext> {
      // `--episode` defaults to the current directory. This is a DECLARED default, not a
      // fallback: it never stands in for an episode that failed to resolve. If the resulting
      // directory holds no manifest, `loadEpisode` throws naming the path it looked for.
      const episodeDir = path.resolve(config.cwd, episodeOption ?? '.');

      const manifest = await loadEpisode(episodeDir);
      const profile = await loadProfile(manifest.profile, [episodeDir, ...config.profileDirs]);
      const ledger = await readLedger(episodeDir);

      // `resolveStatus` validates the graph first and refuses a malformed one (FR-005), so a
      // refusal happens BEFORE anything is reported — never after a partial answer is printed.
      const status = await resolveStatus({ episodeDir, manifest, profile, ledger });
      const graph = buildGraph(manifest, profile);

      return { episodeDir, manifest, profile, ledger, graph, status };
    },
  };
}

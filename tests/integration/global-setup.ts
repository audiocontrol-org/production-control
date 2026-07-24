import { buildCli } from './support.js';

/**
 * Builds the CLI ONCE, before any integration test file runs.
 *
 * This must not live in a `beforeAll`: vitest runs test files in parallel, so two files each
 * building would put two `tsc` processes into `dist/` at once. A global setup is the one place
 * a whole-suite prerequisite can be established exactly once.
 *
 * The build is only half the job — see `buildCli`, which then snapshots `dist/` somewhere no
 * other test can rebuild underneath it.
 */
export async function setup(): Promise<void> {
  await buildCli();
}

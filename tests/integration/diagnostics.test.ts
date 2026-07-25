import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { stringify } from 'yaml';
import { cleanupFixtureCopies, copyFixture, pc, FIXTURES } from './support.js';

/**
 * `pc build` shows the operator what the provider is saying, WHILE it is saying it (T059,
 * FR-017, quote-miner.md FR-017).
 *
 * The contract-level proof lives in `tests/contract/provider-diagnostics.test.ts`; this is the
 * other half — that a sink is actually WIRED at the CLI boundary. A runner that tees perfectly
 * into a sink nobody supplies is exactly as silent as the bug it replaced, and that wiring is
 * only observable through the real binary: this drives `node dist/cli/index.js` and reads the two
 * streams the operator reads.
 *
 * One invocation, both halves of the claim. `pc` spawns are the slowest thing in this suite, and
 * the failure path (stderr quoted verbatim, exit 1) is already covered by `build.test.ts` —
 * repeating it here would buy nothing and cost a second real build.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');

/** The `chain` fixture pointed at the fake provider, as `build.test.ts` does. */
async function episode(): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd: [FAKE_PROVIDER] } },
      podcast: { inputs: ['voiceover'], provider: { cmd: [FAKE_PROVIDER] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

describe("pc build: a successful provider's diagnostics reach the operator", () => {
  afterAll(async () => {
    await cleanupFixtureCopies();
  });

  it("surfaces the provider's stderr on pc's own stderr, and keeps stdout parseable", async () => {
    const dir = await episode();
    const result = await pc(['build', 'voiceover', '--episode', dir, '--json'], {
      env: { ...process.env, FAKE_PROVIDER_MODE: 'progress' },
    });

    expect(result.code, result.stderr).toBe(0);

    // The exact thing the 123-source quote-bank build could not show anyone: per-item progress
    // from a provider that then went on to SUCCEED. Before the fix these lines were accumulated
    // into a buffer and dropped, and the operator watched a blank terminal for hours.
    expect(result.stderr).toContain('progress: 1/2 first-source');
    expect(result.stderr).toContain('progress: 2/2 second-source');

    // And they went to diagnostics, not to the answer. If a progress line ever landed on stdout,
    // every agent parsing `pc build --json` would break (contracts/cli.md § the two streams).
    expect(result.stdout).not.toContain('progress:');
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toBeTypeOf('object');
  });
});

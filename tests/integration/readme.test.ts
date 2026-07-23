import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc, FIXTURES } from './support.js';

/**
 * `pc readme` — the per-episode README, generated from the manifest + committed ledger, with
 * provenance that cannot drift because it is derived, not narrated. The load-bearing property is
 * that it classifies each object the SAME way the build path routes its bytes: a human-authored
 * object, an AI-generated (impure, committed under ai-generated/) object, or a reproducible
 * (gitignored dist/) build output.
 */

function withMode(mode: string): { readonly env: NodeJS.ProcessEnv } {
  return { env: { ...process.env, FAKE_PROVIDER_MODE: mode } };
}

async function episode(): Promise<string> {
  const dir = await copyFixture('chain');
  const cmd = [path.join(FIXTURES, 'fake-provider')];
  // One target the provider declares impure at build time (voiceover) and one pure target left
  // unbuilt (podcast). The profile is written into the copy so it shadows the shared one.
  const profile = {
    version: 1,
    targets: {
      voiceover: { inputs: ['narration'], provider: { cmd } },
      podcast: { inputs: ['voiceover'], provider: { cmd } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

afterAll(cleanupFixtureCopies);

describe('pc readme writes provenance that matches how builds route their bytes', () => {
  it('classifies authored, AI-generated (impure→committed), and reproducible objects', async () => {
    const dir = await episode();
    // The provider declares itself impure at RUN time (not in the profile decl) — the subtle case:
    // the README must still file it as AI-generated, because that is where its bytes were routed.
    expect((await pc(['build', 'voiceover', '--episode', dir], withMode('impure'))).code).toBe(0);

    const result = await pc(['readme', '--episode', dir, '--json']);
    expect(result.code).toBe(0);
    const json = parseJsonText(result.stdout);
    expect(json.path).toBe('README.md');

    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');

    // Three provenance classes, each present.
    expect(readme).toContain('## Human-authored');
    expect(readme).toContain('## AI-generated — machine-derived, NOT human-crafted');
    expect(readme).toContain('## Reproducible build outputs — gitignored');

    // narration is authored.
    const authoredBlock = section(readme, '## Human-authored', '## AI-generated');
    expect(authoredBlock).toContain('### narration');
    expect(authoredBlock).toContain('human-authored');

    // voiceover is AI-generated: impure output committed under ai-generated/, with its recorded
    // impurity reason and producer — even though the impurity came from the response, not the decl.
    const aiBlock = section(readme, '## AI-generated', '## Reproducible');
    expect(aiBlock).toContain('### voiceover');
    expect(aiBlock).toContain('ai-generated/voiceover.out');
    expect(aiBlock).toMatch(/Impure:/);
    expect(aiBlock).not.toContain('### narration');

    // podcast is a pure, unbuilt reproducible output.
    const reproBlock = section(readme, '## Reproducible build outputs', undefined);
    expect(reproBlock).toContain('### podcast');
    expect(reproBlock).toContain('Not yet built');
    // The impure output must NOT be filed here.
    expect(reproBlock).not.toContain('### voiceover');
  });

  it('is idempotent — re-running with nothing changed rewrites identical bytes', async () => {
    const dir = await episode();
    await pc(['build', 'voiceover', '--episode', dir], withMode('impure'));
    await pc(['readme', '--episode', dir]);
    const first = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    await pc(['readme', '--episode', dir]);
    const second = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    expect(second).toBe(first);
  });
});

/** The slice of `text` between heading `from` and the next heading `to` (or end). */
function section(text: string, from: string, to: string | undefined): string {
  const start = text.indexOf(from);
  const end = to === undefined ? text.length : text.indexOf(to, start + from.length);
  return text.slice(start, end === -1 ? text.length : end);
}

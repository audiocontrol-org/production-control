import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { readLedger } from '@/ledger/store.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import { classifyZone } from '@/zoning/classify.js';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc, FIXTURES } from './support.js';

/**
 * AUDIT-07 — the impure-declared × pure-response cell of the declaration×response matrix.
 *
 * `provider.impure = { reason }` (FR-012) is a STATIC declaration: "this tool is *sometimes*
 * nondeterministic." A provider so declared may still, on a given run, hand back a perfectly
 * reproducible `BuildResponse` (no `impure` on the response). That is the NORMAL case for a
 * provider declared impure out of caution rather than because every run necessarily differs, and
 * it is newly reachable now that `provider.impure` exists as a first-class declaration (FR-012).
 *
 * Ground truth, `src/providers/build.ts`'s `impurityOf`:
 *
 *   function impurityOf(decl: ProviderDecl, response: BuildResponse): BuildImpure | undefined {
 *     return response.impure ?? decl.impure;
 *   }
 *
 * The declaration is the conservative upper bound: `decl.impure` is consulted whenever the
 * response is silent, so a declared-impure target STAYS impure even when a particular run's
 * response is pure. Nothing here is refused — `invoke.ts`'s `refuseImpurityContradiction` only
 * fires the OTHER direction (`decl.impure === undefined && response.impure !== undefined`, i.e. a
 * PURE declaration whose response claims impurity; see T014 in `invoke.test.ts`/`zoning.test.ts`).
 * A declared-impure provider that happens to return a pure response is not a contradiction — it is
 * exactly what "sometimes nondeterministic" predicts on a lucky run — so this direction must NOT
 * refuse.
 *
 * This is distinct from the three already-covered cells:
 *   - pure-declared  × pure-response   (`build.test.ts`'s default `chainEpisode()`/no mode)
 *   - impure-declared× impure-response (`build.test.ts`'s `chainEpisode(cmd, true)` + mode=impure;
 *                                        `zoning.test.ts` T006)
 *   - pure-declared  × impure-response (refused; T014, `invoke.ts`)
 * This file is the fourth: impure-declared × pure-response — accepted, and still routed as impure.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');

/**
 * The `chain` fixture with `voiceover`'s provider DECLARED impure in the static profile, pointed
 * at the real fake-provider subprocess. Mirrors `build.test.ts`'s `chainEpisode(cmd, true)`.
 */
async function declaredImpureEpisode(): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: {
      voiceover: {
        inputs: ['narration'],
        provider: {
          cmd: [FAKE_PROVIDER],
          impure: { reason: 'fake-provider fixture, declared impure but this run is pure' },
        },
      },
      podcast: { inputs: ['voiceover'], provider: { cmd: [FAKE_PROVIDER] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

async function recordOf(dir: string, target: string): Promise<ArtifactRecord> {
  const ledger = await readLedger(dir);
  const record = ledger.artifacts[target];
  if (record === undefined) {
    const present = Object.keys(ledger.artifacts).join(', ');
    throw new Error(`No ledger record for "${target}". Recorded: ${present || '(none)'}.`);
  }
  return record;
}

async function exists(fullPath: string): Promise<boolean> {
  return fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe(
  'AUDIT-07: a target DECLARED impure whose provider returns a PURE response stays impure ' +
    '(the declaration is the conservative upper bound, FR-012)',
  () => {
    it('is NOT refused, routes under `.ai/`, and classifies ai-permitted', async () => {
      const dir = await declaredImpureEpisode();

      // No `FAKE_PROVIDER_MODE` — the fake provider's default mode is deterministic and honest:
      // its `BuildResponse` carries no `impure` field at all. This is the pure-response half of
      // the cell under test; the profile above supplies the impure-declared half.
      const result = await pc(['build', 'voiceover', '--episode', dir]);

      // Not refused. `refuseImpurityContradiction` only fires for a PURE declaration facing an
      // IMPURE response; this is the opposite pairing and must be accepted.
      expect(result.stderr, 'a declared-impure target with a pure response was refused').toBe('');
      expect(result.code).toBe(0);

      const record = await recordOf(dir, 'voiceover');

      // impurityOf = response.impure ?? decl.impure: the response said nothing, so the
      // declaration's reason is what lands in the record — the declaration, not the response,
      // decided this artifact is impure.
      expect(record.producer_impure).toBeDefined();
      expect(record.producer_impure?.reason).toBe(
        'fake-provider fixture, declared impure but this run is pure'
      );

      // Routed under the dot-zoned `.ai/` root, NOT gitignored `dist/` — the declaration is the
      // upper bound, so a pure-looking run of a declared-impure tool is still treated as the
      // non-reproducible, must-be-committed case.
      expect(record.output.path).toBe('.ai/voiceover.out');
      expect(await exists(path.join(dir, '.ai', 'voiceover.out'))).toBe(true);
      expect(await exists(path.join(dir, 'dist', 'voiceover.out'))).toBe(false);

      // Human-legible from the path alone (INV-2), agreeing with the machine-side record above.
      expect(classifyZone(record.output.path)).toBe('ai-permitted');
    });

    it('`pc readme` files it under AI-generated, not under reproducible build outputs', async () => {
      const dir = await declaredImpureEpisode();
      expect((await pc(['build', 'voiceover', '--episode', dir])).code).toBe(0);

      const result = await pc(['readme', '--episode', dir, '--json']);
      expect(result.code).toBe(0);
      const json = parseJsonText(result.stdout);
      expect(json).toMatchObject({ path: 'README.md' });

      const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
      const aiBlock = section(readme, '## AI-generated', '## Reproducible');
      const reproBlock = section(readme, '## Reproducible build outputs', undefined);

      expect(aiBlock).toContain('### voiceover');
      expect(aiBlock).toContain('.ai/voiceover.out');
      expect(reproBlock).not.toContain('### voiceover');
    });
  }
);

/** The slice of `text` between heading `from` and the next heading `to` (or end). Mirrors readme.test.ts. */
function section(text: string, from: string, to: string | undefined): string {
  const start = text.indexOf(from);
  const end = to === undefined ? text.length : text.indexOf(to, start + from.length);
  return text.slice(start, end === -1 ? text.length : end);
}

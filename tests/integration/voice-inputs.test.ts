import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYamlText, stringify } from 'yaml';
import { z } from 'zod';
import { buildGraph } from '@/graph/build.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import { AuthoredDeclSchema, HashSchema } from '@/manifest/schema.js';
import { readLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  parseJsonText,
  pc,
  REPO_ROOT,
  StatusJsonSchema,
} from './support.js';

/** Narrows a parsed-YAML value to an indexable mapping without a type assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * T022 [US3] — voice is a first-class DECLARED input; a human-polish companion `follows` an
 * edition and is accepted without ever becoming a build dependency; a companion declared under a
 * dot-zone is refused by the SHIPPED authored-direction check (specs/004-voice-editions,
 * data-model.md D1/D19, spec.md FR-001, US3 Acceptance Scenarios).
 *
 * Every fact below is proven with mechanisms that ALREADY SHIP, over the EXISTING
 * `voice-revise` fixture (`tests/fixtures/voice-revise/`, T018/T020) — no `src/` change, no new
 * manifest field, no new enforcement path:
 *
 *   1. `voice` is not a special node kind. It is an ordinary `authored` node
 *      (`AuthoredDeclSchema`: just `path` + optional `follows`) referenced by IDENTITY in the
 *      `edition` target's `inputs` — exactly the same mechanism `source` uses. A real
 *      `pc build` resolves it and records its hash under `answer.inputs.voice` (`BuildJson`,
 *      `src/cli/build.ts`).
 *   2. A human-polish COMPANION is authored in a human-safe path with `follows: edition` — the
 *      advisory relationship `AuthoredDeclSchema.follows` already models ("is a response to",
 *      `src/graph/validate.ts` Rule 3/7c: a `follows` naming a REACHABLE profile target is
 *      valid). It is drawn only from authored nodes, never appears in any `inputs` array
 *      (`src/graph/build.ts`'s `Node.follows` vs `Node.inputs`), and never triggers a rebuild —
 *      so the edition it follows is provably byte-identical and still independently valid after
 *      the companion is added.
 *   3. An authored node (companion or otherwise) declared under a dot-zone is refused: `pc
 *      status` refuses outright (the same `validateGraph` Rule 7 exercised by
 *      `tests/unit/graph/authored-zone.test.ts` Scenario 7a, reached here through the real
 *      binary's strict `EpisodeLoader`), and `pc audit-zones` reports it as a named violation —
 *      the exact mechanism `tests/integration/voice-zoning.test.ts` (T021) already exercises for
 *      the `voice` node, applied here to a `companion` node instead.
 */

const TARGET = 'edition';
const REVISE_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-revise.mjs');
const FIDELITY_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-fidelity.mjs');
const STUB_MODEL = path.join(REPO_ROOT, 'tests', 'fixtures', 'voice-revise', 'stub-model.mjs');
const BUILD_ENV = { ...process.env, VOICE_REVISE_MODEL: `node ${STUB_MODEL}` };

/** Mirrors `voice-revise.test.ts`'s `BuildJsonSchema` — the wire shape of `pc build --json`. */
const BuildJsonSchema = z.object({
  episode: z.string(),
  target: z.string(),
  producer: z.object({ tool: z.string(), version: z.string() }),
  producer_impure: z.object({ reason: z.string() }).nullable(),
  inputs: z.record(z.string(), z.string()),
  output: z.object({ path: z.string(), hash: z.string() }),
  built_at: z.string(),
  validation: z.enum(['passed', 'failed']).nullable(),
});

const ValidateJsonSchema = z.object({
  episode: z.string(),
  valid: z.boolean(),
  targets: z.array(
    z.object({
      target: z.string(),
      state: z.enum(['passed', 'failed', 'unresolved']),
      detail: z.string().nullable(),
      errors: z.array(z.string()).optional(),
    })
  ),
});

/** The `voice-editions` profile, wired to the REAL provider/validator, mirroring `voice-revise.test.ts`. */
async function writeVoiceEditionsProfile(dir: string): Promise<void> {
  const profile = {
    version: 1,
    targets: {
      [TARGET]: {
        inputs: ['source', 'voice'],
        provider: {
          cmd: ['node', REVISE_BIN],
          impure: { reason: 'voice-inputs fixture target: model-produced edition' },
        },
        validator: { cmd: ['node', FIDELITY_BIN] },
      },
    },
  };
  await fs.writeFile(path.join(dir, 'voice-editions.yaml'), stringify(profile), 'utf8');
}

afterAll(cleanupFixtureCopies);

// ---------------------------------------------------------------------------
// Fact 1 — voice as a first-class DECLARED input (D1/D19, FR-001).
// ---------------------------------------------------------------------------

describe('T022 fact 1: voice is an ordinary authored node, declared as a build INPUT by identity', () => {
  it('the voice-revise fixture manifest declares `voice` as an authored node (path + no special kind), and `edition` names it in `inputs`', async () => {
    const dir = await copyFixture('voice-revise');
    await writeVoiceEditionsProfile(dir);

    const manifest = await loadEpisode(dir);
    const profile = await loadProfile(manifest.profile, [dir, path.join(REPO_ROOT, 'profiles')]);

    // `voice` is parsed by the SAME schema as any other authored node — no voice-specific field,
    // no voice-specific kind. Schema-level proof this is D1/D19's "reuse existing manifest
    // mechanisms, no core change".
    const voiceDecl = AuthoredDeclSchema.parse(manifest.authored['voice']);
    expect(voiceDecl.path).toBe('voice.yaml');

    // The edition target's declared inputs name `voice` by identity, alongside `source`.
    expect(profile.targets[TARGET]?.inputs).toEqual(['source', 'voice']);

    // `buildGraph` (src/graph/build.ts) resolves the SAME fact structurally: `voice` is a graph
    // node of kind `authored`, and `edition`'s derived node lists it among its inputs.
    const graph = buildGraph(manifest, profile);
    expect(graph.nodes.get('voice')?.kind).toBe('authored');
    expect(graph.nodes.get(TARGET)?.kind).toBe('derived');
    expect(graph.nodes.get(TARGET)?.inputs).toContain('voice');
  });

  it('a real `pc build` resolves `voice` as an input and records its hash (no core change: same mechanism as `source`)', async () => {
    const dir = await copyFixture('voice-revise');
    await writeVoiceEditionsProfile(dir);

    const built = await pc(['build', TARGET, '--episode', dir, '--json'], { env: BUILD_ENV });
    expect(built.code, built.stderr).toBe(0);

    const answer = BuildJsonSchema.parse(parseJsonText(built.stdout));
    expect(answer.target).toBe(TARGET);

    // THE ASSERTION: `voice` was resolved as a declared input of a real build, exactly like
    // `source` — both are ordinary identities in `inputs`, hashed the same way.
    expect(Object.keys(answer.inputs)).toEqual(expect.arrayContaining(['source', 'voice']));
    expect(HashSchema.safeParse(answer.inputs['voice']).success).toBe(true);
    expect(HashSchema.safeParse(answer.inputs['source']).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fact 2 — a human-polish companion `follows` the edition; accepted, edition unmodified
// (D1/D19, FR-001; the advisory relationship is `AuthoredDeclSchema.follows`).
// ---------------------------------------------------------------------------

describe('T022 fact 2: a human-safe companion authored node `follows` the edition — accepted, edition unmodified', () => {
  /** Adds an authored `companion` node (human-safe path) with `follows: edition` to the fixture's manifest. */
  async function addCompanion(dir: string): Promise<void> {
    const manifestPath = path.join(dir, 'episode.yaml');
    const manifestText = await fs.readFile(manifestPath, 'utf8');
    const parsedManifest: unknown = parseYamlText(manifestText);
    if (!isRecord(parsedManifest)) {
      throw new Error('voice-inputs fixture: episode.yaml did not parse to a YAML mapping');
    }
    const manifest = parsedManifest;
    const authoredValue = manifest['authored'];
    if (!isRecord(authoredValue)) {
      throw new Error('voice-inputs fixture: manifest.authored is not a mapping');
    }
    manifest['authored'] = {
      ...authoredValue,
      // A human-safe path (no dot-zone segment): the polish notes a human wrote in response to
      // the machine-produced edition. `follows` names the edition by identity — advisory, never
      // a dependency.
      companion: { path: 'companion.md', follows: TARGET },
    };
    await fs.writeFile(manifestPath, stringify(manifest), 'utf8');
    await fs.writeFile(
      path.join(dir, 'companion.md'),
      '# Human polish notes\n\nA human reviewer wrote these notes in response to the edition.\n',
      'utf8'
    );
  }

  it('validates/loads: the companion is a graph node whose `follows` is advisory, never a dependency', async () => {
    const dir = await copyFixture('voice-revise');
    await writeVoiceEditionsProfile(dir);
    await addCompanion(dir);

    const manifest = await loadEpisode(dir);
    const profile = await loadProfile(manifest.profile, [dir, path.join(REPO_ROOT, 'profiles')]);

    // Loading and building the graph over the mutated manifest does not throw: Rule 3/7c
    // (src/graph/validate.ts) accepts a `follows` naming a REACHABLE profile target.
    const graph = buildGraph(manifest, profile);
    const companion = graph.nodes.get('companion');
    expect(companion?.kind).toBe('authored');
    expect(companion?.follows).toBe(TARGET);
    // The advisory edge is structurally distinct from a dependency: an authored node's `Node`
    // shape carries no `inputs` field at all (src/graph/build.ts).
    expect(companion?.inputs).toBeUndefined();

    // And `edition`'s OWN declared inputs are unaffected — the companion never joined them.
    expect(graph.nodes.get(TARGET)?.inputs).not.toContain('companion');
  });

  it('`pc status` accepts the companion and the edition is neither rebuilt nor modified', async () => {
    const dir = await copyFixture('voice-revise');
    await writeVoiceEditionsProfile(dir);

    const built = await pc(['build', TARGET, '--episode', dir, '--json'], { env: BUILD_ENV });
    expect(built.code, built.stderr).toBe(0);
    const answer = BuildJsonSchema.parse(parseJsonText(built.stdout));
    const editionPath = path.join(dir, answer.output.path);
    const originalBytes = await fs.readFile(editionPath, 'utf8');
    const originalHash = (await readLedger(dir)).artifacts[TARGET]?.output.hash;

    await addCompanion(dir);

    // `pc status` loads and validates the mutated manifest through the STRICT `EpisodeLoader`
    // (the same path `pc build`/`pc validate` use) — a real refusal (e.g. Fact 3's dot-zone
    // case) would exit non-zero here. Accepting it is the "companion validates/loads" proof.
    const status = await pc(['status', '--episode', dir, '--json']);
    expect(status.code, status.stderr).toBe(0);
    const nodes = StatusJsonSchema.parse(parseJsonText(status.stdout)).nodes;
    expect(nodes.find((n) => n.id === 'companion')?.kind).toBe('authored');
    const editionNode = nodes.find((n) => n.id === TARGET);
    expect(editionNode).toBeDefined();
    // The edition was NOT reported modified/edited by the companion's mere presence: nothing
    // wrote to it, because `follows` is never a build input (D1/D19).
    expect(editionNode?.state).not.toBe('modified');

    // The edition file on disk is BYTE-IDENTICAL to what the earlier build produced — `pc
    // status` (and the companion's addition) never touched it.
    expect(await fs.readFile(editionPath, 'utf8')).toBe(originalBytes);
    expect((await readLedger(dir)).artifacts[TARGET]?.output.hash).toBe(originalHash);

    // The independent fidelity validator still accepts the SAME, untouched edition — direct
    // proof the machine artifact remains exactly what it was before the companion existed.
    const validated = await pc(['validate', TARGET, '--episode', dir, '--json']);
    expect(validated.code, validated.stderr).toBe(0);
    const verdict = ValidateJsonSchema.parse(parseJsonText(validated.stdout));
    expect(verdict.valid).toBe(true);
    expect(verdict.targets[0]?.state).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Fact 3 — a companion authored node declared UNDER a dot-zone is refused by the shipped
// authored-direction check (FR-006/D2b, reused unchanged; mirrors voice-zoning.test.ts's T021).
// ---------------------------------------------------------------------------

describe('T022 fact 3: a companion authored node declared under `.ai/` is refused, naming it', () => {
  /** The voice-revise fixture with an added `companion` authored node whose path is under `.ai/`. */
  async function companionInDotZoneFixture(): Promise<string> {
    const dir = await copyFixture('voice-revise');
    await writeVoiceEditionsProfile(dir);
    await fs.mkdir(path.join(dir, '.ai'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.ai', 'companion.md'),
      '# Human polish notes (mis-zoned)\n',
      'utf8'
    );
    const manifest = {
      version: 1,
      id: 'voice-revise-fixture',
      title: 'Voice revise fixture',
      profile: 'voice-editions',
      authored: {
        source: { path: 'source.md' },
        voice: { path: 'voice.yaml' },
        companion: { path: '.ai/companion.md', follows: TARGET },
      },
      targets: [TARGET],
    };
    await fs.writeFile(path.join(dir, 'episode.yaml'), stringify(manifest), 'utf8');
    return dir;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const VIOLATION_FIELDS = ['class', 'assignedRoot', 'expectedZone', 'actualZone'] as const;

  /** Mirrors `voice-zoning.test.ts`'s `findViolation` — the shipped audit-report shape search. */
  function findViolation(value: unknown, id: string): Record<string, unknown> | undefined {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findViolation(item, id);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (!isRecord(value)) {
      return undefined;
    }
    if (value['id'] === id && VIOLATION_FIELDS.every((field) => field in value)) {
      return value;
    }
    for (const key of Object.keys(value)) {
      const found = findViolation(value[key], id);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  it('`pc audit-zones` reports the mis-zoned companion as a named violation, non-zero exit (the T021 mechanism, applied to `companion`)', async () => {
    const dir = await companionInDotZoneFixture();
    const result = await pc(['audit-zones', '--episode', dir, '--json']);

    expect(result.code, 'expected a non-zero (violation) exit').not.toBe(0);
    const report = parseJsonText(result.stdout);
    const violation = findViolation(report, 'companion');
    expect(violation, `no "companion" violation in report: ${result.stdout}`).toBeDefined();
    expect(violation?.['expectedZone']).toBe('human-safe');
    expect(violation?.['actualZone']).toBe('ai-permitted');
  });

  it('`pc status` REFUSES outright over the same manifest (validateGraph Rule 7), naming `companion`', async () => {
    const dir = await companionInDotZoneFixture();
    const result = await pc(['status', '--episode', dir, '--json']);

    expect(result.code, 'expected a non-zero (refusal) exit').not.toBe(0);
    expect(result.stderr, 'the offending companion node must be named').toContain('companion');
  });
});

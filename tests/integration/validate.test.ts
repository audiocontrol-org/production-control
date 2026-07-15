import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { z } from 'zod';
import { stringify } from 'yaml';
import type { ArtifactRecord } from '@/ledger/schema.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
import { cleanupFixtureCopies, copyFixture, parseJsonText, pc, FIXTURES } from './support.js';

/**
 * `pc validate [<target>]` (T062, FR-006b, contracts/cli.md § `pc validate`).
 *
 * A GATE: 0 only when every requested target passed, 1 otherwise (FR-035). The subtle
 * requirement it carries is FR-006b's — **absent is not passed and not failed** — so the tests
 * that matter most here are the ones about a target with no verdict, not the happy path.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');

const ValidateJsonSchema = z.object({
  episode: z.string(),
  valid: z.boolean(),
  targets: z.array(
    z.object({
      target: z.string(),
      state: z.enum(['passed', 'failed', 'unresolved']),
      detail: z.string().nullable(),
    })
  ),
});

/**
 * The `chain` fixture with a profile pointed at the fake provider, and only `voiceover` declared
 * as a target — so `pc validate` with no argument has exactly one thing to do.
 */
async function episode(cmd: readonly string[] = [FAKE_PROVIDER]): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: { voiceover: { inputs: ['narration'], provider: { cmd: [...cmd] } } },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');

  const manifest = await fs.readFile(path.join(dir, 'episode.yaml'), 'utf8');
  await fs.writeFile(
    path.join(dir, 'episode.yaml'),
    manifest.replace('targets: [voiceover, podcast]', 'targets: [voiceover]'),
    'utf8'
  );
  return dir;
}

function withMode(mode: string): { readonly env: NodeJS.ProcessEnv } {
  return { env: { ...process.env, FAKE_PROVIDER_MODE: mode } };
}

afterAll(async () => {
  await cleanupFixtureCopies();
});

describe('pc validate records the verdict and gates on it (T062)', () => {
  it('**records the verdict against the existing record, and exits 0** when it passes', async () => {
    const dir = await episode();
    expect((await pc(['build', 'voiceover', '--episode', dir])).code).toBe(0);

    const built = (await readLedger(dir)).artifacts.voiceover;

    // Erase the verdict the build recorded, so that what `pc validate` writes is unambiguously
    // its own doing rather than something already there.
    if (built === undefined) {
      throw new Error('the build wrote no record');
    }
    const withoutVerdict: ArtifactRecord = {
      producer: built.producer,
      inputs: built.inputs,
      output: built.output,
      built_at: built.built_at,
    };
    const ledger = await readLedger(dir);
    await writeLedger(dir, { ...ledger, artifacts: { voiceover: withoutVerdict } });

    const result = await pc(['validate', 'voiceover', '--episode', dir, '--json']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const answer = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(answer.valid).toBe(true);
    expect(answer.targets).toEqual([{ target: 'voiceover', state: 'passed', detail: null }]);

    const record = (await readLedger(dir)).artifacts.voiceover;
    expect(record?.validation?.state).toBe('passed');

    // A validation is a fact recorded ABOUT a build, never a substitute for one. Everything the
    // build established must survive untouched — a gate that rewrote provenance would be
    // claiming to have produced something.
    expect(record?.output).toEqual(built.output);
    expect(record?.inputs).toEqual(built.inputs);
    expect(record?.built_at).toBe(built.built_at);
    expect(record?.producer).toEqual(built.producer);
  });

  it('validates every declared target when none is named', async () => {
    const dir = await episode();
    expect((await pc(['build', 'voiceover', '--episode', dir])).code).toBe(0);

    const result = await pc(['validate', '--episode', dir, '--json']);
    expect(result.code).toBe(0);
    expect(ValidateJsonSchema.parse(parseJsonText(result.stdout)).targets).toHaveLength(1);
  });

  it('**refuses a target that has never been built** — there is nothing to validate, and exit 1', async () => {
    const dir = await episode();

    const result = await pc(['validate', 'voiceover', '--episode', dir, '--json']);
    expect(result.code).toBe(1);

    const answer = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(answer.valid).toBe(false);
    expect(answer.targets[0]?.state).toBe('unresolved');
    expect(answer.targets[0]?.detail).toMatch(/never been built/i);

    // FR-006b: it did not record a verdict, in either direction.
    expect((await readLedger(dir)).artifacts).toEqual({});
  });

  it('**a target it cannot validate is never passed** — an unresolved target fails the gate (FR-036)', async () => {
    const dir = await episode();
    expect((await pc(['build', 'voiceover', '--episode', dir])).code).toBe(0);

    // The provider now fails. No verdict can be obtained, so the gate must not say yes.
    const result = await pc(
      ['validate', 'voiceover', '--episode', dir, '--json'],
      withMode('fail')
    );
    expect(result.code).toBe(1);

    const answer = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(answer.valid).toBe(false);
    expect(answer.targets[0]?.state).toBe('unresolved');
  });

  it('**refuses rather than rebuilding over an artifact** — an impure provider cannot be validated (FR-017a)', async () => {
    const dir = await episode();
    expect((await pc(['build', 'voiceover', '--episode', dir], withMode('impure'))).code).toBe(0);

    const before = await fs.readFile(path.join(dir, 'dist/voiceover.out'), 'utf8');

    // The provider re-runs and produces DIFFERENT bytes (it declares itself impure and means it).
    // Recording that verdict against this record would attach a judgement about one artifact to
    // the record of another — and overwriting the artifact would be a gate rebuilding.
    const result = await pc(
      ['validate', 'voiceover', '--episode', dir, '--json'],
      withMode('impure')
    );
    expect(result.code).toBe(1);

    const answer = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(answer.targets[0]?.state).toBe('unresolved');
    expect(answer.targets[0]?.detail).toMatch(/not the recorded artifact/i);
    expect(answer.targets[0]?.detail).toMatch(/pc build/);

    // The artifact on disk is untouched. A gate must never destroy what it was asked to judge.
    expect(await fs.readFile(path.join(dir, 'dist/voiceover.out'), 'utf8')).toBe(before);
  });

  it('leaves no scratch directory behind, on either path', async () => {
    const dir = await episode();
    await pc(['build', 'voiceover', '--episode', dir]);
    await pc(['validate', 'voiceover', '--episode', dir]);
    await pc(['validate', 'voiceover', '--episode', dir], withMode('fail'));

    const dist = await fs.readdir(path.join(dir, 'dist'));
    expect(dist).toEqual(['voiceover.out']);
  });

  it('an unknown target is the CALLER`s mistake — exit 2, not 1 (FR-035)', async () => {
    const dir = await episode();
    const result = await pc(['validate', 'nonesuch', '--episode', dir]);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/not a node/i);
  });
});

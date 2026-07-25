import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import { readLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  parseJsonText,
  pc,
  FIXTURES,
  StatusJsonSchema,
} from './support.js';

/**
 * `.strict()` on the target shape is deliberate: it makes an UNEXPECTED key a failure, which is
 * what lets the passing-case test below prove the wire shape did not change when `errors` was
 * added. A non-strict schema silently strips extras, so it could not tell the difference.
 */
const ValidateTargetSchema = z
  .object({
    target: z.string(),
    state: z.enum(['passed', 'failed', 'unresolved']),
    detail: z.string().nullable(),
    errors: z.array(z.string()).optional(),
  })
  .strict();

const ValidateJsonSchema = z.object({
  episode: z.string(),
  valid: z.boolean(),
  targets: z.array(ValidateTargetSchema),
});

/** Exactly what `FAKE_VALIDATOR_MODE=fail` names, in order (tests/fixtures/fake-validator). */
const FAIL_ERRORS = [
  "quote 'q-076-3' (source PB-P076): span 1 raw is not a substring of the source",
  "quote 'q-081-2': reconstruction does not match recorded text; first difference at byte 42",
];

/**
 * The INDEPENDENT acceptance gate: a target declares a `validator` distinct from its `provider`,
 * and `pc validate` runs the validator against the ALREADY-BUILT artifact — never re-running the
 * producer. Two properties this buys, neither of which the producer-self-report path can:
 *   1. an IMPURE target can be validated (its producer cannot reproduce the bytes, so the
 *      self-report path refuses it), and
 *   2. the generator cannot certify its own output — a separate deterministic tool decides.
 */

const FAKE_PROVIDER = path.join(FIXTURES, 'fake-provider');
const FAKE_VALIDATOR = path.join(FIXTURES, 'fake-validator');

function withEnv(env: NodeJS.ProcessEnv): { readonly env: NodeJS.ProcessEnv } {
  return { env: { ...process.env, ...env } };
}

async function episode(): Promise<string> {
  const dir = await copyFixture('chain');
  const profile = {
    version: 1,
    targets: {
      voiceover: {
        inputs: ['narration'],
        provider: { cmd: [FAKE_PROVIDER] },
        validator: { cmd: [FAKE_VALIDATOR] },
      },
      podcast: { inputs: ['voiceover'], provider: { cmd: [FAKE_PROVIDER] } },
    },
  };
  await fs.writeFile(path.join(dir, 'editorial-audio.yaml'), stringify(profile), 'utf8');
  return dir;
}

/** Build voiceover impurely, so its output is the committed, non-reproducible ai-generated/ bytes. */
async function buildImpure(dir: string): Promise<void> {
  const built = await pc(
    ['build', 'voiceover', '--episode', dir],
    withEnv({ FAKE_PROVIDER_MODE: 'impure' })
  );
  expect(built.code).toBe(0);
}

afterAll(cleanupFixtureCopies);

describe('pc validate runs a declared validator against the existing artifact', () => {
  it('validates an IMPURE target — the producer path would refuse; the validator judges the bytes', async () => {
    const dir = await episode();
    await buildImpure(dir);

    // Default fake-validator: reads the artifact (proving it got a real path) and passes.
    const result = await pc(['validate', 'voiceover', '--episode', dir, '--json']);
    expect(result.code).toBe(0);
    const json = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(json.valid).toBe(true);
    expect(json.targets[0]?.state).toBe('passed');

    // The verdict was recorded against the existing record (not a rebuild): validation is now
    // `passed` on the voiceover node.
    const status = await pc(['status', '--episode', dir, '--json']);
    const nodes = StatusJsonSchema.parse(parseJsonText(status.stdout)).nodes;
    expect(nodes.find((n) => n.id === 'voiceover')?.validated).toBe('passed');
  });

  it('a FAILED verdict gates the whole run (exit 1)', async () => {
    const dir = await episode();
    await buildImpure(dir);
    const result = await pc(
      ['validate', 'voiceover', '--episode', dir, '--json'],
      withEnv({ FAKE_VALIDATOR_MODE: 'fail' })
    );
    expect(result.code).toBe(1);
    expect(ValidateJsonSchema.parse(parseJsonText(result.stdout)).targets[0]?.state).toBe('failed');
  });

  it('**names every defect beneath the verdict** — a failed verdict with no reasons is unactionable', async () => {
    const dir = await episode();
    await buildImpure(dir);

    const result = await pc(
      ['validate', 'voiceover', '--episode', dir],
      withEnv({ FAKE_VALIDATOR_MODE: 'fail' })
    );
    expect(result.code).toBe(1);

    // Verbatim: these are already operator-facing prose, and paraphrasing a validator's finding
    // would put words in its mouth.
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^voiceover\s+failed$/);
    expect(lines.slice(1)).toEqual(FAIL_ERRORS.map((error) => `  ${error}`));
  });

  it('**--json carries the errors structurally** — CI and agents read the reasons too', async () => {
    const dir = await episode();
    await buildImpure(dir);

    const result = await pc(
      ['validate', 'voiceover', '--episode', dir, '--json'],
      withEnv({ FAKE_VALIDATOR_MODE: 'fail' })
    );
    expect(result.code).toBe(1);

    const json = ValidateJsonSchema.parse(parseJsonText(result.stdout));
    expect(json.targets[0]?.state).toBe('failed');
    expect(json.targets[0]?.errors).toEqual(FAIL_ERRORS);
  });

  it('a PASSING verdict adds nothing — no error lines, and the JSON shape is what it always was', async () => {
    const dir = await episode();
    await buildImpure(dir);

    const human = await pc(['validate', 'voiceover', '--episode', dir]);
    expect(human.code).toBe(0);
    expect(human.stdout.trimEnd().split('\n')).toHaveLength(1);

    const result = await pc(['validate', 'voiceover', '--episode', dir, '--json']);
    expect(result.code).toBe(0);

    // `.strict()` above would have refused an unexpected key; this asserts the converse — that
    // `errors` is ABSENT rather than an empty array, so a passing verdict's bytes on the wire are
    // byte-for-byte what a caller parsed before this field existed.
    const target = ValidateJsonSchema.parse(parseJsonText(result.stdout)).targets[0];
    expect(target).toEqual({ target: 'voiceover', state: 'passed', detail: null });
  });

  it('**records the named errors in the ledger** — a durable `failed` with no reasons is not a report', async () => {
    const dir = await episode();
    await buildImpure(dir);

    expect(
      (
        await pc(
          ['validate', 'voiceover', '--episode', dir],
          withEnv({ FAKE_VALIDATOR_MODE: 'fail' })
        )
      ).code
    ).toBe(1);

    const failed = (await readLedger(dir)).artifacts.voiceover;
    expect(failed?.validation?.state).toBe('failed');
    expect(failed?.validation?.errors).toEqual(FAIL_ERRORS);

    // A later verdict REPLACES the earlier one whole. Reasons that outlived the failure they
    // explain would be a lie of exactly the kind the ledger exists to prevent.
    expect((await pc(['validate', 'voiceover', '--episode', dir])).code).toBe(0);
    const passed = (await readLedger(dir)).artifacts.voiceover;
    expect(passed?.validation?.state).toBe('passed');
    expect(passed?.validation?.errors).toBeUndefined();
  });

  it('refuses an artifact edited outside the system — never judges bytes the record does not describe', async () => {
    const dir = await episode();
    await buildImpure(dir);
    await fs.appendFile(path.join(dir, 'ai-generated', 'voiceover.out'), 'tampered\n', 'utf8');

    const result = await pc(['validate', 'voiceover', '--episode', dir, '--json']);
    expect(result.code).toBe(1);
    const verdict = ValidateJsonSchema.parse(parseJsonText(result.stdout)).targets[0];
    expect(verdict?.state).toBe('unresolved');
    expect(verdict?.detail).toMatch(/edited outside the system/);
  });

  it('no verdict is `unresolved`, never `passed` — a crashing/silent/garbage validator cannot false-clean', async () => {
    for (const mode of ['crash', 'silent', 'garbage']) {
      const dir = await episode();
      await buildImpure(dir);
      const result = await pc(
        ['validate', 'voiceover', '--episode', dir, '--json'],
        withEnv({ FAKE_VALIDATOR_MODE: mode })
      );
      expect(result.code, mode).toBe(1);
      expect(ValidateJsonSchema.parse(parseJsonText(result.stdout)).targets[0]?.state, mode).toBe(
        'unresolved'
      );
    }
  });
});

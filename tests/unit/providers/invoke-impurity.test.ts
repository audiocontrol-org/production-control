import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderDecl } from '@/manifest/schema.js';
import type { BuildRequest, BuildResponse } from '@/providers/contract.js';
import { invokeProvider } from '@/providers/invoke.js';
import type { ProviderRunner } from '@/providers/run.js';

/**
 * T008 [US1] — a provider **declared pure** that returns an **impure** `BuildResponse` MUST be
 * refused, naming the target (specs/003-content-zone-segregation/spec.md FR-012, quickstart S3).
 *
 * Today `impurityOf` (`src/providers/build.ts:284`, private and therefore not directly
 * unit-testable) silently coalesces the two signals — `response.impure ?? decl.impure` — so a
 * provider whose STATIC declaration says "pure" but whose RUNTIME response says "impure" is
 * accepted without complaint, and `decl` (the contradicted static declaration) is not even
 * threaded through far enough to be checked. FR-012 makes that contradiction a NAMED refusal
 * instead: contradictory provenance metadata fails loud (Constitution Principle V) rather than
 * being silently reclassified.
 *
 * This test exercises `invokeProvider` (`src/providers/invoke.ts`) directly, rather than the
 * private `impurityOf` or the full `buildTarget` pipeline, because it is the exported unit tasks.md
 * names as the candidate enforcement point ("In `src/providers/invoke.ts` (or `impurityOf` in
 * `build.ts:284`)…", T014) that can actually be called in isolation with both signals in hand —
 * `invokeProvider` already receives `decl` and returns the parsed `response`, so it is the
 * natural place to compare them before handing an `Invocation` back to the caller. Wherever the
 * refusal actually lands once T014 is implemented, this call must observe it: nothing downstream
 * of `invokeProvider` should ever see a resolved `Invocation` for this contradiction.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function freshOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoke-impurity-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * A stub `ProviderRunner` that writes one real file into `output_dir` (so `invokeProvider`'s own
 * hashing has real bytes to read — the point under test is the impurity contradiction, not a
 * missing-file error) and returns `response` verbatim, bypassing `parseBuildResponse` and every
 * wire-level schema check entirely — there is no schema rule against a pure-declared provider
 * returning an impure response; the two are validated independently, which is exactly why this
 * contradiction can reach production-control's own logic in the first place.
 */
function runnerReturning(response: BuildResponse): ProviderRunner {
  return {
    async run(request: BuildRequest): Promise<BuildResponse> {
      const outputName = response.outputs[0]?.path;
      if (outputName === undefined) {
        throw new Error('test setup error: response must declare at least one output');
      }
      await fs.writeFile(path.join(request.output_dir, outputName), 'produced bytes\n', 'utf8');
      return response;
    },
  };
}

describe('invokeProvider refuses a pure-declared provider that returns an impure response (FR-012)', () => {
  it('rejects, naming the target, rather than silently accepting the contradiction', async () => {
    const outputDir = await freshOutputDir();

    // Declared PURE: `ProviderDecl.impure` is absent.
    const decl: ProviderDecl = { cmd: ['unused'] };

    const runner = runnerReturning({
      version: 1,
      outputs: [{ path: 'out.txt' }],
      tool: { name: 'fake-tool', version: '1.0.0' },
      // The runtime response says impure — contradicting the static declaration above.
      impure: { reason: 'emits a per-run timestamp; output varies by invocation' },
    });

    const failure = await invokeProvider({
      runner,
      decl,
      target: 'voiceover',
      inputs: {},
      outputDir,
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(
      failure,
      'a provider declared pure that returned an impure response was accepted silently — ' +
        'FR-012 requires this contradiction to be a named refusal'
    ).toBeInstanceOf(Error);

    const message = failure instanceof Error ? failure.message : '';
    // The refusal must NAME the target (FR-012, FR-022).
    expect(message).toContain('voiceover');
    // And say something about the actual contradiction, not just "failed".
    expect(message.toLowerCase()).toMatch(/impure|pure/);
  });

  it('a provider declared pure that returns a PURE response is unaffected (non-vacuity)', async () => {
    const outputDir = await freshOutputDir();

    const decl: ProviderDecl = { cmd: ['unused'] };
    const runner = runnerReturning({
      version: 1,
      outputs: [{ path: 'out.txt' }],
      tool: { name: 'fake-tool', version: '1.0.0' },
      // No `impure` — consistent with the declaration.
    });

    const invocation = await invokeProvider({
      runner,
      decl,
      target: 'voiceover',
      inputs: {},
      outputDir,
    });

    expect(invocation.response.impure).toBeUndefined();
    expect(invocation.output.relPath).toBe('out.txt');
  });

  it('a provider declared IMPURE that returns an impure response is unaffected (non-vacuity)', async () => {
    const outputDir = await freshOutputDir();

    // A static declaration that agrees with the runtime response is not a contradiction.
    const decl: ProviderDecl = { cmd: ['unused'], impure: { reason: 'declared impure' } };
    const runner = runnerReturning({
      version: 1,
      outputs: [{ path: 'out.txt' }],
      tool: { name: 'fake-tool', version: '1.0.0' },
      impure: { reason: 'emits a per-run nonce' },
    });

    const invocation = await invokeProvider({
      runner,
      decl,
      target: 'voiceover',
      inputs: {},
      outputDir,
    });

    expect(invocation.response.impure?.reason).toBe('emits a per-run nonce');
  });
});

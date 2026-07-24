import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile, type Hash } from '@/hash/content.js';
import type { Identity, ProviderDecl } from '@/manifest/schema.js';
import type { BuildInput, BuildResponse } from '@/providers/contract.js';
import type { ProviderRunner } from '@/providers/run.js';

/**
 * Invoking a provider and establishing, FIRST-HAND, what it produced (T059).
 *
 * The one rule this module exists to enforce: **production-control hashes the outputs itself**
 * (contracts/provider.md § What production-control does with the response). The provider is
 * disposable — it may be replaced tomorrow by a different tool from a different vendor — and
 * the record must not depend on its honesty. A hash a provider reported would be a claim; a
 * hash computed here from the bytes on disk is an observation. Only one of those belongs in a
 * ledger.
 *
 * Shared by `pc build` and `pc validate` so the two verbs cannot drift into invoking providers
 * two different ways.
 */

export interface Invocation {
  /** The provider's own report: its tool, its impurity declaration, its verdict. */
  readonly response: BuildResponse;
  /** The single produced output, hashed HERE — never as the provider reported it. */
  readonly output: ProducedOutput;
}

export interface ProducedOutput {
  /** Relative to `output_dir`, exactly as the provider declared it. */
  readonly relPath: string;
  /** Where it is right now, inside the throwaway `output_dir`. */
  readonly fullPath: string;
  /** Computed from the bytes at `fullPath`. */
  readonly hash: Hash;
}

export interface InvokeRequest {
  readonly runner: ProviderRunner;
  readonly decl: ProviderDecl;
  readonly target: Identity;
  readonly inputs: Readonly<Record<Identity, BuildInput>>;
  /** A directory this module OWNS: emptied before the run, and the caller's to remove after. */
  readonly outputDir: string;
}

/**
 * Empties `outputDir`, runs the provider into it, and hashes what came out.
 *
 * The directory is emptied rather than merely created. The runner refuses any file in
 * `output_dir` the provider did not declare (contracts/provider.md Rule 5), so a leftover from
 * an earlier failed run would surface as a spurious accusation against a provider that did
 * nothing wrong — and, worse, a stale artifact left behind by a previous build could be
 * ingested and recorded as though this run had produced it.
 */
export async function invokeProvider(request: InvokeRequest): Promise<Invocation> {
  await fs.rm(request.outputDir, { recursive: true, force: true });
  await fs.mkdir(request.outputDir, { recursive: true });

  const response = await request.runner.run(
    {
      version: 1,
      target: request.target,
      inputs: { ...request.inputs },
      output_dir: request.outputDir,
    },
    request.decl
  );

  const output = onlyOutput(request.target, response);
  const fullPath = path.resolve(request.outputDir, output.path);

  // The runner has already proven this file exists (it reconciles the declared outputs against
  // the directory in both directions), so a failure to hash here is a real I/O fault and
  // `hashFile` names the path itself.
  return {
    response,
    output: { relPath: normalize(output.path), fullPath, hash: await hashFile(fullPath) },
  };
}

/**
 * An `ArtifactRecord` holds exactly ONE output (data-model.md § ArtifactRecord), so a provider
 * declaring several is refused rather than partly recorded.
 *
 * Recording the first and dropping the rest would be precisely the thing FR-014 forbids — an
 * output produced with no record of where it came from — and choosing one would be this system
 * deciding, on the operator's behalf, which of their artifacts is the real one. Refusing names
 * every file involved and leaves the decision where it belongs. (The empty case is already a
 * refusal in the schema: "silence is failure", contract Rule 7.)
 */
function onlyOutput(target: Identity, response: BuildResponse): { readonly path: string } {
  const outputs = response.outputs;
  const first = outputs[0];
  if (first === undefined) {
    throw new Error(
      `provider for "${target}" declared no outputs. Exit 0 with no outputs is failure ` +
        `("silence is failure", FR-033).`
    );
  }
  if (outputs.length > 1) {
    const named = outputs.map((output) => output.path).join(', ');
    throw new Error(
      `provider for "${target}" declared ${String(outputs.length)} outputs: ${named}. ` +
        `A record names exactly one output, so recording this build would leave ` +
        `${String(outputs.length - 1)} produced file(s) with no record of their origin — which ` +
        `is the thing building-and-recording-as-one-act exists to prevent (FR-014). Declare one ` +
        `target per output.`
    );
  }
  return first;
}

/** Compares and records declared paths in one shape, so `./a.out` and `a.out` agree. */
function normalize(relativePath: string): string {
  return path.normalize(relativePath).split(path.sep).join('/');
}

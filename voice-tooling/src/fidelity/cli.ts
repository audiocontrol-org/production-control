// T016: the voice-fidelity CLI core (contract "Invocation"/"Input"/"Output").
//
// Implemented as a plain TS module (rather than inline in `bin/voice-fidelity.mjs`)
// so it can be typechecked and imported like any other source file; the `.mjs`
// entry point is a thin shim that registers `tsx`'s ESM loader (this package has
// no build step — every script runs its `.ts` sources directly) and calls
// `runFidelityCli`. All actual I/O (stdin, file reads, stdout/stderr, exit code)
// lives here, NOT in the shim, per "keep the bin thin — delegate".

import * as fs from 'node:fs';
import { parse as parseYamlText } from 'yaml';
import { runFidelity } from '@/fidelity/run.ts';
import type { FidelityInput } from '@/fidelity/run.ts';

/** A single resolved input, per `src/providers/contract.ts`'s `BuildInputSchema`. */
interface WireBuildInput {
  path: string;
  hash: string;
}

/** The `ValidateRequest` wire shape (contract "Input"). */
interface ValidateRequestWire {
  version: number;
  target: string;
  artifact: WireBuildInput;
  inputs: Record<string, WireBuildInput>;
}

/**
 * Read the whole of stdin as UTF-8 text (the ONE `ValidateRequest` JSON object
 * this process reads, per the contract's "Invocation").
 */
async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Parse a lexicon input's bytes as a YAML or JSON list of terms. `yaml`'s
 * parser accepts JSON documents too (JSON is a YAML subset), so one parse
 * path covers both declared formats.
 */
function parseLexicon(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = parseYamlText(text);
  if (!Array.isArray(parsed)) {
    throw new Error('lexicon input must be a YAML/JSON list of terms');
  }
  return parsed.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`lexicon input: term at index ${index} must be a string`);
    }
    return item;
  });
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Run the fidelity validator over one `ValidateRequest` read from stdin,
 * writing the `ValidateResponse` to stdout and the coverage report to stderr
 * per the contract's three outcomes (passed / decided-failure / cannot-decide).
 *
 * @returns the process exit code (0 on a passed verdict, non-zero otherwise).
 */
export async function runFidelityCli(): Promise<number> {
  const requestText = await readStdinText();

  let request: ValidateRequestWire;
  try {
    request = JSON.parse(requestText);
  } catch (cause) {
    process.stderr.write(
      `voice-fidelity: malformed ValidateRequest JSON on stdin: ${describeError(cause)}\n`,
    );
    return 1;
  }

  const sourceInput = request.inputs['source'];
  if (sourceInput === undefined) {
    process.stderr.write('voice-fidelity: ValidateRequest.inputs.source is required\n');
    return 1;
  }

  let sourceBytes: Uint8Array;
  let editionBytes: Uint8Array;
  try {
    sourceBytes = fs.readFileSync(sourceInput.path);
    editionBytes = fs.readFileSync(request.artifact.path);
  } catch (cause) {
    process.stderr.write(
      `voice-fidelity: could not read the source or artifact from disk: ${describeError(cause)}\n`,
    );
    return 1;
  }

  let lexicon: string[] | undefined;
  const lexiconInput = request.inputs['lexicon'];
  if (lexiconInput !== undefined) {
    try {
      lexicon = parseLexicon(fs.readFileSync(lexiconInput.path));
    } catch (cause) {
      process.stderr.write(
        `voice-fidelity: could not read/parse the declared lexicon input: ${describeError(cause)}\n`,
      );
      return 1;
    }
  }

  // `sourceIdentity` is a required non-empty label (see `@/units/derive.ts`)
  // with no bearing on validation outcomes; the request's `target` identity
  // is always present and non-empty, so it is used here rather than the
  // ledger's own `source.identity` (which is not yet known before `runFidelity`
  // extracts it).
  const fidelityInput: FidelityInput = {
    source: sourceBytes,
    sourceIdentity: request.target,
    edition: editionBytes,
    // No quote-bank input exists on this v1 wire contract (D14) — always false.
    quoteBankDeclared: false,
    ...(lexicon !== undefined ? { lexicon } : {}),
  };

  const result = runFidelity(fidelityInput);

  if (!result.decided) {
    // No-verdict exit (FR-030/SC-006): NO ValidateResponse on stdout at all —
    // not even `state: "failed"`. A diagnostic plus the best-effort partial
    // coverage report go to stderr; the process exits non-zero.
    process.stderr.write(`voice-fidelity: cannot decide -- ${result.failures.join('; ')}\n`);
    process.stderr.write(`${JSON.stringify(result.report)}\n`);
    return 1;
  }

  // Decided (passed or failed): the coverage report always goes to stderr.
  process.stderr.write(`${JSON.stringify(result.report)}\n`);

  if (result.passed) {
    process.stdout.write(`${JSON.stringify({ version: 1, state: 'passed' })}\n`);
    return 0;
  }

  process.stdout.write(
    `${JSON.stringify({ version: 1, state: 'failed', errors: result.failures })}\n`,
  );
  return 1;
}

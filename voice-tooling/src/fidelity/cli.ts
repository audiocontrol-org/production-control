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
import { isRecord } from '@/util/is-record.ts';
import { runFidelity } from '@/fidelity/run.ts';
import type { FidelityInput } from '@/fidelity/run.ts';
import { isMode } from '@/schema/ledger.ts';
import type { Mode } from '@/schema/ledger.ts';

/** A single resolved input, per `src/providers/contract.ts`'s `BuildInputSchema`. */
interface WireBuildInput {
  path: string;
  hash: string;
}

/**
 * The `ValidateRequest` wire shape (contract "Input"; `requested_mode`
 * addition per contracts/fidelity-mode-agreement.md). `requested_mode` is
 * OPTIONAL: a governed build supplies it (from the provider recipe);
 * standalone `voice-fidelity` use omits it. This module only parses and
 * validates the field here (T025) -- sequencing it into `run.ts`'s
 * `check-mode-agreement` call is a separate task (T026).
 */
interface ValidateRequestWire {
  version: number;
  target: string;
  artifact: WireBuildInput;
  inputs: Record<string, WireBuildInput>;
  requested_mode?: Mode;
}

/**
 * AUDIT-20260726-21: `JSON.parse` only proves the stdin bytes are SOME valid
 * JSON value -- it proves nothing about its SHAPE. Before this guard existed,
 * a syntactically valid but shape-invalid request (`{}`, a request missing
 * `inputs`/`artifact`, or a misspelled field) reached `request.inputs['source']`/
 * `request.artifact.path` with no guard, throwing a raw, unnamed `TypeError`
 * with empty stdout -- a fourth outcome outside the contract's three
 * (passed / decided-failure / cannot-decide). Every field this validates is
 * touched by `runFidelityCli` below; nothing downstream may read `request.*`
 * before this guard has run.
 */
function isWireBuildInput(value: unknown): value is WireBuildInput {
  return (
    isRecord(value) &&
    typeof value['path'] === 'string' &&
    value['path'].trim().length > 0 &&
    typeof value['hash'] === 'string' &&
    value['hash'].trim().length > 0
  );
}

/**
 * `requested_mode` is OPTIONAL, but when present it MUST be one of the
 * closed `Mode` enum values -- fail-loud on a present-but-invalid value
 * rather than silently ignoring it (a typo'd mode must never be read as
 * "not supplied").
 */
function isValidRequestedMode(value: unknown): value is Mode | undefined {
  return value === undefined || (typeof value === 'string' && isMode(value));
}

function isValidateRequestWire(value: unknown): value is ValidateRequestWire {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    typeof value['target'] === 'string' &&
    value['target'].trim().length > 0 &&
    isWireBuildInput(value['artifact']) &&
    isRecord(value['inputs']) &&
    Object.values(value['inputs']).every(isWireBuildInput) &&
    isValidRequestedMode(value['requested_mode'])
  );
}

/**
 * Describe the first field-path violation in a shape-invalid `ValidateRequest`,
 * for the refusal message. Only ever called after `isValidateRequestWire` has
 * already returned `false` -- this never needs to describe a valid shape.
 */
function describeRequestShapeError(value: unknown): string {
  // AUDIT-20260727-05: `JSON.parse` legitimately returns `null`, an array, or a
  // scalar (number/string/boolean) for well-formed-but-wrong-shape stdin, and
  // `typeof null === 'object'`. `isRecord` already rejects all three (it checks
  // `!== null && !Array.isArray`), so `isValidateRequestWire` refuses them and
  // no field is ever read off a non-object -- but distinguish each channel here
  // so the refusal names WHY, never a bare "must be a JSON object", and so the
  // defense against the `typeof null === 'object'` TypeError class is explicit
  // at the call site rather than resting silently on `isRecord`'s internals.
  if (!isRecord(value)) {
    if (value === null) {
      return 'ValidateRequest must be a JSON object (got null)';
    }
    if (Array.isArray(value)) {
      return 'ValidateRequest must be a JSON object (got a JSON array)';
    }
    return `ValidateRequest must be a JSON object (got a JSON ${typeof value})`;
  }
  if (value['version'] !== 1) {
    return `ValidateRequest.version must be the literal 1 (got ${JSON.stringify(value['version'])})`;
  }
  if (typeof value['target'] !== 'string' || value['target'].trim().length === 0) {
    return 'ValidateRequest.target must be a non-empty string';
  }
  if (!isWireBuildInput(value['artifact'])) {
    return 'ValidateRequest.artifact must be an object with non-empty string "path" and "hash" fields';
  }
  if (!isRecord(value['inputs'])) {
    return 'ValidateRequest.inputs must be a JSON object';
  }
  for (const [key, wireInput] of Object.entries(value['inputs'])) {
    if (!isWireBuildInput(wireInput)) {
      return `ValidateRequest.inputs.${key} must be an object with non-empty string "path" and "hash" fields`;
    }
  }
  if (!isValidRequestedMode(value['requested_mode'])) {
    return `ValidateRequest.requested_mode must be one of compose, revise when present (got ${JSON.stringify(value['requested_mode'])})`;
  }
  // Unreachable given the checks above mirror isValidateRequestWire exactly;
  // named rather than asserted so a future drift between the two still
  // refuses loudly instead of silently returning a blank diagnostic.
  return 'ValidateRequest: shape is invalid for an unrecognized reason';
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

  let requestRaw: unknown;
  try {
    requestRaw = JSON.parse(requestText);
  } catch (cause) {
    process.stderr.write(
      `voice-fidelity: malformed ValidateRequest JSON on stdin: ${describeError(cause)}\n`,
    );
    return 1;
  }

  if (!isValidateRequestWire(requestRaw)) {
    process.stderr.write(`voice-fidelity: ${describeRequestShapeError(requestRaw)}\n`);
    return 1;
  }
  const request = requestRaw;

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
    // T026: thread the (optional) independently-supplied `requested_mode` into
    // the pipeline's FIRST check (mode-agreement). Absent → standalone
    // validation (`mode_comparison: none-supplied`).
    ...(request.requested_mode !== undefined ? { requestedMode: request.requested_mode } : {}),
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

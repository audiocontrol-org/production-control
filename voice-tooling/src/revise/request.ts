import * as fs from 'node:fs';
import { loadVoice } from '@/schema/voice.ts';
import type { VoiceDocument } from '@/schema/voice.ts';

/**
 * T019: parse the provider-side `BuildRequest` (contracts/voice-revise-provider.md
 * "Input") and resolve which declared input is the SOURCE draft and which is
 * the VOICE document.
 *
 * `voice-tooling` never imports production-control's own `src/providers/contract.ts`
 * (the package boundary is the subprocess wire, not a shared module — the same
 * discipline `@/fidelity/cli.ts`'s `ValidateRequestWire` already follows for the
 * validator side), so this file defines its own minimal wire type and parses it
 * by hand rather than importing a zod schema from the root package.
 *
 * Discrimination is by TYPE, not by the input's declared key name (D5/D1): a
 * production-control profile is free to name its inputs however an operator
 * likes, so the only thing distinguishing "source" from "voice" that this
 * provider can rely on is what `loadVoice` actually accepts. An input whose
 * bytes parse as a structurally valid voice document (schema/voice.ts) IS the
 * voice; the caller's one remaining non-voice input IS the source draft.
 * Exactly two inputs is the v1 shape (an optional `lexicon`/`quote-bank` input
 * may also appear per the contract, but the fixture wiring T019 targets never
 * declares one) — more than one candidate on either side is a genuine
 * ambiguity and is refused loudly rather than guessed at.
 */

interface WireBuildInput {
  readonly path: string;
  readonly hash: string;
}

export interface ResolvedSourceInput {
  readonly identity: string;
  readonly path: string;
  readonly hash: string;
  readonly bytes: Buffer;
}

export interface ResolvedVoiceInput {
  readonly identity: string;
  readonly path: string;
  readonly hash: string;
  readonly doc: VoiceDocument;
}

export interface ParsedReviseRequest {
  readonly target: string;
  readonly source: ResolvedSourceInput;
  readonly voice: ResolvedVoiceInput;
  readonly outputDir: string;
  /**
   * An explicit provider-args model command, read from the `BuildRequest`
   * itself when the wire carries one. The shipped `BuildRequestSchema`
   * (`src/providers/contract.ts`) carries no such field today — every v1
   * request is `{ version, target, inputs, output_dir }` — so this is always
   * `undefined` in practice; it exists so a future wire extension has
   * somewhere to land without a second parsing path. `@/revise/model.ts`
   * falls back to the `VOICE_REVISE_MODEL` env var when this is absent, and
   * throws (never invents a default) when NEITHER is configured.
   */
  readonly modelCmd?: string;
}

interface ReadEntry {
  readonly identity: string;
  readonly input: WireBuildInput;
  readonly bytes: Buffer;
}

/**
 * Parse a raw (already `JSON.parse`d) `BuildRequest` and resolve its source
 * and voice inputs.
 *
 * @throws Error naming the specific cause for every refusal: a malformed
 *   wire shape, an unreadable input, invalid UTF-8, no voice candidate found,
 *   more than one voice candidate, no source candidate, or more than one
 *   non-voice candidate.
 */
export function parseReviseRequest(raw: unknown): ParsedReviseRequest {
  const root = requireRecord(raw, 'BuildRequest');

  const version = root['version'];
  if (version !== 1) {
    fail(`version must be the literal 1 (got ${JSON.stringify(version)})`);
  }

  const target = requireNonEmptyString(root, 'target');
  const outputDir = requireNonEmptyString(root, 'output_dir');
  const inputsRoot = requireRecord(root['inputs'], 'inputs');

  const entries: ReadEntry[] = Object.entries(inputsRoot).map(([identity, value]) =>
    readEntry(identity, requireWireInput(value, `inputs.${identity}`)),
  );

  if (entries.length === 0) {
    fail(
      'inputs must declare at least a source draft and a voice document; the request declared none',
    );
  }

  const voiceMatches: { entry: ReadEntry; doc: VoiceDocument }[] = [];
  const otherEntries: ReadEntry[] = [];

  for (const entry of entries) {
    const text = decodeUtf8(entry.bytes, entry.identity);
    try {
      const doc = loadVoice(text);
      voiceMatches.push({ entry, doc });
    } catch {
      otherEntries.push(entry);
    }
  }

  if (voiceMatches.length === 0) {
    fail(
      `no declared input is a valid voice document (declared: ${entries
        .map((entry) => entry.identity)
        .join(', ')}) — voice revise requires exactly one voice input`,
    );
  }
  if (voiceMatches.length > 1) {
    fail(
      `more than one declared input parses as a valid voice document (${voiceMatches
        .map((match) => match.entry.identity)
        .join(', ')}) — voice revise cannot tell which one is the voice`,
    );
  }
  const voiceMatch = voiceMatches[0];
  if (voiceMatch === undefined) {
    fail('internal error: voice candidate list was non-empty but unindexable');
  }

  if (otherEntries.length === 0) {
    fail(
      'no source draft input declared alongside the voice document — voice revise requires a source draft input',
    );
  }
  if (otherEntries.length > 1) {
    fail(
      `more than one non-voice input declared (${otherEntries
        .map((entry) => entry.identity)
        .join(', ')}) — voice revise cannot tell which one is the source draft`,
    );
  }
  const sourceEntry = otherEntries[0];
  if (sourceEntry === undefined) {
    fail('internal error: source candidate list was non-empty but unindexable');
  }

  const modelCmdRaw = root['model_cmd'];
  const modelCmd =
    typeof modelCmdRaw === 'string' && modelCmdRaw.trim().length > 0 ? modelCmdRaw : undefined;

  return {
    target,
    source: {
      identity: sourceEntry.identity,
      path: sourceEntry.input.path,
      hash: sourceEntry.input.hash,
      bytes: sourceEntry.bytes,
    },
    voice: {
      identity: voiceMatch.entry.identity,
      path: voiceMatch.entry.input.path,
      hash: voiceMatch.entry.input.hash,
      doc: voiceMatch.doc,
    },
    outputDir,
    ...(modelCmd !== undefined ? { modelCmd } : {}),
  };
}

// ---- primitive parsing / validation helpers -------------------------------

function readEntry(identity: string, input: WireBuildInput): ReadEntry {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(input.path);
  } catch (cause) {
    return fail(`inputs.${identity}: could not read "${input.path}": ${describeError(cause)}`);
  }
  return { identity, input, bytes };
}

function decodeUtf8(bytes: Uint8Array, identity: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    return fail(`inputs.${identity}: not valid UTF-8: ${describeError(cause)}`);
  }
}

function requireWireInput(value: unknown, path: string): WireBuildInput {
  const record = requireRecord(value, path);
  const inputPath = requireNonEmptyString(record, 'path', path);
  const hash = requireNonEmptyString(record, 'hash', path);
  return { path: inputPath, hash };
}

function requireNonEmptyString(
  container: Record<string, unknown>,
  key: string,
  parentPath?: string,
): string {
  const value = container[key];
  const path = parentPath === undefined ? key : `${parentPath}.${key}`;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fail(message: string): never {
  throw new Error(`voice-revise: ${message}`);
}

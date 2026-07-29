// T019: the voice-revise CLI core (contracts/voice-revise-provider.md
// "Invocation"/"Input"/"Output"/"Behavior").
//
// Implemented as a plain TS module (rather than inline in `bin/voice-revise.mjs`)
// so it can be typechecked and imported like any other source file — the same
// "keep the bin thin, delegate" split `@/fidelity/cli.ts` already follows for
// the validator side.
//
// spec 006 (T012): this is now the SHARED producer core for BOTH verbs --
// `runProducer(mode)` threads the caller's `ProducerMode` through prompt
// construction (`buildModelPrompt`), protocol parsing (`parseModelOutput`,
// unchanged), and ledger building (`buildEdition`, now mode-stamped). Each of
// `bin/voice-revise.mjs` / `bin/voice-compose.mjs` (contracts/voice-compose-
// cli.md "Invocation") is a thin wrapper naming its own fixed mode; neither bin
// carries any producer logic of its own. `voice revise`'s observable behavior
// is unchanged by this refactor: same request parsing, same prompt for
// `mode: 'revise'`, same emitted `tool.name`/`impure.reason` (`@/revise/emit.ts`).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@/util/is-record.ts';
import { parseReviseRequest } from '@/revise/request.ts';
import { resolveModelCommand, invokeModel, buildModelPrompt } from '@/revise/model.ts';
import type { ProducerMode } from '@/revise/model.ts';
import { parseModelOutput } from '@/revise/protocol.ts';
import { buildEdition } from '@/revise/ledger-build.ts';
import { runPreflight } from '@/revise/preflight.ts';
import { emitEdition } from '@/revise/emit.ts';
import { helpText } from '@/revise/help.ts';

/**
 * Read the whole of stdin as UTF-8 text (the ONE `BuildRequest` JSON object
 * this process reads, per the contract's "Invocation").
 */
async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read this package's own `version` field for `tool.version` (contract
 * "Output"). Resolved relative to this module's own file rather than
 * `process.cwd()`, so the tool identity is correct no matter where `pc`
 * invokes this binary from.
 */
function readPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(here, '..', '..', 'package.json');
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch (cause) {
    throw new Error(`voice-revise: could not read "${pkgPath}": ${describeError(cause)}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`voice-revise: "${pkgPath}" has no string "version" field`);
  }
  const version = parsed['version'];
  if (typeof version !== 'string') {
    throw new Error(`voice-revise: "${pkgPath}" has no string "version" field`);
  }
  return version;
}

const TOOL_LABEL: Record<ProducerMode, string> = {
  revise: 'voice-revise',
  compose: 'voice-compose',
};

/**
 * Run the producer for the given `mode` over one `BuildRequest` read from
 * stdin, writing the `BuildResponse` to stdout on success (spec 006 T012,
 * contracts/voice-compose-cli.md "Both dispatch to `runProducer(mode,
 * request)`"). `mode` is fixed by the calling bin (`bin/voice-revise.mjs` /
 * `bin/voice-compose.mjs`) -- it is never read off the wire (the `BuildRequest`
 * shape is unchanged, contracts/voice-compose-cli.md "Input").
 *
 * `--help`/`-h` (checked in `argv`, defaulting to this process's own CLI args)
 * short-circuits BEFORE stdin is ever read: each verb's help states its own
 * fidelity contract (`@/revise/help.ts`, R6), so `--help` works standalone
 * with no `BuildRequest` and no model command configured.
 *
 * Per the contract's "Behavior" step 6 / "Output": "No output on failure" —
 * every refusal below writes a diagnostic to stderr and returns a non-zero
 * exit code, never a partial `BuildResponse` and never a partially-written
 * edition left in `output_dir`.
 *
 * @returns the process exit code (0 on success, 1 on any refusal).
 */
export async function runProducer(
  mode: ProducerMode,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const toolLabel = TOOL_LABEL[mode];

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText(mode));
    return 0;
  }

  const requestText = await readStdinText();

  let raw: unknown;
  try {
    raw = JSON.parse(requestText);
  } catch (cause) {
    process.stderr.write(
      `${toolLabel}: malformed BuildRequest JSON on stdin: ${describeError(cause)}\n`,
    );
    return 1;
  }

  try {
    const parsed = parseReviseRequest(raw);
    const modelCommand = resolveModelCommand(parsed.modelCmd);

    const sourceText = decodeUtf8(parsed.source.bytes, parsed.source.identity);
    const prompt = buildModelPrompt(mode, {
      target: parsed.target,
      source: {
        identity: parsed.source.identity,
        text: sourceText,
      },
      voice: {
        identity: parsed.voice.identity,
        doc: parsed.voice.doc,
      },
    });

    const stdout = await invokeModel(modelCommand, prompt);
    const model = parseModelOutput(stdout);

    // The PROVIDER builds the hash-keyed ledger from the model's index-based
    // coverage (the model cannot compute sha256 references): source + edition
    // units are derived mechanically here.
    const { editionText, ledger, sourceUnits, editionUnits } = buildEdition({
      sourceText,
      sourceIdentity: parsed.source.identity,
      sourceHash: parsed.source.hash,
      voiceIdentity: parsed.voice.identity,
      voiceHash: parsed.voice.hash,
      model,
      mode,
    });

    // Pre-emit self-check (contracts/voice-compose-cli.md, Principle V): an
    // INDEPENDENT invocation of the shared grounding policy over the just-
    // composed edition, BEFORE any write. On any violation, refuse loudly
    // (the offending unit is named in each refusal) and write NOTHING -- the
    // producer's success grants the paired validator nothing (Principle VI).
    const preflight = runPreflight(mode, ledger.grounding, editionUnits, sourceUnits);
    if (!preflight.ok) {
      throw new Error(`pre-emit self-check refused before any write -- ${preflight.refusals.join('; ')}`);
    }

    const toolVersion = readPackageVersion();
    const response = await emitEdition(
      parsed.outputDir,
      parsed.target,
      editionText,
      toolVersion,
      mode,
    );

    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 0;
  } catch (cause) {
    process.stderr.write(`${toolLabel}: ${describeError(cause)}\n`);
    return 1;
  }
}

function decodeUtf8(bytes: Uint8Array, identity: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`voice-revise: inputs.${identity}: not valid UTF-8: ${describeError(cause)}`);
  }
}

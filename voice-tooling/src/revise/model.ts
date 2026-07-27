import { spawn } from 'node:child_process';
import { deriveUnits } from '@/units/derive.ts';
import type { VoiceDocument } from '@/schema/voice.ts';

/**
 * TASK-29: the IMPURE model call -- spawns the configured model command,
 * mirroring `editorial-tooling`'s `claude` adapter
 * (`editorial-tooling/src/claude.mjs`, used by `quote-miner.mjs`): a spawned
 * CLI subprocess reading its PROMPT on stdin (`claude -p`), never a vendored SDK.
 *
 * The model command is provided EXPLICITLY -- there is no baked-in default model
 * and no fallback. `resolveModelCommand` throws naming the missing configuration
 * rather than inventing output; a fallback here would be exactly the kind of
 * mock-data-shaped bug this project's own conventions forbid.
 *
 * The model is handed a PROMPT (not JSON) and returns raw stdout for
 * `parseModelOutput` (`@/revise/protocol.ts`) -- it declares an index-based
 * coverage mapping; it never emits the hash-keyed ledger (which it cannot
 * compute the sha256 references for).
 */

const MODEL_ENV_VAR = 'VOICE_REVISE_MODEL';

export interface ModelCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Resolve the model command to spawn: an explicit provider-args value (from the
 * `BuildRequest`, when the wire carries one -- see `@/revise/request.ts`'s
 * `modelCmd`) wins; otherwise the `VOICE_REVISE_MODEL` env var (a plain command
 * line, e.g. `"claude -p"`) is used.
 *
 * @throws Error naming the missing configuration when neither is set -- never
 *   falls back to a default model or mock output.
 */
export function resolveModelCommand(explicit: string | undefined): ModelCommand {
  const raw = explicit ?? process.env[MODEL_ENV_VAR];
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `voice-revise: no model command is configured. Set ${MODEL_ENV_VAR} (a command line, ` +
        'e.g. "claude -p") to the model invocation, or declare one on the BuildRequest. ' +
        'voice-revise never invents a default model or falls back to mock output.',
    );
  }
  const tokens = raw.trim().split(/\s+/);
  const command = tokens[0];
  if (command === undefined) {
    throw new Error(`voice-revise: ${MODEL_ENV_VAR} must name a non-empty command`);
  }
  return { command, args: tokens.slice(1) };
}

/** What the prompt is built from: the source text and the voice's directives. */
export interface ModelInput {
  readonly target: string;
  readonly source: {
    readonly identity: string;
    readonly text: string;
  };
  readonly voice: {
    readonly identity: string;
    readonly doc: VoiceDocument;
  };
}

/** Per-unit delimiter markers -- machine-parseable so a deterministic stub can round-trip them. */
export const SOURCE_UNIT_OPEN = (index: number): string => `[SOURCE UNIT ${index}]`;
export const SOURCE_UNIT_CLOSE = (index: number): string => `[/SOURCE UNIT ${index}]`;

/**
 * Build the revise PROMPT sent to the model on stdin. The source is presented as
 * NUMBERED UNITS (derived with `deriveUnits`, exact bytes between per-unit
 * markers) so the model's `coverage` array aligns one entry per source unit, in
 * order. The prompt states the voice directives, the fidelity contract, and the
 * required `ModelReviseOutput` JSON output shape.
 */
export function buildRevisePrompt(input: ModelInput): string {
  const units = deriveUnits(input.source.text, input.source.identity);
  const numbered = units
    .map((unit, index) => `${SOURCE_UNIT_OPEN(index)}\n${unit.content}${SOURCE_UNIT_CLOSE(index)}`)
    .join('\n');

  const voice = input.voice.doc;
  const directives = [
    `- narrator_distance: ${voice.narrator_distance}`,
    `- evidence_posture: ${voice.evidence_posture}`,
    `- sentence_movement: ${voice.sentence_movement}`,
    `- paragraph_movement: ${voice.paragraph_movement}`,
    `- transitions: ${voice.transitions}`,
    `- emotional_temperature: ${voice.emotional_temperature}`,
    `- quote_handling: ${voice.quote_handling}`,
    `- avoid: ${voice.avoid.join('; ')}`,
  ].join('\n');

  return [
    'You are rewriting the narration of a SOURCE draft into a given VOICE, producing a',
    'faithful voice edition. Revise the surrounding narration -- paragraphing, transitions,',
    'exposition -- while preserving every quoted, cited, and numeric payload byte-for-byte.',
    '',
    `TASK: rewrite the source below in the voice "${voice.label}" (${voice.id}).`,
    '',
    'VOICE DIRECTIVES:',
    directives,
    '',
    'FIDELITY CONTRACT (the edition MUST satisfy this):',
    '- Every blockquote and quoted span, every citation marker (e.g. [PB-P056] and [^1]), and',
    '  every numeral in a source unit MUST survive VERBATIM (byte-exact) into that unit\'s',
    '  declared destination edition unit(s).',
    '- You MAY revise the surrounding narration, but NOT the quoted/cited/numeric payload.',
    '- Account for EVERY source unit with exactly one disposition, in source order.',
    '- Do not add or drop a blockquote/citation/numeral relative to what the disposition claims.',
    '',
    'SOURCE (numbered units, exact bytes between the [SOURCE UNIT n] ... [/SOURCE UNIT n] markers):',
    numbered,
    '',
    'OUTPUT FORMAT: output ONLY a JSON object of the form',
    '  {',
    '    "edition": "<the full revised markdown body>",',
    '    "coverage": [ { "op": "verbatim|represented|merged|cut", "edition_units": [<0-based indices>] } ]',
    '  }',
    'where:',
    '- "edition" is the full revised body, each edition unit SEPARATED BY A BLANK LINE, in reading',
    '  order, so edition unit indices are unambiguous.',
    '- "coverage" has EXACTLY ONE entry per source unit, in source order. For a non-cut op, give',
    '  "edition_units" as the 0-based indices (into the edition units you wrote) the source unit',
    '  lands in. For "cut", omit "edition_units" and give a non-empty "reason" instead.',
    '',
  ].join('\n');
}

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Spawn the configured model command, pass `prompt` on stdin, and capture stdout
 * as the raw model output for `parseModelOutput`. Not retried here (unlike
 * quote-miner's `withRetry`): a retry policy is a later concern if the real model
 * adapter needs one.
 *
 * @throws Error naming the cause on a spawn failure, a non-zero exit, or empty
 *   stdout -- never returns fabricated or partial output.
 */
export async function invokeModel(cmd: ModelCommand, prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd.command, [...cmd.args], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (cause) => {
      reject(
        new Error(`voice-revise: failed to spawn model command "${cmd.command}": ${cause.message}`),
      );
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        reject(
          new Error(
            `voice-revise: model command "${cmd.command}" exited with code ${String(code)}. ` +
              `stderr: ${stderr.trim().length > 0 ? stderr.trim() : '(empty)'}`,
          ),
        );
        return;
      }
      if (stdout.trim().length === 0) {
        reject(
          new Error(
            `voice-revise: model command "${cmd.command}" produced no output on stdout ` +
              '(expected a ModelReviseOutput JSON object: edition + coverage).',
          ),
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin.on('error', () => {
      // Mirrors the runner's own EPIPE guard (`src/providers/run.ts`): a model
      // command that exits before draining stdin closes the pipe under us, and
      // that is surfaced via the child's own exit code above, not here.
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

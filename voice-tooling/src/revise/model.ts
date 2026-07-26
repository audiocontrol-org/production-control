import { spawn } from 'node:child_process';

/**
 * T019: the IMPURE model call — spawns the configured model command, mirroring
 * `editorial-tooling`'s `claude` adapter (`editorial-tooling/src/claude.mjs`,
 * used by `quote-miner.mjs`): a spawned CLI subprocess, never a vendored SDK.
 *
 * The model command is provided EXPLICITLY — there is no baked-in default
 * model and no fallback. `resolveModelCommand` throws naming the missing
 * configuration rather than inventing output; a fallback here would be
 * exactly the kind of mock-data-shaped bug this project's own conventions
 * forbid.
 */

const MODEL_ENV_VAR = 'VOICE_REVISE_MODEL';

export interface ModelCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Resolve the model command to spawn: an explicit provider-args value (from
 * the `BuildRequest`, when the wire carries one — see
 * `@/revise/request.ts`'s `modelCmd`) wins; otherwise the `VOICE_REVISE_MODEL`
 * env var (a plain command line, e.g. `"claude -p"`) is used.
 *
 * @throws Error naming the missing configuration when neither is set — never
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

/** What the model is handed on stdin — the source text and the voice's directives. */
export interface ModelInput {
  readonly target: string;
  readonly source: {
    readonly identity: string;
    readonly hash: string;
    readonly text: string;
  };
  readonly voice: {
    readonly identity: string;
    readonly hash: string;
    readonly doc: unknown;
  };
}

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Spawn the configured model command, pass the source + voice on stdin as
 * JSON, and capture stdout as the raw edition text — markdown INCLUDING its
 * leading `ledger:` frontmatter block. The model call is retried by nobody
 * here (unlike quote-miner's `withRetry`): T019 scopes voice-revise to a
 * single deterministic-or-real spawn; a retry policy is a later concern if
 * the real model adapter needs one.
 *
 * @throws Error naming the cause on a spawn failure, a non-zero exit, or
 *   empty stdout — never returns fabricated or partial output.
 */
export async function invokeModel(cmd: ModelCommand, input: ModelInput): Promise<string> {
  const payload = JSON.stringify({ version: 1, ...input });

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
              `(expected the edition markdown, including its ledger: frontmatter).`,
          ),
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin.on('error', () => {
      // Mirrors the runner's own EPIPE guard (`src/providers/run.ts`): a model
      // command that exits before draining stdin closes the pipe under us,
      // and that is surfaced via the child's own exit code above, not here.
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

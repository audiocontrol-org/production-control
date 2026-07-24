import * as childProcess from 'node:child_process';
import {
  parseValidateResponse,
  type ValidateRequest,
  type ValidateResponse,
} from '@/providers/contract.js';
import type { ValidatorDecl } from '@/manifest/schema.js';

/**
 * Runs a validator (contract in `contract.ts` § ValidateRequest/Response). A validator is a
 * subprocess like a provider, but it JUDGES an existing artifact instead of producing one, so it
 * has its own request/response shape. Kept as an interface for the same reason the provider runner
 * is: a test substitutes a runner that spawns nothing.
 */
export interface ValidatorRunner {
  run(request: ValidateRequest, decl: ValidatorDecl): Promise<ValidateResponse>;
}

interface Invocation {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * The contract's validator runner: spawn `decl.cmd`, write the ValidateRequest to stdin, read the
 * ValidateResponse from stdout, and refuse anything that is not a clean verdict. Every failure is
 * NAMED and never swallowed into a false clean — a validator that dies, says nothing, or emits
 * garbage has produced NO verdict, which is distinct from `failed` and must not be recorded as
 * either (FR-006b).
 */
export function subprocessValidatorRunner(): ValidatorRunner {
  return {
    async run(request: ValidateRequest, decl: ValidatorDecl): Promise<ValidateResponse> {
      const command = commandOf(decl);
      const invocation = await invoke(command, decl.cmd.slice(1), request);

      if (invocation.signal !== null) {
        throw new Error(
          `validator "${command}" was killed by signal ${invocation.signal}.` +
            formatStderr(invocation.stderr)
        );
      }
      if (invocation.code !== 0) {
        throw new Error(
          `validator "${command}" exited with code ${String(invocation.code)}.` +
            formatStderr(invocation.stderr)
        );
      }
      const raw = invocation.stdout.trim();
      if (raw.length === 0) {
        throw new Error(
          `validator "${command}" exited 0 but wrote nothing to stdout; expected a ValidateResponse.` +
            formatStderr(invocation.stderr)
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`validator "${command}" wrote stdout that is not valid JSON: ${message}`, {
          cause: error,
        });
      }
      try {
        return parseValidateResponse(parsed);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`validator "${command}": ${message}`, { cause: error });
      }
    },
  };
}

function commandOf(decl: ValidatorDecl): string {
  const command = decl.cmd[0];
  if (command === undefined || command.length === 0) {
    throw new Error(
      'validator declaration has an empty `cmd` — there is no command to run. ' +
        'Name the executable in the profile; production-control will not guess one.'
    );
  }
  return command;
}

function invoke(
  command: string,
  args: readonly string[],
  request: ValidateRequest
): Promise<Invocation> {
  return new Promise<Invocation>((resolve, reject) => {
    const child = childProcess.spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(describeSpawnFailure(command, error), { cause: error }));
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        signal,
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

function describeSpawnFailure(command: string, error: NodeJS.ErrnoException): string {
  if (error.code === 'ENOENT') {
    return `validator command not found: "${command}". It is not on PATH or the path does not exist.`;
  }
  if (error.code === 'EACCES') {
    return `validator command is not executable: "${command}".`;
  }
  return `validator command "${command}" could not be started: ${error.message}`;
}

function formatStderr(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length === 0 ? ' It wrote nothing to stderr.' : `\nstderr:\n${trimmed}`;
}

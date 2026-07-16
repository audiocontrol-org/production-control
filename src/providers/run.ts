import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProviderDecl } from '@/manifest/schema.js';
import { parseBuildResponse, type BuildRequest, type BuildResponse } from '@/providers/contract.js';

/**
 * Runs a provider (contracts/provider.md).
 *
 * An interface rather than a bare function so a caller can substitute a runner that does not
 * spawn anything — the same reason the contract itself is a subprocess boundary: what a
 * provider IS must stay separable from how it is invoked.
 *
 * **The boundary (FR-030/031):** the runner hands the provider ALREADY-RESOLVED LOCAL paths.
 * It never fetches, never touches an asset store, and never hands a provider credentials.
 * Resolution happens upstream, before `run` is ever called. That is what keeps every provider
 * runnable by hand.
 */
export interface ProviderRunner {
  run(request: BuildRequest, decl: ProviderDecl): Promise<BuildResponse>;
}

/** The raw result of the subprocess, before any contract judgement is applied. */
interface Invocation {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * The contract's runner: spawn `decl.cmd`, write the BuildRequest to stdin, read the
 * BuildResponse from stdout, and refuse anything that is not a clean, honest success.
 *
 * Every one of these is a FAILURE, and each exists to prevent a specific false-clean
 * (FR-033):
 *   - non-zero exit                          -> stderr surfaced verbatim
 *   - exit 0 with ZERO outputs               -> "silence is failure" (contract Rule 7)
 *   - stdout that is not a BuildResponse     -> names what is malformed
 *   - an output present but never declared   -> names the undeclared file (Rule 5)
 *   - a declared output missing on disk      -> names it
 *   - the command not found / not executable -> names the command (FR-036)
 *
 * The last one never degrades into skipping the target or substituting a default: a tool that
 * is absent is a thing to say out loud, not to work around (FR-036).
 */
export function subprocessRunner(): ProviderRunner {
  return {
    async run(request: BuildRequest, decl: ProviderDecl): Promise<BuildResponse> {
      const command = commandOf(decl);
      const invocation = await invoke(command, decl.cmd.slice(1), request);

      assertExitedCleanly(command, invocation);
      const response = parseStdout(command, invocation);
      await assertOutputsAgreeWithDisk(command, request, response);

      return response;
    },
  };
}

/**
 * `cmd` is `z.array(z.string())` — a declaration with no command at all is a manifest bug
 * that would otherwise surface as `spawn undefined`.
 */
function commandOf(decl: ProviderDecl): string {
  const command = decl.cmd[0];
  if (command === undefined || command.length === 0) {
    throw new Error(
      'provider declaration has an empty `cmd` — there is no command to run. ' +
        'Name the executable in the profile; production-control will not guess one.'
    );
  }
  return command;
}

/**
 * Spawns the provider and feeds it the request. Resolves only once the process has closed AND
 * both pipes have drained, so stderr is never truncated in the failure path — which is the one
 * path where it is the only thing the operator has to go on.
 *
 * A spawn failure (ENOENT, EACCES) rejects here NAMING the command (FR-036).
 */
function invoke(
  command: string,
  args: readonly string[],
  request: BuildRequest
): Promise<Invocation> {
  return new Promise<Invocation>((resolve, reject) => {
    const child = childProcess.spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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

    // A provider that exits without draining stdin (the `fail` path, legitimately) closes the
    // pipe under us. That is the child's failure to report via its exit code, not a separate
    // runner error — swallowing EPIPE here keeps the real diagnostic from being masked by a
    // write that lost a race.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

/** Names the command and says which kind of absence it is (FR-036). */
function describeSpawnFailure(command: string, error: NodeJS.ErrnoException): string {
  if (error.code === 'ENOENT') {
    return `provider command not found: "${command}". It is not on PATH or the path does not exist.`;
  }
  if (error.code === 'EACCES') {
    return `provider command is not executable: "${command}".`;
  }
  const message = error.message;
  return `provider command "${command}" could not be started: ${message}`;
}

/**
 * Non-zero exit (or death by signal) is failure, with stderr surfaced VERBATIM. The provider's
 * own diagnostic is the most useful thing in the room; paraphrasing it would throw away the
 * only account of what actually went wrong.
 */
function assertExitedCleanly(command: string, invocation: Invocation): void {
  if (invocation.signal !== null) {
    throw new Error(
      `provider "${command}" was killed by signal ${invocation.signal}.` +
        formatStderr(invocation.stderr)
    );
  }
  if (invocation.code !== 0) {
    throw new Error(
      `provider "${command}" exited with code ${String(invocation.code)}.` +
        formatStderr(invocation.stderr)
    );
  }
}

/** stderr is diagnostics: free-form, surfaced to the operator on failure, never parsed. */
function formatStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return ' It wrote nothing to stderr.';
  }
  return `\nstderr:\n${trimmed}`;
}

/**
 * Parses stdout as a BuildResponse, naming what is malformed. Refusals from the schema carry
 * the offending field; a non-JSON stdout carries the parser's own message and a bounded
 * excerpt of what was actually received, since "malformed JSON" alone tells an operator
 * nothing about which of their two tools misbehaved.
 *
 * An empty `outputs` is refused HERE, by the schema — "silence is failure" (contract Rule 7,
 * FR-033). Exit 0 is not sufficient to be a success.
 */
function parseStdout(command: string, invocation: Invocation): BuildResponse {
  const raw = invocation.stdout.trim();
  if (raw.length === 0) {
    throw new Error(
      `provider "${command}" exited 0 but wrote nothing to stdout; expected a BuildResponse.` +
        formatStderr(invocation.stderr)
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `provider "${command}" wrote stdout that is not valid JSON: ${message}\n` +
        `stdout was: ${excerpt(raw)}`,
      { cause: error }
    );
  }

  try {
    return parseBuildResponse(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`provider "${command}": ${message}`, { cause: error });
  }
}

const EXCERPT_LIMIT = 500;

function excerpt(text: string): string {
  if (text.length <= EXCERPT_LIMIT) {
    return text;
  }
  return `${text.slice(0, EXCERPT_LIMIT)}… (${String(text.length)} bytes total)`;
}

/**
 * Reconciles what the provider SAID it produced against what is actually in `output_dir`, in
 * both directions. Both halves are FR-033, and neither is redundant:
 *
 *   - a declared output that does not exist would otherwise be hashed-or-ingested a step later
 *     as a confusing ENOENT far from its cause;
 *   - an UNDECLARED output is the subtler one. It looks like a bonus and is actually a hole in
 *     the record: production-control writes the ledger from the declared list, so a file
 *     nobody declared is a file whose origin nothing captures. Rule 5 — "a provider MUST
 *     declare everything it produces."
 */
async function assertOutputsAgreeWithDisk(
  command: string,
  request: BuildRequest,
  response: BuildResponse
): Promise<void> {
  const declared = new Set(response.outputs.map((output) => normalize(output.path)));

  const missing: string[] = [];
  for (const output of response.outputs) {
    const absolute = path.resolve(request.output_dir, output.path);
    // Defense in depth. `BuildOutputSchema.path` already refuses a traversing declaration, but
    // the undeclared-file walk below only covers `output_dir`, so an escaped file would pass the
    // existence check unseen. Assert the declared output resolves inside `output_dir` before
    // hashing or comparing it (FR-036).
    const relFromDir = path.relative(request.output_dir, absolute);
    if (
      relFromDir === '..' ||
      relFromDir.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relFromDir)
    ) {
      throw new Error(
        `provider "${command}" declared output.path "${output.path}" that resolves outside ` +
          `output_dir (${request.output_dir}). A declared output must be contained within it (FR-036).`
      );
    }
    if (!(await isFile(absolute))) {
      missing.push(output.path);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `provider "${command}" declared ${String(missing.length)} output(s) that do not exist ` +
        `in output_dir (${request.output_dir}): ${missing.join(', ')}`
    );
  }

  const present = await listFilesRelative(request.output_dir);
  const undeclared = present.filter((file) => !declared.has(file));
  if (undeclared.length > 0) {
    throw new Error(
      `provider "${command}" produced ${String(undeclared.length)} file(s) it did not declare ` +
        `in output_dir (${request.output_dir}): ${undeclared.join(', ')}. ` +
        'A provider must declare everything it produces (FR-033).'
    );
  }
}

/** Compares declared paths and on-disk paths in one shape, so `./a.mp3` and `a.mp3` agree. */
function normalize(relativePath: string): string {
  return path.normalize(relativePath).split(path.sep).join('/');
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Every file under `output_dir`, relative and posix-separated. Recursive: outputs may be
 * nested, and a walk that only read the top level would let an undeclared file hide one
 * directory down — which is precisely where it would hide.
 *
 * A missing `output_dir` is not an error here; the declared-outputs check above already names
 * that case far more usefully than "directory not found" would.
 */
async function listFilesRelative(outputDir: string): Promise<readonly string[]> {
  const entries = await readEntries(outputDir);

  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = path.join(entry.parentPath, entry.name);
    files.push(normalize(path.relative(outputDir, absolute)));
  }
  return files.sort();
}

/**
 * The recursive `readdir`, with a missing directory flattened to "no entries". The return type
 * is left inferred deliberately: annotating it invites the Buffer-flavoured `readdir` overload,
 * and `entry.parentPath` then stops being a string.
 */
async function readEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
}

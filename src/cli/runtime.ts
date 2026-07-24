import * as path from 'node:path';
import * as process from 'node:process';
import * as url from 'node:url';
import { z } from 'zod';
import { createEpisodeLoader, type EpisodeLoader } from '@/cli/episode.js';
import { createStdioOutput, type Output } from '@/cli/output.js';

/**
 * The exit-code discipline (FR-035, contracts/cli.md § Exit-code semantics).
 *
 * The split IS the contract — it is what lets an agent branch without parsing prose. Three
 * outcomes, three codes, and they must never be conflated:
 *
 *   0 — the verb ANSWERED. For a read verb this holds even when the answer is "everything is
 *       broken": it was asked a question and it answered one. Conflating "the answer is bad"
 *       with "the command failed" would make `pc status` unusable in any pipeline, because a
 *       caller could no longer tell "the episode has problems" from "the tool fell over".
 *   1 — the verb could not answer (a refusal, an unparseable episode, an unreadable ledger),
 *       or a GATE ran and did not pass. Both are "no" — one about the tool, one about the
 *       production — and both are distinguishable from 0 and 2.
 *   2 — the CALLER made a mistake: an unknown flag, an unknown node, a stray positional. Not
 *       the production's fault and not a gate's verdict, so it gets its own code rather than
 *       hiding inside 1.
 */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/** The seams. Constructor-injected into every verb, so a test drives one without a process. */
export interface CliDeps {
  readonly loader: EpisodeLoader;
  readonly output: Output;
}

/**
 * `--json` is the PRIMARY interface, not a courtesy: the caller is an agent, and human output
 * is the convenience layer over the same data (contracts/cli.md). Both flags are optional and
 * neither is defaulted here — `episode` absent means "the current directory", which
 * `EpisodeLoader` states as its own declared default rather than a value guessed at this layer.
 */
const ReadOptionsSchema = z.object({
  episode: z.string().optional(),
  json: z.boolean().optional(),
});

export type ReadOptions = z.infer<typeof ReadOptionsSchema>;

/**
 * Reads commander's untyped option bag into a typed shape.
 *
 * `Command.opts()` hands back values the type system knows nothing about. Parsing them through
 * a schema is the only way to cross that boundary without `any` or a type assertion — and it
 * is not ceremony: a flag that arrives as something other than what was declared is a real
 * failure, and it is named here rather than discovered three frames later as `undefined`.
 */
export function readOptions(raw: unknown): ReadOptions {
  const parsed = ReadOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Could not read command options: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Reads an error's message, never its stack — a stack trace is not a named cause (FR-036). */
export function nameError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a verb's body, converting any refusal into a NAMED message on stderr and exit 1.
 *
 * This is the "no partial answer" rule made structural (FR-036). A verb writes its answer only
 * after the whole answer exists — `EpisodeLoader.load` either returns a complete context or
 * throws — so a failure here means nothing was printed to stdout, and a caller reading stdout
 * never sees half a report followed by an error. The error is named on stderr and the process
 * exits 1. Never a stack trace as the primary message, never a fallback, never a best-effort
 * partial report.
 */
export async function runVerb(
  output: Output,
  verb: string,
  body: () => Promise<number>
): Promise<number> {
  try {
    return await body();
  } catch (error) {
    output.err(`pc ${verb}: ${nameError(error)}`);
    return EXIT_FAILED;
  }
}

/** Serializes an answer for the agent. Indented: these get read by humans while debugging too. */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * The package root, derived from this module's own location: `dist/cli/runtime.js` → the
 * package root, and `src/cli/runtime.ts` under vitest → the repo root. Both land on the
 * directory that owns `profiles/`, which is what makes the shared profile resolvable whether
 * the CLI runs from `dist/` or from source.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

/** The real process's seams. The only place `process.cwd()` and the stdio streams are bound. */
export function createDefaultDeps(): CliDeps {
  return {
    loader: createEpisodeLoader({
      cwd: process.cwd(),
      profileDirs: [path.join(PACKAGE_ROOT, 'profiles')],
    }),
    output: createStdioOutput(),
  };
}

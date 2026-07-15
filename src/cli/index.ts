#!/usr/bin/env node
import * as process from 'node:process';
import { Command, CommanderError } from 'commander';
import { explainCommand } from '@/cli/explain.js';
import { nextCommand } from '@/cli/next.js';
import { releaseCheckCommand } from '@/cli/release-check.js';
import { readReviewOptions, reviewCommand } from '@/cli/review.js';
import {
  createDefaultDeps,
  nameError,
  readOptions,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  type CliDeps,
} from '@/cli/runtime.js';
import { statusCommand } from '@/cli/status.js';
import { z } from 'zod';

/**
 * The CLI root (T040) — the entire agent-facing surface of the oracle.
 *
 * This file wires; it does not decide. Every verb lives in its own module and returns its exit
 * code, so the exit-code discipline (FR-035) is each verb's own property rather than a rule
 * this file applies on their behalf and could quietly stop applying.
 *
 * What this file DOES own is the usage boundary: commander's own errors — unknown flag,
 * unknown command, missing argument, stray positional — are all the CALLER's mistake, and they
 * exit 2. Commander would exit 1 for those by default, which would make "you typed it wrong"
 * indistinguishable from "the gate says no". `exitOverride` is what takes that decision back.
 */

/**
 * Sets the code this process will exit with.
 *
 * Assignment goes through `globalThis.process`, NOT the `node:process` namespace import above.
 * Under ESM that import is a frozen Module namespace object: TypeScript rejects the assignment
 * at compile time, and aliasing the namespace to `NodeJS.Process` to appease it only moves the
 * failure to runtime, where V8 throws `Cannot assign to read only property 'exitCode' of object
 * '[object Module]'`. The global `process` is the real, mutable object. Reads (`argv`) are
 * fine through the namespace and stay there.
 *
 * `exitCode` rather than `process.exit()`: the latter can truncate a large `--json` payload
 * stdout has not finished flushing, and a caller whose JSON parse fails intermittently on big
 * episodes would be debugging entirely the wrong thing.
 */
function setExitCode(code: number): void {
  globalThis.process.exitCode = code;
}

const EPISODE_FLAG = '--episode <dir>';
const EPISODE_HELP = 'episode directory (defaults to the current directory)';
const JSON_FLAG = '--json';
const JSON_HELP = 'machine-readable output — the primary interface';

export function createProgram(deps: CliDeps): Command {
  const program = new Command();

  program
    .name('pc')
    .description('The production oracle: what state is every part in, and why.')
    .version('0.0.1');

  // Both must precede `.command()`: subcommands copy inherited settings at construction, so
  // configuring them afterwards would leave every subcommand on commander's defaults — exiting
  // the process itself, with code 1, before any of this could map it to 2.
  program.exitOverride();
  program.allowExcessArguments(false);

  program
    .command('status')
    .description('Report every node, its state, and why. Exits 0 whenever it can answer.')
    .option(EPISODE_FLAG, EPISODE_HELP)
    .option(JSON_FLAG, JSON_HELP)
    .action(async (...args: unknown[]): Promise<void> => {
      setExitCode(await statusCommand(deps, readOptions(args[0])));
    });

  program
    .command('next')
    .description('The actionable frontier: what could be acted on now. Exits 0.')
    .option(EPISODE_FLAG, EPISODE_HELP)
    .option(JSON_FLAG, JSON_HELP)
    .action(async (...args: unknown[]): Promise<void> => {
      setExitCode(await nextCommand(deps, readOptions(args[0])));
    });

  program
    .command('explain')
    .argument('<node>', 'the node whose state to explain')
    .description('Walk the causal chain behind one node, back to the authored inputs. Exits 0.')
    .option(EPISODE_FLAG, EPISODE_HELP)
    .option(JSON_FLAG, JSON_HELP)
    .action(async (...args: unknown[]): Promise<void> => {
      const node = z.string().parse(args[0]);
      setExitCode(await explainCommand(deps, node, readOptions(args[1])));
    });

  program
    .command('release-check')
    .description('Can this be released? Exit 0 if yes, 1 if not — naming every blocker.')
    .option(EPISODE_FLAG, EPISODE_HELP)
    .option(JSON_FLAG, JSON_HELP)
    .action(async (...args: unknown[]): Promise<void> => {
      setExitCode(await releaseCheckCommand(deps, readOptions(args[0])));
    });

  // The one verb here that WRITES. `--reason` is declared optional to commander and required by
  // the verb, deliberately: commander's own "required option" refusal names the flag but not why
  // it exists, and "a waiver without a reason is not a decision" is the whole point of the rule
  // (FR-022b). The verb says that itself, and still exits 2.
  program
    .command('review')
    .argument('<node>', 'the node whose review to decide')
    .description('Record a human decision about advisory drift. Exits 0 once recorded.')
    .option('--waive', 'accept the tracked node as it now stands, pinning its current hash')
    .option('--reason <text>', 'why — required; a waiver without a reason is not a decision')
    .option(EPISODE_FLAG, EPISODE_HELP)
    .option(JSON_FLAG, JSON_HELP)
    .action(async (...args: unknown[]): Promise<void> => {
      const node = z.string().parse(args[0]);
      setExitCode(await reviewCommand(deps, node, readReviewOptions(args[1])));
    });

  return program;
}

/**
 * Runs the program and maps every outcome onto the three codes.
 *
 */
export async function run(argv: readonly string[], deps: CliDeps): Promise<void> {
  const program = createProgram(deps);

  // No verb named at all. Commander treats this as success and prints nothing; a caller who
  // typed `pc` and got silence learned nothing. Show the surface and call it what it is.
  if (argv.length <= 2) {
    deps.output.err(program.helpInformation().trimEnd());
    setExitCode(EXIT_USAGE);
    return;
  }

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` come through here too, having done exactly what was asked;
      // commander reports those with exitCode 0. Everything else reaching this branch is the
      // caller's mistake, and none of it is worth a stack trace.
      setExitCode(error.exitCode === 0 ? EXIT_OK : EXIT_USAGE);
      return;
    }
    // A verb threw past its own guard. Name it — never let node print a stack trace as the
    // primary message (FR-036).
    deps.output.err(`pc: ${nameError(error)}`);
    setExitCode(EXIT_FAILED);
  }
}

await run(process.argv, createDefaultDeps());

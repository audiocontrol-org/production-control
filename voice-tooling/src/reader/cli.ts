// The `voice-reader` CLI core. Mirrors the "keep the bin thin, delegate"
// split `@/fidelity/cli.ts` and `@/revise/cli.ts` already follow: the `.mjs`
// entry point only registers tsx's ESM loader and hands off to
// `runReaderCli` here, so this is typecheckable/testable like any other
// module.
//
// `cwd` is threaded in explicitly (rather than read from `process.cwd()`
// internally) because the `.mjs` shim -- like its siblings -- `chdir`s into
// this package's own directory before importing this module, so that its
// `@/...` import alias always resolves against `voice-tooling/tsconfig.json`
// regardless of the caller's working directory (see `bin/voice-fidelity.mjs`'s
// header comment for why). Reading `process.cwd()` from inside this module
// would then resolve relative `--editions`/`--voices`/`--out` paths against
// the PACKAGE directory instead of the caller's actual directory -- a known
// class of bug in the existing bins (see .stack-control backlog
// "voice-bins-chdir-breaks-relative-paths"). Taking `cwd` as a parameter lets
// the shim capture the ORIGINAL cwd before it `chdir`s, so this tool does not
// repeat that bug.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverEditions } from '@/reader/discover.ts';
import { renderReader } from '@/reader/render.ts';

interface ParsedArgs {
  editionsRoot: string;
  voicesDir?: string;
  outPath: string;
  title: string;
}

const DEFAULT_TITLE = 'Voice Editions';

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  let editions: string | undefined;
  let voices: string | undefined;
  let out: string | undefined;
  let title: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--editions':
        editions = argv[i + 1];
        i += 1;
        break;
      case '--voices':
        voices = argv[i + 1];
        i += 1;
        break;
      case '--out':
        out = argv[i + 1];
        i += 1;
        break;
      case '--title':
        title = argv[i + 1];
        i += 1;
        break;
      default:
        throw new Error(`voice-reader: unrecognized argument "${arg}"`);
    }
  }

  if (editions === undefined || editions.trim().length === 0) {
    throw new Error('voice-reader: missing required flag --editions <dir>');
  }
  if (out === undefined || out.trim().length === 0) {
    throw new Error('voice-reader: missing required flag --out <file>');
  }

  return {
    editionsRoot: path.resolve(cwd, editions),
    ...(voices !== undefined && voices.trim().length > 0
      ? { voicesDir: path.resolve(cwd, voices) }
      : {}),
    outPath: path.resolve(cwd, out),
    title: title !== undefined && title.trim().length > 0 ? title : DEFAULT_TITLE,
  };
}

/**
 * Run `voice-reader` over CLI flags: discover every chapter/voice edition
 * under `--editions`, render the self-contained HTML reader, and write it to
 * `--out`. Prints the out path plus a one-line chapter/voice summary to
 * stdout on success.
 *
 * @returns the process exit code (0 on success, 1 on any refusal).
 */
export async function runReaderCli(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, cwd);
  } catch (cause) {
    process.stderr.write(`${describeError(cause)}\n`);
    return 1;
  }

  try {
    const model = discoverEditions({
      editionsRoot: parsed.editionsRoot,
      ...(parsed.voicesDir !== undefined ? { voicesDir: parsed.voicesDir } : {}),
    });
    const html = renderReader(model, { title: parsed.title });

    fs.mkdirSync(path.dirname(parsed.outPath), { recursive: true });
    fs.writeFileSync(parsed.outPath, html, 'utf8');

    const chapterCount = model.chapters.length;
    const voiceCount = model.voices.length;
    process.stdout.write(`${parsed.outPath}\n`);
    process.stdout.write(
      `${chapterCount} chapter${chapterCount === 1 ? '' : 's'}, ${voiceCount} voice${voiceCount === 1 ? '' : 's'}\n`,
    );
    return 0;
  } catch (cause) {
    process.stderr.write(`voice-reader: ${describeError(cause)}\n`);
    return 1;
  }
}

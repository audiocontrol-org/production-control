#!/usr/bin/env node

// voice-reader CLI entry point.
//
// This package has no build step -- every module ships as `.ts` source and
// runs via `tsx`. This thin shim registers tsx's ESM loader hooks
// programmatically (so the binary works whether invoked as
// `node --import tsx bin/voice-reader.mjs` or run directly as
// `voice-tooling/bin/voice-reader.mjs`) and then delegates entirely to
// `src/reader/cli.ts`. All actual argument-parsing/discovery/render logic
// lives there, NOT here -- mirrors `bin/voice-fidelity.mjs` and
// `bin/voice-revise.mjs` exactly.
//
// A caller may invoke this binary from ANY working directory, with relative
// `--editions`/`--voices`/`--out` paths meant to resolve against THAT
// directory. `tsx`'s programmatic `register()` resolves the nearest
// `tsconfig.json` from `process.cwd()` ONCE, at registration time -- so this
// shim `chdir`s into this package's own directory first, exactly like its
// siblings, so the `@/...` alias always resolves against
// `voice-tooling/tsconfig.json` regardless of the caller's cwd. Unlike its
// siblings, this tool's flags carry relative paths the caller expects
// resolved against their OWN cwd (not this package's) -- so the ORIGINAL cwd
// is captured BEFORE the `chdir` and passed through to `runReaderCli`, which
// resolves `--editions`/`--voices`/`--out` against it explicitly.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const invocationCwd = process.cwd();

process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const { register } = await import('tsx/esm/api');
register();

const { runReaderCli } = await import('../src/reader/cli.ts');

process.exitCode = await runReaderCli(process.argv.slice(2), invocationCwd);

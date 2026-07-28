#!/usr/bin/env node

// T016: voice-fidelity CLI entry point (contract "Invocation").
//
// This package has no build step -- every module ships as `.ts` source and
// runs via `tsx`. This thin shim registers tsx's ESM loader hooks
// programmatically (so the binary works whether or not the caller invoked it
// via `node --import tsx bin/voice-fidelity.mjs` or ran it directly as
// `voice-tooling/bin/voice-fidelity.mjs`, per the contract's "Runnable by
// hand" example) and then delegates entirely to `src/fidelity/cli.ts`. All
// actual request-handling logic lives there, NOT here.
//
// T019 fix: `production-control` (a SIBLING package one directory up, with
// its OWN `tsconfig.json` that ALSO declares an `"@/*"` path alias) spawns
// this binary as a `voice-editions` target's `validator.cmd`, with its own
// `process.cwd()` -- never `voice-tooling/` (`src/providers/run.ts` spawns
// with no `cwd` override). `tsx`'s programmatic `register()` resolves the
// nearest `tsconfig.json` from `process.cwd()` ONCE, at registration time --
// so invoked from the repo root, this shim would silently pick up the
// REPO'S `tsconfig.json` (whose `"@/*"` maps to the repo's own `src/`, not
// this package's) and every `@/...` import below would 404 with `Cannot
// find package '@/fidelity'`. `chdir` into this package's own directory
// FIRST, before `register()` ever runs, so the alias always resolves
// against `voice-tooling/tsconfig.json` regardless of the caller's cwd.
// Safe to do unconditionally: every path this process touches (the
// `ValidateRequest`'s artifact/input paths) arrives already resolved to an
// absolute path, so nothing downstream depends on the inherited cwd.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const { register } = await import('tsx/esm/api');
register();

const { runFidelityCli } = await import('../src/fidelity/cli.ts');

process.exitCode = await runFidelityCli();

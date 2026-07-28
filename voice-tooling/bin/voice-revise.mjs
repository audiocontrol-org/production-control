#!/usr/bin/env node

// T019: voice-revise CLI entry point (contract "Invocation").
//
// This package has no build step -- every module ships as `.ts` source and
// runs via `tsx`. This thin shim registers tsx's ESM loader hooks
// programmatically (so the binary works whether or not the caller invoked it
// via `node --import tsx bin/voice-revise.mjs` or ran it directly as
// `voice-tooling/bin/voice-revise.mjs`, per the contract's "Runnable by hand"
// example) and then delegates entirely to `src/revise/cli.ts`. All actual
// request-handling logic lives there, NOT here -- mirrors
// `bin/voice-fidelity.mjs` exactly.
//
// `production-control` (a SIBLING package one directory up, with its OWN
// `tsconfig.json` that ALSO declares an `"@/*"` path alias) spawns this
// binary with its own `process.cwd()` -- never `voice-tooling/` -- since
// `pc build` never `chdir`s before invoking a provider (`src/providers/run.ts`
// spawns with no `cwd` override at all). `tsx`'s programmatic `register()`
// resolves the nearest `tsconfig.json` from `process.cwd()` ONCE, at
// registration time -- so left unchanged, a `pc build` invocation from the
// repo root would have this shim silently pick up the REPO'S `tsconfig.json`
// (whose `"@/*"` maps to the repo's own `src/`, not this package's) and every
// `@/...` import below would 404. `chdir` into this package's own directory
// FIRST, before `register()` ever runs, so the alias always resolves against
// `voice-tooling/tsconfig.json` regardless of the caller's cwd. Safe to do
// unconditionally: every path this process touches (the `BuildRequest`'s
// input paths and `output_dir`) arrives already resolved to an absolute path
// (contract "Input" -- FR-030), so nothing downstream depends on the
// inherited cwd.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const { register } = await import('tsx/esm/api');
register();

const { runReviseCli } = await import('../src/revise/cli.ts');

process.exitCode = await runReviseCli();

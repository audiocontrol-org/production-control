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

import { register } from 'tsx/esm/api';

register();

const { runFidelityCli } = await import('../src/fidelity/cli.ts');

process.exitCode = await runFidelityCli();

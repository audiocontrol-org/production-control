// Subprocess capture, shared by every model adapter (src/claude.mjs, src/claude-agent.mjs).
//
// NON-BLOCKING ON PURPOSE (TASK-11): `spawn`, never `spawnSync`. A synchronous spawn would
// freeze the event loop for the whole model call and silently defeat the miner's
// bounded-concurrency pool — the pool would start N calls that still ran one after another.
//
// The RESULT SHAPE is deliberately spawnSync's (`{ status, stdout, stderr, error }`) so the
// injected `spawnImpl` seam accepts a plain synchronous test fake as readily as this
// implementation. This function never rejects: a spawn failure comes back as `error`.

import { spawn } from 'node:child_process';

/** Output ceiling, the same one `spawnSync`'s `maxBuffer` used to enforce, kept explicit. */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Run a command to completion without blocking the event loop.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, maxBuffer?: number }} options
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>}
 */
export function spawnCapture(command, args, options = {}) {
  const maxBuffer = options.maxBuffer ?? MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', error });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        child.kill();
        settle({
          status: null,
          stdout: '',
          stderr,
          error: new Error(`stdout exceeded maxBuffer of ${maxBuffer} bytes`),
        });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => settle({ status: null, stdout, stderr, error }));
    child.on('close', (status) => settle({ status, stdout, stderr }));

    // A child that exits before reading the whole prompt makes this pipe emit EPIPE. That
    // is not a spawn failure — the exit status and stderr are the real verdict — so it must
    // not become an unhandled 'error' event that kills the process.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '', 'utf8');
  });
}

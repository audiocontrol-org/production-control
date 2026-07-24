import * as process from 'node:process';

/**
 * The CLI's two streams, behind an interface so a verb never reaches for `process` directly.
 *
 * The split is not cosmetic: it is the exit-code contract's other half. An ANSWER goes to
 * stdout and the verb exits 0; a REFUSAL goes to stderr and the verb exits non-zero. A caller
 * piping `pc status --json` into a parser must never find an error message mixed into the
 * JSON it is reading, and a caller reading stderr must never find an answer there.
 */
export interface Output {
  /** The answer. Always stdout — this is what `--json` writes. */
  out(line: string): void;
  /** The refusal, named. Always stderr, never a stack trace (FR-036). */
  err(line: string): void;
}

export function createStdioOutput(): Output {
  return {
    out(line: string): void {
      process.stdout.write(`${line}\n`);
    },
    err(line: string): void {
      process.stderr.write(`${line}\n`);
    },
  };
}

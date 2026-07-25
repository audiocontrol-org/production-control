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
  /**
   * A spawned craft tool's OWN diagnostics, forwarded as they arrive.
   *
   * Stderr, like a refusal — but it is neither pc's words nor a line: it is a raw chunk of
   * somebody else's output, passed through with nothing added, no newline appended, and no
   * prefix. A provider that spends hours over a corpus streams its progress here, and a validator
   * that passes still reports here (`src/providers/diagnostics.ts`). It must never reach stdout:
   * a caller piping `pc build --json` into a parser would find a progress bar in its JSON.
   */
  diagnostic(chunk: string): void;
}

export function createStdioOutput(): Output {
  return {
    out(line: string): void {
      process.stdout.write(`${line}\n`);
    },
    err(line: string): void {
      process.stderr.write(`${line}\n`);
    },
    diagnostic(chunk: string): void {
      process.stderr.write(chunk);
    },
  };
}

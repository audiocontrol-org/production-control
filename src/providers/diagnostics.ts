import { TextDecoder } from 'node:util';

/**
 * Where a subprocess's live stderr goes (contracts/provider.md § stderr).
 *
 * **stderr is diagnostics, and diagnostics are for the operator — on success as much as on
 * failure.** A provider that spends hours over a 123-source corpus streams `progress: 12/123 …`
 * for exactly one reason: so somebody can see it happening. A provider whose contract requires a
 * machine-readable report (quote-miner.md FR-017: selected / grounded / omitted / corrections)
 * writes it there too, and "a bank may pass fidelity while the report reveals weak selection" —
 * so the report is most valuable precisely on the runs that succeed. Accumulating stderr and
 * quoting it only when the child fails throws all of that away.
 *
 * So the runners TEE: every chunk is handed to this sink as it arrives AND still accumulated for
 * the verbatim-on-failure message, which is unchanged.
 *
 * **Why a sink and not `process.stderr`.** The runners are a boundary, not a program: a library
 * module that wrote to a global stream would be untestable (a test could only observe it by
 * monkey-patching the process) and would put terminal output on the import path of anything that
 * ever spawns a provider. The sink is OPTIONAL, and its absence means exactly what it meant
 * before this existed — accumulate only. The CLI is the one layer that knows where an operator's
 * eyes are, and it supplies the sink that writes to `process.stderr` (`src/cli/output.ts`).
 *
 * Chunks are handed over RAW: no newline is added, none is assumed, and a chunk is not a line.
 * A provider that emits a progress bar with `\r` gets a progress bar.
 */
export type DiagnosticSink = (chunk: string) => void;

/**
 * Accumulates a child's stderr and, when a sink is supplied, tees each chunk to it as it arrives.
 *
 * The accumulation is over BYTES (`Buffer[]`, concatenated once at the end), which is what keeps
 * the failure message byte-identical to what it has always been and un-truncated. The live view
 * decodes INCREMENTALLY (`TextDecoder` in stream mode) because a chunk boundary can fall in the
 * middle of a multi-byte character — decoding each chunk independently would print mojibake into
 * an operator's terminal for any provider that speaks anything but ASCII.
 */
export interface StderrCollector {
  /** Hand it every chunk the child writes to stderr, in order. */
  accept(chunk: Buffer): void;
  /** Call once the stream has ended, to emit any bytes the decoder was still holding. */
  flush(): void;
  /** Everything the child wrote to stderr, verbatim. */
  text(): string;
}

export function collectStderr(onDiagnostic?: DiagnosticSink): StderrCollector {
  const chunks: Buffer[] = [];
  // Constructed only when someone is listening: with no sink this is exactly the buffer-only
  // behaviour that predates the sink, and no decoding work happens at all.
  const decoder = onDiagnostic === undefined ? undefined : new TextDecoder('utf-8');

  function emit(text: string): void {
    if (onDiagnostic !== undefined && text.length > 0) {
      onDiagnostic(text);
    }
  }

  return {
    accept(chunk: Buffer): void {
      chunks.push(chunk);
      if (decoder !== undefined) {
        emit(decoder.decode(chunk, { stream: true }));
      }
    },
    flush(): void {
      if (decoder !== undefined) {
        // Ends the stream. Empty for well-formed input; a replacement character if the child died
        // mid-character, which is a truer report than silently dropping the bytes.
        emit(decoder.decode());
      }
    },
    text(): string {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

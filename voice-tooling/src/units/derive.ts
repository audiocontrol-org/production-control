import { createHash } from 'node:crypto';

/**
 * A derived source unit: a maximal run of non-separator lines, with its
 * durable-identity fields. See the D6 normative derivation in
 * docs/superpowers/specs/2026-07-25-voice-editions-design.md and spec.md
 * FR-008..FR-011.
 */
export interface SourceUnit {
  /** Exact bytes of the unit's lines, original terminators included, unnormalized. */
  content: string;
  /** Full 64-lowercase-hex sha256 of the content bytes (never truncated). */
  contentHash: string;
  /** 0-based index among units of THIS source sharing a contentHash, in document order. */
  occurrenceIndex: number;
}

const FRONTMATTER_DELIMITER = '---';

/**
 * Derive byte-exact source units from a document (D6). Total and deterministic
 * with no I/O.
 *
 * @param input Source bytes (decoded as strict UTF-8) or an already-valid UTF-8 string.
 * @param sourceIdentity The declared identity of the source (reserved for callers
 *   that thread identity through; occurrence indexing is per-source by construction).
 * @throws Error naming the invalid-UTF-8 cause when byte input is not valid UTF-8.
 */
export function deriveUnits(
  input: string | Uint8Array,
  sourceIdentity: string,
): SourceUnit[] {
  if (sourceIdentity.length === 0) {
    throw new Error('deriveUnits requires a non-empty source identity');
  }

  const text = typeof input === 'string' ? input : decodeStrictUtf8(input);

  const lines = stripLeadingFrontmatter(splitPhysicalLines(text));
  const rawUnits = groupUnits(lines);

  const hashOccurrences = new Map<string, number>();
  const units: SourceUnit[] = [];
  for (const content of rawUnits) {
    const contentHash = createHash('sha256')
      .update(Buffer.from(content, 'utf8'))
      .digest('hex');
    const occurrenceIndex = hashOccurrences.get(contentHash) ?? 0;
    hashOccurrences.set(contentHash, occurrenceIndex + 1);
    units.push({ content, contentHash, occurrenceIndex });
  }
  return units;
}

/**
 * Decode bytes as strict UTF-8 (D6.1). Invalid or truncated sequences throw
 * before any unit is produced, with a message naming the invalid-UTF-8 cause.
 */
function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(
      `Source input is not valid UTF-8: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

/**
 * Split text into physical lines, each retaining its own terminator (D6.3/D6.7).
 * A final line without a trailing newline is preserved as-is.
 */
function splitPhysicalLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

/**
 * Strip ONLY a single leading frontmatter block (D6.2 / FR-008 / FR-011):
 * when the first physical line is exactly `---`, remove through the next line
 * that is exactly `---` (inclusive). Nothing else is stripped.
 */
function stripLeadingFrontmatter(lines: string[]): string[] {
  const first = lines[0];
  if (first === undefined || stripTerminator(first) !== FRONTMATTER_DELIMITER) {
    return lines;
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && stripTerminator(line) === FRONTMATTER_DELIMITER) {
      return lines.slice(i + 1);
    }
  }
  // No closing delimiter: nothing is a complete frontmatter block, so strip nothing.
  return lines;
}

/**
 * Group physical lines into units: maximal runs of consecutive non-separator
 * lines (D6.5). Separator lines inside a fenced code block do not separate (D6.6).
 */
function groupUnits(lines: string[]): string[] {
  const units: string[] = [];
  let current: string[] = [];
  let fenceChar: string | null = null;

  const flush = (): void => {
    if (current.length > 0) {
      units.push(current.join(''));
      current = [];
    }
  };

  for (const line of lines) {
    const marker = fenceMarker(line);
    if (marker !== null) {
      // A fence line has non-whitespace content, so it is never a separator;
      // it always belongs to the current unit and toggles fence state.
      if (fenceChar === null) {
        fenceChar = marker;
      } else if (marker === fenceChar) {
        fenceChar = null;
      }
      current.push(line);
      continue;
    }

    if (fenceChar === null && isSeparator(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return units;
}

/** A separator line is spaces/tabs only, after an optional trailing CR (D6.4). */
function isSeparator(line: string): boolean {
  const withoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;
  return /^[ \t]*\r?$/.test(withoutNewline);
}

/**
 * Detect a code-fence line (D6.6): begins with three or more backticks or
 * tildes (allowing up to three leading spaces, per CommonMark). Returns the
 * fence marker char (`` ` `` or `~`) or null.
 */
function fenceMarker(line: string): string | null {
  const body = stripTerminator(line);
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(body);
  if (match === null || match[1] === undefined) {
    return null;
  }
  return match[1].charAt(0);
}

/** Remove a trailing LF and then a trailing CR, if present. */
function stripTerminator(line: string): string {
  const noLf = line.endsWith('\n') ? line.slice(0, -1) : line;
  return noLf.endsWith('\r') ? noLf.slice(0, -1) : noLf;
}

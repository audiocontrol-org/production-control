// T014: unit-local payload extraction (FR-019..FR-022, contract step 5, R4/D11).
//
// Extraction operates on ONE source (or destination) unit's `content` bytes.
// Every field is a MULTISET represented as an array that preserves both
// multiplicity and document order. Extraction is total and side-effect-free:
// the same `content` always yields the same payload, and it reads nothing but
// its arguments. See specs/004-voice-editions/spec.md FR-020 for the
// always-extracted payload definition and research.md R4 for the byte-exact,
// case-sensitive, no-Unicode-normalization discipline.

/**
 * The literal payload extracted from a single unit's content. Each field is a
 * MULTISET (an array preserving multiplicity and document order): a value that
 * occurs k times in the content appears k times, in the order encountered.
 */
export interface UnitPayload {
  /** Verbatim quoted spans (blockquote-line remainders for the current corpus). */
  quotes: string[];
  /** Footnote-style citation markers, e.g. `[^1]`, `[^PB-P076]`. */
  citations: string[];
  /** Maximal numeric-literal tokens, e.g. `1978`, `3.14`, `1,000`. */
  numerics: string[];
  /** Declared-lexicon term occurrences (empty unless a non-empty lexicon is given). */
  lexiconTerms: string[];
}

/** Maximal numeric-literal tokens: digit runs joined by `.`/`,` (byte-exact). */
const NUMERIC_RE = /\d+(?:[.,]\d+)*/g;

/** Footnote-style citation markers: `[^` then one-or-more non-`]`/non-space. */
const CITATION_RE = /\[\^[^\]\s]+\]/g;

/**
 * A blockquote physical line: up to three leading spaces, `>`, one optional
 * whitespace, then the captured remainder (byte-exact, the verbatim quoted span).
 */
const BLOCKQUOTE_RE = /^ {0,3}>\s?(.*)$/;

/**
 * Extract the literal payload from ONE unit's `content`.
 *
 * @param content Exact UTF-8 bytes of a single unit (terminators included).
 * @param lexicon Optional declared lexicon; when provided and non-empty, its
 *   terms are matched byte-exact and case-sensitively (no Unicode normalization).
 *   When undefined or empty, `lexiconTerms` is `[]` — the caller decides whether
 *   that means `not-run` (no lexicon declared) or a checked-empty result.
 * @throws Error when a lexicon term is the empty string (a malformed lexicon).
 */
export function extractPayload(
  content: string,
  lexicon?: readonly string[],
): UnitPayload {
  return {
    quotes: extractQuotes(content),
    citations: extractMatches(content, CITATION_RE),
    numerics: extractNumerics(content),
    lexiconTerms: extractLexiconTerms(content, lexicon),
  };
}

/**
 * Extract maximal numeric-literal tokens, EXCLUDING any digits that belong to a
 * citation marker's own label (AUDIT-20260726-08/-11). `NUMERIC_RE` and
 * `CITATION_RE` scan the same bytes, so a digit-labeled footnote marker like
 * `[^1]` would otherwise be counted as BOTH a citation AND a numeric — a
 * double-booking that contaminates multiset survival in both directions (a
 * dropped prose numeral could be "corroborated" by a surviving citation marker,
 * and a legitimate footnote renumber could read as a numeric shortfall). Masking
 * the citation-marker spans before applying `NUMERIC_RE` makes extraction itself
 * correct at the single source of truth, so a bare `[^1]` yields a citation only.
 */
function extractNumerics(content: string): string[] {
  const withoutCitationMarkers = content.replace(
    new RegExp(CITATION_RE.source, CITATION_RE.flags),
    '',
  );
  return extractMatches(withoutCitationMarkers, NUMERIC_RE);
}

/** Collect every match of a global regex verbatim, preserving order+multiplicity. */
function extractMatches(content: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  for (;;) {
    const match = re.exec(content);
    if (match === null) {
      break;
    }
    out.push(match[0]);
    // Guard against a zero-width match stalling the loop (defensive; the
    // patterns here always consume at least one char).
    if (match.index === re.lastIndex) {
      re.lastIndex += 1;
    }
  }
  return out;
}

/**
 * Extract verbatim quoted spans: for each physical line matching a blockquote,
 * capture the remainder after `>` and one optional space (byte-exact). One
 * entry per blockquote line (multiset). The blockquote rule lives here alone so
 * FR-020's "as defined by the approved quote-extraction rules" is honored in one
 * place and future inline-quotation support is a change to this function only.
 */
function extractQuotes(content: string): string[] {
  const quotes: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = BLOCKQUOTE_RE.exec(line);
    if (match !== null && match[1] !== undefined) {
      quotes.push(match[1]);
    }
  }
  return quotes;
}

/**
 * Extract declared-lexicon term occurrences: byte-exact, case-sensitive,
 * non-overlapping. Results are ordered by their position in `content` so the
 * multiset preserves document order across all terms.
 */
function extractLexiconTerms(
  content: string,
  lexicon?: readonly string[],
): string[] {
  if (lexicon === undefined || lexicon.length === 0) {
    return [];
  }
  const found: { position: number; term: string }[] = [];
  for (const term of lexicon) {
    if (term.length === 0) {
      throw new Error(
        'lexicon term must be non-empty; an empty term has no byte-exact match semantics',
      );
    }
    let from = 0;
    for (;;) {
      const index = content.indexOf(term, from);
      if (index === -1) {
        break;
      }
      found.push({ position: index, term });
      from = index + term.length; // non-overlapping occurrences
    }
  }
  found.sort((a, b) => a.position - b.position);
  return found.map((entry) => entry.term);
}

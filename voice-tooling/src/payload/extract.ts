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
  /**
   * Citation markers, e.g. `[^1]`, `[^PB-P076]` (footnote-style) or
   * `[PB-P056]` (bracketed source-marker style, no caret).
   */
  citations: string[];
  /** Maximal numeric-literal tokens, e.g. `1978`, `3.14`, `1,000`. */
  numerics: string[];
  /** Declared-lexicon term occurrences (empty unless a non-empty lexicon is given). */
  lexiconTerms: string[];
  /**
   * Declared open-question markers, e.g. `[OPEN-QUESTION: What caused the
   * anomaly in sample 2?]` (R7/FR-013, T027). Required payload: when present,
   * the marker's exact bytes must survive from the spine beat into its
   * declared edition destination, the same multiset guarantee citations and
   * numerals already carry.
   */
  openQuestionMarkers: string[];
}

/** Maximal numeric-literal tokens: digit runs joined by `.`/`,` (byte-exact). */
const NUMERIC_RE = /\d+(?:[.,]\d+)*/g;

/**
 * Citation markers: EITHER a footnote-style marker (`[^` then one-or-more
 * non-`]`/non-space, e.g. `[^1]`, `[^PB-P076]`) OR a bracketed source-marker
 * (e.g. `[PB-P056]`, `[XYZ-12A]`): an uppercase-initial alpha prefix, a
 * hyphen, then an alphanumeric/hyphen tail. The source-marker branch is
 * deliberately narrow (uppercase-initial prefix + hyphen required) so it
 * matches corpora like Nouvelle-France's `[PB-P056]` inline source citations
 * without swallowing ordinary bracketed markdown (e.g. `[link text]`,
 * `[TODO]`).
 */
const CITATION_RE = /\[\^[^\]\s]+\]|\[[A-Z][A-Z0-9]*-[A-Z0-9-]+\]/g;

/**
 * Open-question markers (R7/FR-013, T027): the literal bracketed
 * `[OPEN-QUESTION: ...]` form -- `[OPEN-QUESTION:` then the question text, which
 * may itself contain ONE level of nested brackets (a `[^ref-4]` citation, a
 * `[ABC-1]` source marker, or a bare `foo[0]`), then the closing `]`.
 *
 * BRACKET-AWARE (D3, AUDIT-20260730-14): the question body is
 * `(?:[^\[\]]|\[[^\[\]]*\])*` -- a run of non-bracket characters OR a single
 * balanced nested `[...]` pair -- so the marker's closing `]` is the FIRST
 * top-level `]`, never a nested one. The pre-fix `[^\]]*` truncated at the first
 * inner `]`, and because `extractPayload` matched RAW content while the numeric
 * masker matched citation-STRIPPED content, the two disagreed on the marker's
 * extent and a numeral after the inner `]` fell required by NEITHER multiset.
 *
 * Deliberately narrow (the exact declared syntax named in FR-013/
 * `@/revise/prompt/compose.ts`'s producer instruction), and ONE level of
 * nesting only: a marker whose brackets do not balance at one level -- an
 * unterminated `[OPEN-QUESTION:` with no top-level `]`, or a stray inner `[`
 * that consumes the marker's only `]` -- is simply NOT recognized (its bytes are
 * ordinary prose, numerals enforced normally), per FR-013's "absent such a
 * syntax, ... not a deterministic failure". Two adjacent markers never merge:
 * a top-level `]` (matched by neither alternative) forces the current marker to
 * close before the next `[OPEN-QUESTION:` begins.
 */
const OPEN_QUESTION_RE = /\[OPEN-QUESTION:(?:[^\[\]]|\[[^\[\]]*\])*\]/g;

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
  // INVARIANT (D3, AUDIT-20260730-14): the byte span an open-question marker
  // payload REQUIRES is exactly the span the numeric extractor MASKS. Both the
  // marker extraction and the numeric mask below are computed from the SAME
  // `citationMasked` text with the SAME bracket-aware `OPEN_QUESTION_RE`, so
  // they can never disagree about where a marker ends -- closing the pre-fix
  // hole where a numeral after a marker's inner `]` was required by neither the
  // marker multiset nor the numeric multiset.
  //
  // Citations are masked FIRST (see `maskCitations`): a citation nested inside a
  // marker (`[^ref-4]`, `[ABC-1]`) is booked ONCE, in the citation multiset
  // (extracted from RAW `content` below), and never double-booked into the
  // marker's own bytes -- the same single-source-of-truth discipline the
  // citation-vs-numeral masking already established (AUDIT-20260726-08/-11). A
  // NON-citation inner bracket (`foo[0]`) is not masked and stays inside the
  // marker span, kept intact by the bracket-aware pattern.
  const citationMasked = maskCitations(content);
  const openQuestionMarkers = extractMatches(citationMasked, OPEN_QUESTION_RE);
  const markerMasked = citationMasked.replace(
    new RegExp(OPEN_QUESTION_RE.source, OPEN_QUESTION_RE.flags),
    '',
  );
  return {
    quotes: extractQuotes(content),
    citations: extractMatches(content, CITATION_RE),
    numerics: extractMatches(markerMasked, NUMERIC_RE),
    lexiconTerms: extractLexiconTerms(content, lexicon),
    openQuestionMarkers,
  };
}

/**
 * Remove every citation-marker span so the remaining text is the substrate BOTH
 * the open-question marker extractor and the numeric extractor operate on
 * (AUDIT-20260726-08/-11 + D3). Masking citations first means:
 *   - a digit-labeled footnote (`[^1]`) is never double-booked as a numeric (a
 *     dropped prose numeral could otherwise be "corroborated" by a surviving
 *     citation), and
 *   - a citation nested inside an open-question marker (`[^ref-4]`, `[ABC-1]`)
 *     is booked ONCE in the citation multiset, never a second time inside the
 *     marker's bytes.
 * The mask is built from `CITATION_RE.source`/`.flags` (not a re-declared
 * pattern), so extending `CITATION_RE` (e.g. the `[PB-P056]` source-marker
 * branch) masks those spans here automatically.
 */
function maskCitations(content: string): string {
  return content.replace(new RegExp(CITATION_RE.source, CITATION_RE.flags), '');
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

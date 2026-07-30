import { parse as parseYamlText, stringify as stringifyYaml } from 'yaml';
import { loadLedger, type LoadedLedger } from '@/schema/ledger.ts';
import { extractPayload } from '@/payload/extract.ts';

/**
 * Pre-checks that run before any unit obligation is evaluated (contract
 * steps 2 and 6, D20, D13.4):
 *
 * - `checkLedgerStructure` delegates ALL structural validation to
 *   `loadLedger` (T005) -- it does not re-implement any of it.
 * - `extractLedgerYaml` pulls the `ledger:` sub-tree out of an edition's
 *   frontmatter, re-serialized as an independent YAML document (the ledger
 *   travels inside the artifact -- D7/D10 -- but `loadLedger` itself has no
 *   knowledge of carriers).
 * - `checkSourceCitationAllowlist` is the D13.4 edge-case precondition: a
 *   source whose own citation markers are not declared in its own
 *   frontmatter allow-list is refused before edition validation begins
 *   (FR-023).
 */

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface LedgerStructureCheckResult {
  ok: boolean;
  /** A LOADED ledger (AUDIT-45): its `mode` is guaranteed present by the loader. */
  ledger?: LoadedLedger;
  failure?: string;
}

export interface CitationAllowlistCheckResult {
  ok: boolean;
  failure?: string;
}

/**
 * Parse and structurally validate a coverage-ledger YAML document (contract
 * step 2, D20). Delegates entirely to `loadLedger` -- never re-implements
 * structural validation.
 */
export function checkLedgerStructure(ledgerYaml: string): LedgerStructureCheckResult {
  try {
    const ledger = loadLedger(ledgerYaml);
    return { ok: true, ledger };
  } catch (cause) {
    return {
      ok: false,
      failure: `ledger structure: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * Extract the YAML text under an edition's frontmatter `ledger:` key,
 * re-serialized as a self-contained YAML document that `loadLedger` can
 * parse on its own (D10: `loadLedger` has no knowledge of where its input
 * came from).
 *
 * @throws Error naming the cause when the edition has no leading frontmatter
 *   block, or the frontmatter has no top-level `ledger:` key.
 */
export function extractLedgerYaml(editionBytes: string | Uint8Array): string {
  const text = decodeText(editionBytes);
  const block = extractFrontmatterBlock(text);
  if (block === undefined) {
    throw new Error(
      'extractLedgerYaml: edition has no leading frontmatter block (expected a "---" ... "---" section)',
    );
  }

  const parsed = parseYamlText(block.yamlText);
  if (!isRecord(parsed) || !('ledger' in parsed)) {
    throw new Error('extractLedgerYaml: edition frontmatter has no top-level "ledger:" key');
  }
  return stringifyYaml(parsed['ledger']);
}

/**
 * D13.4 precondition (contract step 6): confirm every citation marker --
 * footnote-style (`[^label]`) OR bracketed source-marker style (`[PB-P056]`,
 * FR-020) -- present in the SOURCE's body resolves within the source's own
 * frontmatter allow-list (`citation_allowlist`, and/or markers derived from a
 * declared `sources:` list -- see `parseCitationAllowlist`). A source whose
 * citations fall outside its own allow-list is refused before edition
 * validation begins. A source with no declared allow-list but which contains
 * citation markers also fails -- markers must be declared, not merely
 * present. Marker extraction delegates to `extractPayload` (the SAME
 * extraction `@/payload/extract.ts` uses elsewhere) rather than
 * re-implementing a citation-marker regex here, so the two never drift apart.
 */
export function checkSourceCitationAllowlist(
  sourceBytes: string | Uint8Array,
): CitationAllowlistCheckResult {
  const text = decodeText(sourceBytes);
  const block = extractFrontmatterBlock(text);
  const allowlist = block === undefined ? [] : parseCitationAllowlist(block.yamlText);
  const body = block === undefined ? text : block.body;

  const markers = extractPayload(body).citations;
  for (const marker of markers) {
    if (!allowlist.includes(marker)) {
      return {
        ok: false,
        failure: `source citation allow-list: marker ${marker} in source is not declared in citation_allowlist`,
      };
    }
  }
  return { ok: true };
}

// ---- shared helpers (also used by @/fidelity/run.ts) -----------------------
//
// `extractFrontmatterBlock`, `parseCitationAllowlist`, and `decodeText` are
// exported (in addition to the two check functions above) because the T016
// orchestrator (`@/fidelity/run.ts`) needs the SAME frontmatter-stripped body
// and the SAME parsed `citation_allowlist` array that `checkSourceCitationAllowlist`
// computes internally -- re-deriving them with different logic would risk the
// two call sites silently drifting apart.

export interface FrontmatterBlock {
  /** Raw YAML text between the frontmatter delimiters (delimiters excluded). */
  yamlText: string;
  /** Remaining text after the frontmatter block. */
  body: string;
}

export function extractFrontmatterBlock(text: string): FrontmatterBlock | undefined {
  const match = FRONTMATTER_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  return {
    yamlText: match[1] ?? '',
    body: text.slice(match[0].length),
  };
}

/**
 * Resolve a source's allow-list of citation markers (D13.4/FR-020). Two
 * frontmatter shapes are recognized and, when both are present, UNIONED
 * (either form is accepted):
 *
 * - `citation_allowlist:` -- an explicit list of literal markers, e.g.
 *   `["[^1]"]` (the original footnote-only shape).
 * - `sources:` -- a list of bare source ids, e.g. `[PB-P056, PB-P092]` (the
 *   Nouvelle-France ebook shape); each id `PB-P056` derives the marker
 *   `[PB-P056]`. This is a DERIVATION, not a second independent allow-list --
 *   a corpus that declares its allowed sources this way gets the same
 *   allow-list guarantee without also having to spell out
 *   `citation_allowlist` redundantly.
 */
export function parseCitationAllowlist(frontmatterYaml: string): string[] {
  const parsed = parseYamlText(frontmatterYaml);
  if (!isRecord(parsed)) {
    return [];
  }
  const declared = parseDeclaredCitationAllowlist(parsed);
  const derived = deriveSourcesAllowlist(parsed);
  return unionPreservingOrder(declared, derived);
}

function parseDeclaredCitationAllowlist(parsed: Record<string, unknown>): string[] {
  const value = parsed['citation_allowlist'];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('source citation allow-list: citation_allowlist must be a list when present');
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`source citation allow-list: citation_allowlist[${index}] must be a string`);
    }
    return item;
  });
}

/**
 * Derive allow-listed markers from a frontmatter `sources:` list (FR-020):
 * each bare id `PB-P056` becomes the bracketed marker `[PB-P056]`, matching
 * the source-marker style `@/payload/extract.ts`'s `CITATION_RE` recognizes.
 */
function deriveSourcesAllowlist(parsed: Record<string, unknown>): string[] {
  const value = parsed['sources'];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('source citation allow-list: sources must be a list when present');
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`source citation allow-list: sources[${index}] must be a string`);
    }
    return `[${item}]`;
  });
}

/** Union two marker lists, preserving `a`'s order then appending `b`'s novel entries in order. */
function unionPreservingOrder(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const item of b) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function decodeText(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    return input;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch (cause) {
    throw new Error(
      `Input is not valid UTF-8: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

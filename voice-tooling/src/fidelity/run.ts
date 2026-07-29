// T016: the US1 fidelity orchestrator (contract "Behavior" ordered check
// sequence; FR-017/018/020/022/025/030; SC-001/002/003/004/006; D12/D13.4/D15/D22).
//
// `runFidelity` composes the already-implemented, independently-tested
// building blocks (T004-T015) into ONE deterministic, no-I/O, no-network run:
// it never re-implements a check another module already owns; it only
// sequences them, folds their results into the coverage report shape
// (`@/fidelity/report.ts`), and draws the three-way outcome distinction the
// contract requires (decided-passed / decided-failed / cannot-decide).
//
// Support helpers (source-unit indexing, the two report-only recomputations,
// and failure classification) live in `@/fidelity/run-support.ts` and
// `@/fidelity/classify-op-failures.ts` — split out to keep this file within
// the project's file-size guideline.

import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import type { CoverageLedger } from '@/schema/ledger.ts';
import { checkSourceHash } from '@/fidelity/check-source-hash.ts';
import {
  checkLedgerStructure,
  checkSourceCitationAllowlist,
  extractLedgerYaml,
  decodeText,
  type CitationAllowlistCheckResult,
} from '@/fidelity/check-ledger-structure.ts';
import { checkUnitAccounting } from '@/fidelity/check-unit-accounting.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import { checkCitations, assertQuoteDialectSupported } from '@/fidelity/check-payload.ts';
import type { Mode } from '@/schema/ledger.ts';
import {
  passed,
  notRun,
  aborted,
  reported,
  notCheckable,
  failed,
  computeVerdict,
  composeTrustBoundaryFields,
  type CheckResult,
  type CoverageReport,
} from '@/fidelity/report.ts';
import {
  readDeclaredSourceHash,
  indexSourceUnits,
  countUncorroboratedUnits,
  stripFrontmatterBody,
  parseSourceCitationAllowlist,
} from '@/fidelity/run-support.ts';
import {
  findUnresolvedDestinationChecks,
  classifyOpFailures,
  type NamedCheck,
} from '@/fidelity/classify-op-failures.ts';

/** Input to a single deterministic fidelity run (contract "Input"). */
export interface FidelityInput {
  source: string | Uint8Array;
  sourceIdentity: string;
  edition: string | Uint8Array;
  lexicon?: readonly string[];
  quoteBankDeclared?: boolean;
}

/**
 * The three-way outcome the contract requires: a decided pass, a decided
 * failure (both `decided: true`), or cannot-decide (`decided: false`, and
 * `report.verdict` is then never set) — see "No-verdict exit" (FR-030/SC-006).
 */
export interface FidelityResult {
  report: CoverageReport;
  passed: boolean;
  decided: boolean;
  failures: string[];
}

/** Checks that ABORT (become `not-run`) after `source_hash` fails. */
const AFTER_SOURCE_HASH = [
  'ledger_structure',
  'unit_accounting',
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
] as const;

/** Checks that ABORT after `ledger_structure` fails. */
const AFTER_LEDGER_STRUCTURE = [
  'unit_accounting',
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
] as const;

/** Checks that ABORT after `unit_accounting` fails. */
const AFTER_UNIT_ACCOUNTING = [
  'verbatim_quotes',
  'citations',
  'numeric_literals',
  'lexicon',
  'uncorroborated_units',
] as const;

export function runFidelity(input: FidelityInput): FidelityResult {
  // Fail-loud guard (D14/FR-024): v1 never declares a quote bank as input.
  // A caller that declares one anyway gets an actual thrown exception here,
  // per this guard's own documented contract — it is not a soft cannot-decide
  // outcome, since a declared-but-unsupported capability is a caller defect,
  // not an I/O-shaped inability to decide.
  assertQuoteDialectSupported(input.quoteBankDeclared ?? false);

  const checks: Record<string, CheckResult> = {};
  const failures: string[] = [];

  // ---- Cannot-decide branch (FR-030/SC-006): unreadable inputs -----------
  let ledgerYaml: string;
  try {
    ledgerYaml = extractLedgerYaml(input.edition);
  } catch (cause) {
    return cannotDecide(
      `could not extract a coverage ledger from the edition's frontmatter: ${describeError(cause)}`,
    );
  }

  let sourceUnits: SourceUnit[];
  try {
    sourceUnits = deriveUnits(input.source, input.sourceIdentity);
  } catch (cause) {
    return cannotDecide(`could not derive source units: ${describeError(cause)}`);
  }

  // ---- 1. source_hash (checked FIRST, before any unit obligation) -------
  const declaredSourceHash = readDeclaredSourceHash(ledgerYaml);
  if (declaredSourceHash === undefined) {
    // The ledger's own `source.hash` field is unreadable -- a structural
    // fault of the ledger itself (there is nothing for source_hash to
    // compare against), NOT a source_hash mismatch and NOT cannot-decide
    // (a schema-malformed ledger is a decided ledger_structure failure).
    const structResult = checkLedgerStructure(ledgerYaml);
    const structureFailure =
      structResult.failure ?? 'ledger structure: source.hash is missing or not a string';
    checks['ledger_structure'] = failed(structureFailure);
    checks['source_hash'] = aborted('aborted: ledger_structure failed');
    failures.push(structureFailure);
    markAborted(checks, AFTER_LEDGER_STRUCTURE, 'ledger_structure');
    return finalize(checks, failures, true);
  }

  const hashResult = checkSourceHash(input.source, declaredSourceHash);
  if (!hashResult.ok) {
    const failure = hashResult.failure ?? 'source hash: mismatch';
    checks['source_hash'] = failed(failure);
    failures.push(failure);
    markAborted(checks, AFTER_SOURCE_HASH, 'source_hash');
    return finalize(checks, failures, true);
  }
  checks['source_hash'] = passed();

  // ---- 2. ledger_structure (+ folded-in source citation allow-list) -----
  const structResult = checkLedgerStructure(ledgerYaml);
  if (!structResult.ok || structResult.ledger === undefined) {
    const failure = structResult.failure ?? 'ledger structure: invalid';
    checks['ledger_structure'] = failed(failure);
    failures.push(failure);
    markAborted(checks, AFTER_LEDGER_STRUCTURE, 'ledger_structure');
    return finalize(checks, failures, true);
  }

  // D13.4 (contract step 6, evaluated here as a ledger-adjacent precondition,
  // "before edition validation begins"): the SOURCE's own citation markers
  // must all resolve within the source's own declared allow-list.
  //
  // AUDIT-20260726-18: `checkSourceCitationAllowlist` can THROW (rather than
  // return `{ ok: false }`) on a malformed `citation_allowlist` shape -- not a
  // list, or a list with a non-string entry. This point is only reached AFTER
  // `source_hash` has already confirmed `input.source` IS the bytes the
  // ledger declared, so a malformed allow-list shape here is a decided
  // structural refusal of the source's own declaration (folded into
  // `ledger_structure`, the check that already owns "the ledger/source pair
  // is structurally sound") -- never an uncaught exception, and never
  // cannot-decide (this is not an I/O-shaped inability to read the source;
  // deriveUnits above already proved the bytes decode).
  let allowlistResult: CitationAllowlistCheckResult;
  try {
    allowlistResult = checkSourceCitationAllowlist(input.source);
  } catch (cause) {
    const failure = `ledger structure: source citation allow-list is malformed: ${describeError(cause)}`;
    checks['ledger_structure'] = failed(failure);
    failures.push(failure);
    markAborted(checks, AFTER_LEDGER_STRUCTURE, 'ledger_structure');
    return finalize(checks, failures, true);
  }
  if (!allowlistResult.ok) {
    const failure = allowlistResult.failure ?? 'source citation allow-list: violation';
    checks['ledger_structure'] = failed(failure);
    failures.push(failure);
    markAborted(checks, AFTER_LEDGER_STRUCTURE, 'ledger_structure');
    return finalize(checks, failures, true);
  }
  checks['ledger_structure'] = passed();
  const ledger: CoverageLedger = structResult.ledger;

  // ---- 3. unit_accounting -------------------------------------------------
  const accountingResult = checkUnitAccounting(sourceUnits, ledger);
  if (!accountingResult.ok) {
    checks['unit_accounting'] = failed(
      accountingResult.failures[0] ?? 'unit accounting: unresolved',
      { total: accountingResult.total },
    );
    failures.push(...accountingResult.failures);
    markAborted(checks, AFTER_UNIT_ACCOUNTING, 'unit_accounting');
    return finalize(checks, failures, true);
  }
  checks['unit_accounting'] = passed({ total: accountingResult.total });

  // ---- 4/5. per-op obligations + payload checks --------------------------
  const editionIdentity = `${input.sourceIdentity}#edition`;
  let editionUnits: SourceUnit[];
  try {
    editionUnits = deriveUnits(input.edition, editionIdentity);
  } catch (cause) {
    // Unreachable in practice (extractLedgerYaml already decoded the same
    // edition bytes successfully above) but handled defensively per the
    // "any I/O-shaped inability to decide" clause.
    return cannotDecide(`could not derive edition units: ${describeError(cause)}`);
  }

  const opResult = checkOpObligations(ledger, sourceUnits, editionUnits, input.lexicon);
  failures.push(...opResult.failures.map((f) => f.message));

  const sourceByKey = indexSourceUnits(sourceUnits);
  const editionByKey = indexSourceUnits(editionUnits);

  // AUDIT-20260726-23: bucket op-obligation failures under their named checks
  // by their STRUCTURED kind (never by regex over the human message). A
  // declared destination that no longer resolves in the edition carries no
  // payload kind, so it is classified per-entry (by the entry's own op and
  // source payload) and a clarifying, kind-specific diagnostic is surfaced
  // into `failures` alongside the raw one.
  const opFailureChecks = classifyOpFailures(opResult.failures);
  const unresolvedDestinationChecks = findUnresolvedDestinationChecks(
    ledger,
    sourceByKey,
    editionByKey,
    input.lexicon,
    failures,
  );
  const affectedChecks = new Set<NamedCheck>([
    ...opFailureChecks,
    ...unresolvedDestinationChecks,
  ]);

  const sourceText = decodeText(input.source);
  const editionText = decodeText(input.edition);
  const sourceBody = stripFrontmatterBody(sourceText);
  const editionBody = stripFrontmatterBody(editionText);

  // AUDIT-20260726-18: this is the SAME source frontmatter `citation_allowlist`
  // the `checkSourceCitationAllowlist` call above already parsed successfully
  // (same bytes, same extraction logic) -- unreachable in practice once that
  // call has succeeded -- but guarded defensively for the same reason the
  // `deriveUnits` re-derivation below is: a thrown parse error must never
  // escape `runFidelity` uncaught, regardless of which call site produced it.
  let sourceAllowlist: string[];
  try {
    sourceAllowlist = parseSourceCitationAllowlist(sourceText);
  } catch (cause) {
    const failure = `ledger structure: source citation allow-list is malformed: ${describeError(cause)}`;
    checks['ledger_structure'] = failed(failure);
    failures.push(failure);
    markAborted(checks, AFTER_LEDGER_STRUCTURE, 'ledger_structure');
    return finalize(checks, failures, true);
  }
  const citationResult = checkCitations(sourceBody, editionBody, sourceAllowlist);
  failures.push(...citationResult.failures);

  // verbatim_quotes: a byte-mismatch on a `verbatim` destination, a quote
  // payload that fails to survive, or an unresolved destination affecting a
  // quote/verbatim entry, all surface here (there is no separate named
  // "verbatim" check in the ten-check report).
  const verbatimOrQuoteFailed = affectedChecks.has('verbatim_quotes');
  checks['verbatim_quotes'] = verbatimOrQuoteFailed
    ? failed('one or more verbatim/quote obligations were not satisfied; see failures[]')
    : passed({ checked: opResult.payloadChecked.quotes });

  // numeric_literals: `checked` reads `opResult.payloadChecked.numerics`
  // directly. As of AUDIT-20260726-08/-11 the extractor itself excludes a
  // citation marker's own digits (see `@/payload/extract.ts`), so this count
  // is already the free-standing-prose numeral count -- no display-only
  // recomputation is needed and there is no longer a second source of truth.
  const numericFailed = affectedChecks.has('numeric_literals');
  checks['numeric_literals'] = numericFailed
    ? failed('one or more numeric literals did not survive into declared destinations; see failures[]')
    : passed({ checked: opResult.payloadChecked.numerics });

  // citations: EITHER a source citation fails to survive its declared
  // destinations (op obligation, including an unresolved destination) OR the
  // edition fabricates/mis-allow-lists a citation (document-level
  // `checkCitations`) fails this check.
  const citationOpFailed = affectedChecks.has('citations');
  checks['citations'] =
    citationOpFailed || !citationResult.ok
      ? failed('one or more citation obligations were not satisfied; see failures[]')
      : passed({ mode: citationResult.mode, checked: citationResult.checked });

  // lexicon: not-run (inapplicable — the `not-run` state now unambiguously means
  // "inapplicable", distinct from the `aborted` state) when no lexicon was
  // declared at all (FR-020) — never silently skipped.
  if (!opResult.lexiconApplicable) {
    checks['lexicon'] = notRun('no lexicon declared');
  } else {
    const lexiconFailed = affectedChecks.has('lexicon');
    checks['lexicon'] = lexiconFailed
      ? failed('one or more declared-lexicon terms did not survive into declared destinations; see failures[]')
      : passed({ checked: opResult.payloadChecked.lexiconTerms });
  }

  // op_obligations (catch-all, AUDIT-20260728-28): the named check for every
  // op-obligation failure whose kind maps to NO single payload check -- verbatim
  // byte-identity, an unresolved destination reference, or a structural fault
  // (arity, no shared destination, empty destination, source not found). Present
  // and `failed` ONLY when such a failure exists; ABSENT on a clean run so it
  // never appears in a passing report. Because the verdict derives from the
  // named-check map ALONE (`computeVerdict`), this is what withholds a verdict
  // for those kinds -- structurally, with no `failures.length` side-channel that
  // could let a `passed` coexist with a recorded failure (AUDIT-20260727-18/-29).
  if (affectedChecks.has('op_obligations')) {
    checks['op_obligations'] = failed(
      'one or more op obligations (verbatim byte-identity, unresolved destination, ' +
        'or a structural fault) were not satisfied; see failures[]',
    );
  }

  // ---- 6. uncorroborated_units (D12/FR-022) -------------------------------
  // Recomputed here rather than reused from `opResult.uncorroboratedUnits`:
  // that count includes EVERY non-cut entry (verbatim included), whereas
  // FR-022's uncorroborated signal is specifically about `represented`/
  // `merged` entries — a `verbatim` entry's payload is proven by the byte
  // match itself, so an empty-payload verbatim unit is not "uncorroborated"
  // in the same sense.
  checks['uncorroborated_units'] = reported({
    count: countUncorroboratedUnits(ledger, sourceByKey, input.lexicon),
  });

  // ---- 7. honest boundary (D4/D16) ---------------------------------------
  checks['semantic_claim_fidelity'] = notCheckable(
    'not provable under D4 — declared out of scope for v1',
  );
  checks['voice_conformance'] = notCheckable(
    'not provable under D16 — declared out of scope for v1',
  );

  return finalize(checks, failures, true, ledger.mode);
}

// ---- outcome assembly -------------------------------------------------------

/**
 * T027 (spec 006 Polish phase) will extend `@/payload/extract.ts` to
 * recognize a declared `[OPEN-QUESTION: ...]` marker as required payload; the
 * report's `open_question_markers` field will then be computed from whether
 * that recognition actually fired for this edition. Until that lands, no
 * mechanism declares any such marker to the system, so every composed report
 * MUST say so honestly rather than claim an enforcement that does not exist.
 */
const OPEN_QUESTION_MARKERS_STATE: 'enforced' | 'none-declared' = 'none-declared';

function finalize(
  checks: Record<string, CheckResult>,
  failures: string[],
  decided: true,
  mode?: Mode,
): FidelityResult {
  // Every applicable path above already sets both honest-boundary checks
  // before reaching here EXCEPT the abort paths (source_hash/ledger_structure/
  // unit_accounting failures return early) -- set them unconditionally so
  // FR-025/SC-004's "every one of the ten checks is always named" holds even
  // on a decided, aborted failure.
  if (!('semantic_claim_fidelity' in checks)) {
    checks['semantic_claim_fidelity'] = notCheckable(
      'not provable under D4 — declared out of scope for v1',
    );
  }
  if (!('voice_conformance' in checks)) {
    checks['voice_conformance'] = notCheckable(
      'not provable under D16 — declared out of scope for v1',
    );
  }

  // The verdict derives from the named-check map ALONE (AUDIT-20260728-28):
  // every op-obligation failure has already flipped a named check (a payload
  // check, or the `op_obligations` catch-all) by the time we get here, so there
  // is no `failures.length` coupling and no advisory side-channel that could flip
  // a pass. `failures[]` remains for the human-facing ValidateResponse only.
  const verdict = computeVerdict({ checks });
  const isPassed = verdict === 'passed';
  // FR-012 (spec 006): a composed edition's report always carries the
  // trust-boundary fields, regardless of verdict — they describe the scope
  // of what was checked, not whether it passed.
  const trustBoundary = mode === 'compose' ? composeTrustBoundaryFields(OPEN_QUESTION_MARKERS_STATE) : {};
  const report: CoverageReport = {
    ...(isPassed ? { verdict: 'passed' as const } : {}),
    ...trustBoundary,
    checks,
  };
  return { report, passed: isPassed, decided, failures };
}

function cannotDecide(diagnostic: string): FidelityResult {
  return {
    report: { checks: {} },
    passed: false,
    decided: false,
    failures: [diagnostic],
  };
}

function markAborted(
  checks: Record<string, CheckResult>,
  names: readonly string[],
  abortedBy: string,
): void {
  for (const name of names) {
    checks[name] = aborted(`aborted: ${abortedBy} failed`);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

# voice-tooling

Reusable craft tools that produce and verify voice-varied editions of a source-locked draft.

## Entry points

- **voice-revise**: An impure provider that generates voice variations from a source draft.
- **voice-fidelity**: A deterministic validator that verifies fidelity constraints across voice editions.

## Independent use

This package is independently useful outside production-control and imports no production-control source code.

## Validator honest boundary

### What `voice fidelity` proves

`voice fidelity` is a **deterministic validator**: no language model, no similarity threshold, no network calls.

It proves:
1. **Unit accounting** — every source unit carries exactly one declared disposition in the coverage ledger.
2. **Literal-payload preservation** — verbatim quoted spans, citation markers, numeric literals, and (when a lexicon is declared) lexicon terms survive byte-exact and multiset into each entry's declared destinations.
3. **Source version match** — the ledger was written against the supplied source draft (verified by hash).
4. **Structural ledger validity** — the coverage ledger conforms to schema and contains no contradictions.

The coverage report enumerates each check (`source_hash`, `ledger_structure`, `unit_accounting`, `verbatim_quotes`, `citations`, `numeric_literals`, `lexicon`, `uncorroborated_units`) and reports its state: `passed`, `not-run`, or `reported`.

### What `voice fidelity` does NOT and CANNOT prove

This validator **does not** and **cannot** prove:
- **Semantic claim equivalence** for rewritten prose — whether a represented or merged destination unit conveys the same meaning as its source unit.
- **Voice conformance** — whether an edition adheres to the voice's declared traits.

Both `semantic_claim_fidelity` and `voice_conformance` are reported as `not-checkable` in v1 by design, not by omission. This is a first-class limitation, stated plainly here and in every coverage report, not a footnote.

### Corroboration, never inference

The validator **corroborates** the producer's declared coverage mapping from the ledger. It does not **infer** a mapping the producer did not declare. A `represented` or `merged` entry declares which destination unit(s) hold the source unit's payload; the validator confirms those destinations exist and the payload survives there. It never attempts to discover a "better" destination or to map an accounted unit to an undeclared location. The ledger is the authoritative editorial declaration under review.

### Uncorroborated units as a quality signal

When a source unit yields no extractable literal payload (no quotations, citations, numeric literals, or lexicon terms to verify), it is recorded as `uncorroborated`. The uncorroborated-unit count is a **report-only quality signal** — it never causes the validator to refuse an edition. A high count indicates weak corroborating evidence for the operator to review; it is never a threshold-based refusal.

## Unit-derivation coverage for deferred markdown constructs

The D6 unit-derivation algorithm (see `src/units/derive.ts`) is construct-agnostic: it operates only on separator lines (blank/whitespace-only) and fenced code-block delimiters. Markdown constructs outside the current corpus (setext headings, MDX-style statements, HTML blocks, and list items separated by blank lines) are documented via golden fixtures in `test/golden-markdown.test.ts`. These fixtures pin the exact unit-split behavior for each construct under D6 rules:

- **Setext headings** (text followed by `===` or `---` underline): Treated as two consecutive content lines forming a single unit (no line-ending normalization, no special syntax recognition). When the underline is `---` and not at the document start, it is neither a frontmatter delimiter nor a separator; it is ordinary content.
- **MDX-style constructs** (import/export statements, JSX-like component tags): Treated as ordinary content lines; no special syntax recognition. These lines contain non-whitespace and are grouped with adjacent non-separator lines into a single unit.
- **HTML blocks** (e.g. `<div>...</div>`): Treated as ordinary content lines; no special markup recognition. A blank line *inside* an HTML block causes a split (D6 has no "HTML block" exception; only fenced code blocks preserve separators). If HTML tags are on consecutive lines with no separator, they form one unit.
- **Loose lists** (list items separated by blank lines): Each item becomes a separate unit because D6 recognizes blank lines as separators, not markdown semantic grouping. This differs from markdown parsers that group loose list items; D6's separation here is the documented D6-defined outcome.

All constructs are subject to the same foundational D6 rules: exact byte preservation (no line-ending normalization), full SHA-256 content hashing, and deterministic occurrence indexing.

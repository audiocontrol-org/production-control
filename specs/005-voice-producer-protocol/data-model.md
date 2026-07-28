# Phase 1 Data Model: Voice producer protocol + corpus citation support

Subject-agnostic. Reuses spec-004 entities (Source unit, Edition, Coverage ledger, Coverage report) unchanged; adds the model-protocol and citation entities.

## ModelReviseOutput (the model's declared result)

| Field | Type | Notes |
|---|---|---|
| `edition` | string | The full revised markdown BODY; edition units are blank-line-separated (D6). |
| `coverage` | list<ModelCoverageEntry> | EXACTLY ONE entry per source unit, in source document order. |

**Validation** (`parseModelOutput`, fail loud naming the defect): root is a JSON object (accepts a raw object or a ```json fenced block; surrounding prose ignored); `edition` is a non-empty string; `coverage` is an array; each entry validates below.

### ModelCoverageEntry

| Field | Type | Required | Notes |
|---|---|---|---|
| `op` | enum `verbatim`\|`represented`\|`merged`\|`cut` | yes | The closed disposition set (spec 004 D8). |
| `edition_units` | list<int> | conditionally | 0-based indices into the edition's D6 units; REQUIRED (≥1) for non-`cut`; ABSENT for `cut`. |
| `reason` | string (non-empty) | conditionally | REQUIRED for `cut`; ABSENT otherwise. |
| `treatment` | string | no | Optional editorial note; non-normative. |

The provider resolves each index to the edition unit at that position, then to a `{hash, occurrence}` ref, to build the hash-keyed `CoverageEntry` of the spec-004 ledger. `coverage.length` MUST equal the derived source-unit count; every index MUST be in range; else refuse (no partial edition).

## Voice revise prompt

The reviewable instruction the provider builds and sends to the model on stdin. Sections: task; the voice document's trait directives; the deterministic fidelity contract (quotes/citations/numerals survive verbatim into declared destinations; account for every source unit exactly once); the SOURCE as numbered units (each unit's index + exact text, so `coverage` aligns one-entry-per-unit in order); the required `ModelReviseOutput` output format. A test pins that the prompt contains the numbered units, the directives, and the output-format spec.

## Citation marker

| Style | Pattern | Notes |
|---|---|---|
| footnote | `\[\^[^\]\s]+\]` | e.g. `[^1]`, `[^PB-P076]`. |
| source | `\[[A-Z][A-Z0-9]*-[A-Z0-9-]+\]` | e.g. `[PB-P056]`, `[XYZ-12A]`. |

Extracted as citation payload (multiset, byte-exact, document order). Numeral extraction masks BOTH styles before matching, so a marker's digits are never counted as a numeric literal.

## Citation allow-list

The set of citation markers a source permits, for the D13.4 precondition and the edition no-fabrication/allow-list checks:

- declared `citation_allowlist:` markers (existing), UNION
- markers derived from `sources:` frontmatter — each id `PB-P056` → `[PB-P056]`.

When neither is present and the body cites a marker, the precondition refuses (an undeclared citation), unchanged from spec 004.

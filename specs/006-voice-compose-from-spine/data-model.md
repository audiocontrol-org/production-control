# Phase 1 Data Model: Voice compose-from-spine

Entities and validation rules for compose mode. Reuses spec 004/005 source-side entities unchanged; new/extended entities are marked **NEW** / **EXTENDED**.

## Mode (NEW)

The producer operation, chosen at invocation and stamped in provenance.

- **Values**: closed enum `"compose" | "revise"`.
- **Chosen at**: CLI verb (`voice compose` / `voice revise`) → `runProducer(mode, …)`.
- **Recorded in**: the coverage ledger's `mode` field.
- **Validated against** (governed builds): the independently-supplied `requested_mode` in the `ValidateRequest`.
- **Default on read**: absent `mode` in a ledger → `revise` (backward compatibility with pre-006 editions; see R3).

## Spine / Beat (reused, role-only)

- A **Spine** is ordinary source-cited markdown; an input *role*, not a new file format or loader. Passed through the existing `deriveUnits` path.
- A **Beat** is a `SourceUnit` (existing `units/derive.ts`) derived from the spine — carries citation markers, numerals, quoted spans, and (optionally) an open-question marker (R7).
- No schema change to source-unit derivation.

## Edition unit (reused)

- A unit of the composed output body, separated by a blank line in reading order (existing convention); indexed 0-based for the model protocol, hash-keyed (`UnitRef`) in the ledger.

## CoverageEntry (EXTENDED — mode-scoped legality)

Existing shape (`schema/ledger.ts`): `{ source_unit: UnitRef, op: Op, treatment?, edition_units?: UnitRef[], reason? }`, `Op = verbatim | represented | merged | cut`.

Mode-scoped legality (enforced by `policy/op-legality.ts`, NOT by the carrier-independent `loadLedger`):

| op | `revise` | `compose` |
|----|----------|-----------|
| `verbatim` | legal (destination must be byte-exact to source unit) | **illegal** |
| `represented` | legal | legal |
| `merged` | legal (shared-destination rule unchanged) | legal |
| `cut` | legal (requires reason) | **illegal** (v1) |

Additional compose rule (whole-unit no-copy, `policy/op-legality.ts` + `fidelity/check-no-copy.ts`): for a `represented`/`merged` compose entry, no destination edition unit may be normalized-byte-identical to a complete source beat it represents (R4).

## GroundingRecord (NEW — compose only)

One record per edition unit; the reverse-accounting declaration.

- **Fields**: `{ edition_unit: UnitRef, basis: "grounded" | "connective" | "framing", beats?: UnitRef[] }`.
- **Rules**:
  - `basis` is a required closed enum.
  - `beats` is required and non-empty **iff** `basis == "grounded"`; absent otherwise.
  - Structural validation (basis enum, beats-presence-per-basis) happens in `loadLedger`.
  - Edition-side accounting (below) happens in the fidelity validator (needs the derived edition).
- **Model protocol form** (pre-provider): `{ edition_unit: <0-based index>, basis, beats?: [<0-based source-unit indices>] }`; the provider resolves indices → `UnitRef` (R2).

## CoverageLedger (EXTENDED)

Existing: `{ version: 1, source, voice, coverage: CoverageEntry[] }` with additive extensibility (D21).

Added (on the additive seam, validated by an extended `loadLedger`):

- `mode: "compose" | "revise"` — required on write; defaulted to `revise` on read when absent.
- `grounding: GroundingRecord[]` — required-and-non-empty when `mode == compose`; MUST be absent when `mode == revise` (v1; revise reverse-accounting is TASK-51).

## Edition-side grounding accounting (NEW — validator rule)

Enforced by `fidelity/check-edition-grounding.ts` over the derived edition units + the ledger's `grounding` (compose only):

- **Exhaustive**: every derived edition unit has exactly one grounding record.
- **Exclusive**: no edition unit has more than one record; no record names an edition unit that does not exist in the derived edition.
- **Grounded references resolve**: a `grounded` record's `beats` each name a real derived source unit.
- Failure names the specific edition unit / dangling record. Does **not** judge semantic support (reported not-checkable).

## Mode agreement (NEW — validator rule)

Enforced by `fidelity/check-mode-agreement.ts`, sequenced **first** (before op-legality/grounding):

- If `requested_mode` supplied and `!= ledger.mode` → fail (`mode mismatch: requested <x>, ledger <y>`).
- If not supplied → pass; report `mode_comparison: none-supplied`.

## Report additions (EXTENDED — trust boundary, FR-012)

The coverage report gains explicit limit fields, always emitted for a composed edition:

- `mode: compose|revise`
- `mode_comparison: matched | none-supplied` (never silently "ok")
- `spine_source_fidelity: not-checked`
- `composition_semantic_grounding: not-checkable`
- `open_question_markers: enforced | none-declared`

These are **reported facts**, never gate passes on semantic grounding.

## State / lifecycle

- Producer: parse request → build mode prompt → model returns `{edition, coverage, grounding?}` → **preflight** (mode op-legality + grounding + revise-verbatim-byte-exact) → refuse-or-emit → ledger stamped with `mode` (+ `grounding`).
- Validator: mode-agreement → source-hash → ledger-structure → citation-allowlist → unit-accounting (source) → op-obligations (mode-aware) → payload/citations → **edition-grounding** (compose) → **no-copy** (compose) → verdict + limits report.

# Phase 1 Data Model: Voice editions

Entities derived from the spec's Key Entities section and its Functional
Requirements. Everything below is subject-agnostic (Constitution VII) — no field
encodes a subject, a story, or a named voice's real-world identity.

## Voice document

An authored, versioned document of narration-governing traits. A declared input
(`authored` node) referenced by identity in a target's `inputs`; production-control
never interprets its fields (FR-003).

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer literal `1` | yes | Unknown versions refused (FR-003, matches every other versioned schema in this system: `z.literal(1)`). |
| `id` | string | yes | Stable identity, independent of filename. |
| `label` | string | yes | Human-readable short name for the voice. |
| `purpose` | string | yes | What the voice is for / when to use it. |
| `narrator_distance` | string | yes | Free-text directive; not interpreted by production-control. |
| `evidence_posture` | string | yes | Free-text directive. |
| `sentence_movement` | string | yes | Free-text directive. |
| `paragraph_movement` | string | yes | Free-text directive. |
| `transitions` | string | yes | Free-text directive. |
| `emotional_temperature` | string | yes | Free-text directive. |
| `quote_handling` | string | yes | Free-text directive; governs how the producer treats blockquotes when composing (does not change the validator's exact-block obligation, D11/D14). |
| `avoid` | list<string> | yes | Hard avoids — banned constructions/words/moves. Mechanical `avoid`-list conformance checking is explicitly **deferred scope** (design record, "Deferred scope" § avoid-list conformance); v1 carries the field but does not validate against it. |
| *(additional keys)* | any | no | MUST be permitted (schema is additive, D17); production-control and the validator never interpret them — they pass through to the producer's request untouched. |

**Validation rules**:
- Unknown `version` → refused before any other field is read.
- Missing any required-core field → refused, naming the missing field (Constitution "a state without a cause makes an agent guess" — errors name the field, mirroring `formatSchemaIssues` in `src/providers/contract.ts`).
- **No-author-imitation refusal (FR-004, D17)**: a voice MUST be expressed as independently-useful traits and MUST NOT be a named living author's identity. This is a **documented refusal**, not a mechanical name-blocklist check (a blocklist would be both incomplete and would import false precision the design record explicitly rejects for this exact reason elsewhere — thresholds and heuristics are avoided throughout this feature on principle). The schema's own documentation and the package's `voice-document-schema.md` contract state the refusal in words a human author and a reviewer both read before authoring a voice; there is no `isNamedAuthor(string): boolean` in the implementation.

## Source draft

The single source-locked authored document a governed target revises (D5: a
governed target MUST declare exactly one). An ordinary `authored` node; not a new
schema — decomposed into source units by the D6 algorithm at validation/build time,
not stored as a separate persisted entity.

| Field | Type | Notes |
|---|---|---|
| *(identity)* | `Identity` (string) | The manifest's ordinary authored-node identity, referenced in a target's `inputs`. |
| *(path)* | `RelativePathSchema` | The authored node's declared path (existing manifest mechanism, `src/manifest/schema.ts`). |
| *(bytes on disk)* | UTF-8 text | MUST be valid UTF-8; invalid input refuses before any unit is derived (D6.1, FR-008). |

## Source unit

A maximal run of non-separator lines, derived by the D6 algorithm (see
research.md R2 for the full byte-exact rule set). Not a persisted entity on its
own — computed on demand from a source's bytes by both the producer (to enumerate
what must be accounted for) and the validator (to re-derive and compare against
the ledger's declared `source_unit` references).

| Field | Type | Notes |
|---|---|---|
| `content` | bytes | The exact bytes of the unit's lines, original terminators, no normalization (D6.7). |
| `content_hash` | string, `sha256(content)` | Full 64 lowercase hex, never truncated (D6.8, FR-009). |
| `occurrence_index` | integer, 0-based | Index among units of the *same source* sharing `content_hash`, in document order (D6.9, FR-010). |

**Durable identity**: the triple `(source identity, content_hash,
occurrence_index)` (D6.9, FR-010). A content hash alone does not bind a unit to a
particular declared source — two different sources may contain byte-identical
units, and durable identity must keep them distinct (design record Testing
strategy: "Two different sources containing byte-identical units — durable
identity must keep them distinct").

**Validation rules**:
- Reordering byte-identical blocks changes their `occurrence_index` though content
  is unchanged — named as intended (D6.10), not a defect to guard against.
- An independent implementation of D6 over the same source bytes MUST reproduce
  byte-identical unit ids (SC-007) — this is the contract's whole point; there is
  no implementation-defined behavior left in D6's rule set.

## Edition

The impure machine artifact produced by `voice revise`. A single markdown file
carrying the coverage ledger in its YAML frontmatter; the sole declared `output`
of its target (`onlyOutput()`, `src/providers/invoke.ts`).

| Field | Type | Notes |
|---|---|---|
| *(frontmatter)* | YAML block | The coverage ledger (below), stripped before edition-unit derivation (D7) — its own bytes never perturb an edition unit hash. |
| *(body)* | markdown text | The revised narration. Decomposed into **edition units** by the same D6 algorithm applied to the edition file (D7); these are what a ledger entry's `edition_units` reference. |

**Lifecycle rules** (D19, FR-028/FR-029):
- MUST be routed to the dot-zoned `.ai/` root — a sibling of `dist/` directly
  under the episode dir — via `impureOutputRoot()` (`src/zoning/route.ts`). A
  target whose declared output would resolve to a human-safe (dot-free) path is
  refused by the shipped segregation gate, and `pc audit-zones` reports it
  pre-build (Acceptance Scenario US2-3).
- MUST NEVER be hand-edited in place. There is no `resolve-edit` verb and none is
  added by this feature (D19: `review --waive` already refuses on a derived node
  outright — "what resolves its state is a rebuild, not a human decision",
  `src/cli/review.ts:136`).
- Human polish is a **separate companion document**, authored in a human-safe
  area, connected via the existing advisory `follows` edge on an `authored` node
  (`AuthoredDeclSchema.follows`, `src/manifest/schema.ts`) — never a modification
  of the edition itself.
- A produced edition that fails `voice fidelity` is refused and not accepted — no
  partial edition committed (Acceptance Scenario US2-2, D20).

## Coverage ledger

The declared per-source-unit disposition mapping. A self-contained, carrier-
independent YAML document (D10, FR-015) with one loader regardless of where the
YAML string is extracted from (frontmatter today; a sidecar file later — R3).

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer literal `1` | yes | Unknown versions refused. |
| `source.identity` | `Identity` | yes | Which authored source node this ledger was written against. |
| `source.hash` | `sha256:<64 hex>` | yes | MUST match the supplied source draft's current hash — checked **first**, before any unit obligation (FR-017, SC-003, D15 `checks.source_hash`). A mismatch refuses before evaluating any unit. |
| `voice.identity` | `Identity` | yes | Which voice document this edition was produced with. |
| `voice.hash` | `sha256:<64 hex>` | yes | The voice document's hash at production time — feeds freshness (D18, FR-027). |
| `coverage` | list<CoverageEntry> | yes | One entry per accounted-for source unit; see below. |

### CoverageEntry

| Field | Type | Required | Notes |
|---|---|---|---|
| `source_unit` | `{ hash, occurrence }` | yes | References a source unit by `(content_hash, occurrence_index)` — the source identity is fixed by the ledger's own `source.identity`. |
| `op` | enum: `verbatim` \| `represented` \| `merged` \| `cut` | yes | The closed disposition set (D8) — see table below for each op's mechanical obligation. |
| `treatment` | string | no | Optional, explicitly **non-normative** editorial description (e.g. `compressed`) — carries no obligation of its own; never checked by the validator (D8, D9). |
| `edition_units` | list<`{ hash, occurrence }`> | conditionally | REQUIRED (≥1) for `verbatim`/`represented`/`merged`; MUST be absent/empty for `cut`. A **list**, not a single reference, so the mapping expresses 1:1, 1:M, M:1, M:N without a separate `split` op (D9, FR-014). |
| `reason` | string, non-empty/non-whitespace | conditionally | REQUIRED for `cut`; MUST be absent for the other three ops. Mirrors the trimmed-non-empty refinement `WaiverSchema`/`BuildImpureSchema` already use elsewhere in this system, so a declared reason behaves identically across every place this system asks for one. |

### The closed operation set and each op's mechanical obligation (D8)

| `op` | Destinations | Deterministic obligation |
|---|---|---|
| `verbatim` | exactly one | The one destination unit's content bytes equal the source unit's content bytes exactly. |
| `represented` | ≥1 | The source unit's extracted payload survives (unit-local, multiset, D11) across the union of the destinations; **no destination is shared with another source unit's entry**. |
| `merged` | ≥1 | Same payload-survival obligation as `represented`, **plus**: at least one destination is also named by another source unit's entry — this shared-destination condition is what makes `merged` mechanically distinct from `represented` rather than a naming convention (D8). |
| `cut` | none | No destination units; `reason` is non-empty. `cut` means only "accounted for, no destination, reason recorded" — it does NOT assert the unit's text is absent from the edition (FR-013). |

**Structural validity rules** (checked before fidelity is evaluated, D20):
- Every source unit derived from the source draft MUST have **exactly one**
  ledger entry (SC-001) — an entry referencing an unknown source unit, or a
  source unit with zero or with more than one entry, is a structural refusal.
- A `cut` entry carrying a destination, or a `merged` entry with no destination
  shared with another entry, or an empty `reason` on `cut` — each is a structural
  refusal, named specifically (design record Testing strategy: adversarial cases
  "a `cut` with no reason," "a `cut` carrying a destination," "a `merged` with no
  shared destination").

**Additive extensibility (D21, FR-016)**: the schema MUST remain additively
extensible so deferred `function:`/`voice:` fields (blended-voice assignment,
recorded per this design record's "Deferred scope" section) can land later
without a breaking change. v1's loader MUST NOT reject an entry carrying unknown
additional keys — only known, structurally-required keys are validated strictly;
this is the same posture the voice document schema takes toward its own
additional keys (D17), applied to ledger entries.

## Coverage report

The validator's structured, first-class output (D15). Not persisted as a manifest
entity — emitted per validator run as the `ValidateResponse`'s substantive content
(carried in `errors`/a structured payload; see contracts/voice-fidelity-validator.md
for the exact wire shape).

| Field | Type | Notes |
|---|---|---|
| `verdict` | `passed` \| *(absent)* | Top-level. MUST mean "every APPLICABLE deterministic obligation passed" — never semantic equivalence (D15, FR-025). Absent (no verdict) is the required outcome when the validator cannot decide (FR-030, SC-006) — distinct from a `failed` verdict, which is not modeled by this feature's spec as a separate top-level state name beyond "refused" (see contracts doc for exact exit-code/response mapping). |
| `checks` | map<check name, CheckState> | Every check the validator is capable of running is named here, whether or not it actually ran. |

### CheckState

| Field | Type | Notes |
|---|---|---|
| `state` | `passed` \| `not-run` \| `reported` \| `not-checkable` | The four states FR-025 requires. `passed` = obligation checked and satisfied. `not-run` = the check was skippable-by-design and no applicable input was declared (e.g. `lexicon: not-run` when no lexicon input exists, D11). `reported` = a count is surfaced without a pass/fail verdict attached (uncorroborated-unit count, D12 — reporting, never refusing). `not-checkable` = the obligation is real but outside what this validator can ever mechanically decide (`semantic_claim_fidelity`, `voice_conformance` — D4, D16 — always `not-checkable` in v1, by design, not by omission). |
| `reason` | string | Present at least for `not-run`/`not-checkable` states, naming *why* (Constitution: "every reported state MUST name its cause"). |
| *(count fields)* | integer | `total`, `checked`, `count`, etc. as applicable per check — see the D15 example in contracts/coverage-ledger-schema.md and contracts/voice-fidelity-validator.md. |

**Invariant** (SC-004): a `passed` top-level verdict never appears alongside an
unrun *applicable* obligation. An obligation that is inapplicable (no lexicon
declared) is correctly `not-run`, not a violation of this invariant — the
invariant is about *applicable* checks being silently skipped, not about every
possible check having actually executed regardless of its inputs.

## Companion

A separate human-authored document in a human-safe area that `follows` an
edition (D19, FR-028). Not a new schema — reuses the existing `AuthoredDeclSchema`
`follows` field (`src/manifest/schema.ts`), which already models "is a response
to" as distinct from a build dependency (`inputs`, "is built from"), and never
rebuilds or blocks alone.

| Field | Type | Notes |
|---|---|---|
| `path` | `RelativePathSchema` | Where the companion lives — MUST resolve to a human-safe (dot-free) path, since it is human-authored content (existing zoning enforcement, not new to this feature). |
| `follows` | `Identity` | The edition's identity. Advisory only — editing the edition does not require re-authoring the companion, and vice versa; neither is a build input to the other. |

**Relationship to the edition**: the companion is authored content in the human
zone; the edition remains the unmodified machine artifact it was (Acceptance
Scenario US2-4). The edition is never marked `modified` by the companion's
existence or edits (design record Testing strategy, "Lifecycle" case).

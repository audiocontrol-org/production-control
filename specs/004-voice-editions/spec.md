# Feature Specification: Voice editions

**Feature Branch**: `feature/voice` (single long-lived branch; spec dir resolved via the SPECKIT marker)

**Created**: 2026-07-26

**Status**: Draft

**Input**: Operator-approved design record `docs/superpowers/specs/2026-07-25-voice-editions-design.md` (`design-approved: yes`). Produce voice-varied editions of a source-locked draft: an explicit voice drives an impure revision provider that may change narration only, gated by a deterministic fidelity validator and a declared per-unit coverage ledger. Same impure-producer → declarative-metadata → deterministic-corroboration → structured-coverage-report shape as the quote bank, applied to derived prose.

## Clarifications

### Session 2026-07-26

- Q: Source-unit granularity — separator-line vs sentence-level? → A: Separator-line units (design D6 default); maximal runs of non-separator lines, byte-reproducible ids, ~57–84 units/chapter. No sentence-level split in v1.
- Q: Should the gate refuse a weak edition on uncorroborated-unit count, or only report it? → A: Report-only, no threshold (D12); the uncorroborated count is first-class in the coverage report but never causes refusal. No project-set threshold in v1.
- Q: Lexicon provenance and v1 schema? → A: Optional hand-authored declared-lexicon input, literal terms, byte-exact case-sensitive matching, no Unicode normalization (D11); absent lexicon → entity survival reports `not-run`. Deriving from quote-bank/spine is deferred (couples to asset-bank).
- Q: Ledger carrier at ~480 entries/edition — frontmatter or block on directory-outputs? → A: Frontmatter for v1 with a carrier-independent schema (one loader), so a later sidecar move is a carrier swap not a redesign (D10). `design:feature/directory-outputs` stays a non-blocker.
- Q (deferred, fixture-coverage): markdown constructs beyond the current corpus (setext headings, MDX, HTML blocks, list items with blank lines) → A: Not resolved here; D6 handles fenced code + separator lines; golden fixtures should cover the others as they arise. Revisit at planning/test-design.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prove an existing edition is faithful to its source (Priority: P1)

An operator has an edition of a source-locked draft — produced by any means (an external skill, another model, a human editor) — plus a declared per-unit coverage ledger. They run the deterministic fidelity validator and learn, with no reliance on the producer's honesty, whether every source unit is accounted for, every quoted span survives verbatim, every citation is preserved, no source-backed claim was silently dropped, and the ledger was written against the supplied source version. The validator emits a structured coverage report that names every check it ran AND every check it could not run.

**Why this priority**: The validator ships first (design D3): an edition becomes checkable the moment it exists, independent of who or what produced it. This is the load-bearing guarantee and the smallest independently-valuable slice — it delivers trust in an artifact even before a governed producer exists.

**Independent Test**: Point the validator at a fixture edition + ledger + source and confirm: a faithful edition passes with a coverage report enumerating the applicable checks; a tampered edition (a mutated quoted span, a dropped citation, a missing unit disposition, a hash written against the wrong source version) is refused, naming the specific failing obligation; a valid-but-thinly-corroborated edition passes while the report shows a high uncorroborated-unit count.

**Acceptance Scenarios**:

1. **Given** an edition whose ledger accounts for every source unit with a satisfied deterministic obligation, **When** `voice fidelity` runs, **Then** the verdict is `passed` and the coverage report lists each check's state (passed / not-run / not-checkable) with counts.
2. **Given** an edition where one source unit has no ledger disposition, **When** the validator runs, **Then** it refuses, naming the unaccounted source unit (unit-accounting failure), and emits no `passed` verdict.
3. **Given** a `verbatim` disposition whose destination unit's bytes differ from the source unit's, **When** the validator runs, **Then** it fails that obligation, naming the unit.
4. **Given** a source unit citing a marker the edition omits under a non-`cut` disposition, **When** the validator runs, **Then** it fails citation preservation, naming the marker.
5. **Given** an edition ledger whose `source.hash` does not match the supplied source draft's hash, **When** the validator runs, **Then** it refuses before evaluating any unit obligation (wrong source version).
6. **Given** a validator that cannot decide an obligation, **When** it runs, **Then** it exits non-zero and emits NO verdict — distinct from `failed`, never a false clean.

---

### User Story 2 - Produce a voice edition of a source-locked draft (Priority: P2)

An operator declares a governed target with exactly one source draft and one voice input, and builds it. An impure revision provider produces an edition that changes narration only, declaring itself impure and emitting the per-unit coverage ledger in the edition's frontmatter. The edition is routed as a machine artifact to the dot-zoned `.ai/` root (never a human-safe path), and the fidelity validator gates the result before it is accepted.

**Why this priority**: The producer is the generative half. It depends on US1 (the validator must exist to gate it) and on the shipped content-zone-segregation boundary (an edition is impure AI prose and must never land in a human's working area).

**Independent Test**: Build a fixture target (source draft + voice) with a stubbed model; confirm the provider declares itself impure, emits a schema-valid ledger, the edition lands under `.ai/`, and the build refuses to accept an edition the fidelity validator rejects.

**Acceptance Scenarios**:

1. **Given** a target declaring exactly one source draft and one voice, **When** it is built, **Then** the provider declares `impure: {reason}`, emits the coverage ledger in frontmatter, and the edition artifact is routed under the dot-zoned `.ai/` root (a sibling of `dist/`).
2. **Given** a produced edition that fails the fidelity validator, **When** the build runs, **Then** the edition is refused and not accepted (no partial edition committed).
3. **Given** a target whose declared output would resolve to a human-safe (dot-free) path, **When** it is built, **Then** the shipped segregation gate refuses it, and `pc audit-zones` reports it pre-build.
4. **Given** an operator who wants to hand-work the prose, **When** they author a separate companion document in a human-safe area with a `follows` edge to the edition, **Then** the companion is accepted as authored content and the edition remains an unmodified machine artifact.

---

### User Story 3 - Voice as a declared input, with honest freshness (Priority: P3)

An operator treats a voice as a first-class declared input (an ordinary authored node referenced by a target's `inputs`). When the voice document changes, editions built from the older voice are reported stale (a voice materially determines the output). When only the producer's model version changes, that is reported as producer drift, never an automatic restale — regeneration stays a deliberate human act.

**Why this priority**: Freshness and voice-as-input make editions governable over time. It builds on US1/US2 and reuses existing manifest and drift mechanisms, so it is additive rather than foundational.

**Independent Test**: Change a voice document and confirm dependent editions report stale; change only the recorded model version and confirm the edition reports drift (not stale); confirm neither triggers an automatic rebuild.

**Acceptance Scenarios**:

1. **Given** an edition built from voice version A, **When** the voice document is edited to version B, **Then** the edition is reported stale (restale reports; it does not rebuild).
2. **Given** an edition whose producer model version changed, **When** state is assessed, **Then** it is reported as drift, distinct from stale, and no automatic restale occurs.

### Edge Cases

- A source unit the producer cannot account for fails the run with NO partial edition emitted (D20).
- An unreadable or non-UTF-8 source fails before any unit is processed (D6.1, D20).
- A structurally invalid ledger (unknown unit, duplicate disposition, `cut` carrying a destination, `merged` with no shared destination, empty `reason`) is refused BEFORE fidelity is evaluated (D20).
- An interruption mid-build leaves the previously accepted edition untouched via the existing stage-then-rename (D20).
- A `represented`/`merged` entry whose source unit yields no extractable payload passes but is recorded as `uncorroborated` with a first-class count — never silently passed (D12).
- A source whose own citations fall outside its frontmatter allow-list is invalid and refused before edition validation begins (D13.4).
- A voice edition is prose with no quote bank declared as input: quoted-span checks use exact-block preservation (D11), NOT quote-bank identity semantics (which apply only when a quote bank is a declared input — D14).
- Reordering byte-identical source blocks changes their `occurrence_index` though content is unchanged — named as intended (D6.10).

## Requirements *(mandatory)*

### Functional Requirements

**Voice as input and naming**
- **FR-001**: A voice MUST be a first-class DECLARED input — an ordinary `authored` node referenced by identity in a target's `inputs` — requiring no production-control core change (D1).
- **FR-002**: The capability MUST call this input a `voice`, never a `profile` (`profile` already means build recipe here) (D2).
- **FR-003**: A voice document MUST be versioned (`version: 1` literal; unknown versions refused) with a required core (`id`, `label`, `purpose`, `narrator_distance`, `evidence_posture`, `sentence_movement`, `paragraph_movement`, `transitions`, `emotional_temperature`, `quote_handling`, `avoid`) and MUST permit additional keys. production-control MUST NOT interpret these fields; they are directives passed to the producer (D17).
- **FR-004**: A voice MUST be expressed as independently-useful traits and MUST NOT be a named living author's identity; this is enforced as a documented REFUSAL, not a fake mechanical check (D17).

**Package shape and entry points**
- **FR-005**: The capability MUST be a separate reusable package with two entry points — `voice revise` (impure provider; declares `impure: {reason}`; reports NO validation verdict of its own) and `voice fidelity` (deterministic validator) — and MUST NOT be built into production-control's core (D3).
- **FR-006**: The validator MUST be independently usable so that an edition produced by ANY means becomes checkable the moment it exists (validator-first) (D3).

**v1 scope**
- **FR-007**: A governed target MUST declare EXACTLY ONE source draft; targets without a source draft are out of scope for v1 (D5).

**Source-unit derivation (normative, byte-exact)**
- **FR-008**: Source units MUST be derived by the normative algorithm (read as UTF-8, refuse invalid input before any unit; strip only a leading `---…---` frontmatter block; do NOT normalize line endings; a separator line is spaces/tabs only after optional trailing CR; units are maximal runs of non-separator lines in document order; a separator inside a fenced code block does not separate; unit content is exact bytes with original terminators, no normalization) (D6).
- **FR-009**: `content_hash` MUST be `sha256(content)` recorded in full 64 hex, not truncated (D6.8).
- **FR-010**: Durable unit identity MUST be the triple `(source identity, content_hash, occurrence_index)`, where `occurrence_index` is the 0-based index among units of that source sharing a content hash in document order (D6.9).
- **FR-011**: Edition units MUST be derived by the same algorithm applied to the edition file; because frontmatter (where the ledger lives) is stripped first, the ledger's own bytes MUST NOT perturb any edition unit hash (D7).

**Disposition ledger**
- **FR-012**: The ledger MUST use the closed disposition set, each with a mechanically distinct obligation: `verbatim` (exactly one destination unit whose bytes equal the source unit's); `represented` (≥1 destinations; payload survives across their union; no destination shared with another source unit); `merged` (≥1 destinations; payload survives across their union; at least one destination also named by another source unit's entry); `cut` (no destinations; a non-empty `reason`) (D8).
- **FR-013**: `cut` MUST mean only "accounted for, no destination, reason recorded" — it MUST NOT assert the unit's text is absent (D8).
- **FR-014**: `edition_units` MUST be a LIST (N:M mapping), expressing 1:1, 1:M, M:1, M:N without a separate `split` operation; editorial description MAY be carried as optional non-normative metadata (e.g. `treatment: compressed`) (D8, D9).
- **FR-015**: The ledger schema MUST be carrier-independent (a self-contained YAML document with one loader); v1's carrier is the edition's YAML frontmatter, chosen because exactly-one-output-per-target is a deliberate, unrelaxed constraint. A later move to a sidecar MUST be a carrier swap, not a redesign (D10).
- **FR-016**: The ledger schema MUST be additively extensible so deferred `function:` / `voice:` fields (blended voices) can land later without a breaking change (D21).

**Deterministic fidelity obligations**
- **FR-017**: The validator MUST prove that every source unit has exactly one declared disposition, that the ledger was written against the supplied source version, and that each disposition satisfies its applicable deterministic obligations — and MUST NOT prove semantic equivalence, editorial wisdom, or voice conformance (D4).
- **FR-018**: The validator MUST CORROBORATE the producer's declared mappings and MUST NEVER infer them (D22).
- **FR-019**: Payload MUST be extracted and checked PER SOURCE UNIT (unit-local), matched within the union of that entry's declared destinations — never globally (D11).
- **FR-020**: Always-extracted payload MUST be numeric literals, citation markers, and verbatim quoted spans (blockquote lines within the unit); plus declared-lexicon terms when a lexicon input exists. When no lexicon is declared, the validator MUST pass and REPORT that entity survival was not checked (no capitalized-token heuristic) (D11).
- **FR-021**: Payload matching MUST be byte-exact and case-sensitive with multiset semantics — each source occurrence discharged by a distinct destination occurrence (D11).
- **FR-022**: An entry whose source unit yields no extractable payload MUST pass but be recorded as `uncorroborated` with a first-class count in the coverage report — never silently passed (D12).
- **FR-023**: Citation semantics MUST be unit-local with multiset multiplicity: every citation occurrence in a non-`cut` source unit MUST appear in that entry's destinations with multiplicity; the edition MUST contain no citation absent from the source (no fabrication); every marker MUST resolve within the frontmatter allow-list; a source whose own citations fall outside its allow-list MUST be refused before edition validation begins. Document-level set equality MUST NOT be required (a `cut` unit's citations legitimately disappear) (D13).
- **FR-024**: Quote-bank identity/transformation semantics MUST apply ONLY when a quote bank is an actual declared input of the target; otherwise the obligation MUST be the simpler exact-block preservation (D14).

**Coverage report and honest scope**
- **FR-025**: The validator MUST emit a structured coverage report as a first-class output that names every check with a state (`passed` / `not-run` / `reported` / `not-checkable`) and relevant counts; a top-level `passed` MUST mean every APPLICABLE deterministic obligation passed — never semantic equivalence (D15).
- **FR-026**: Voice conformance MUST NOT be validated in v1, and this limitation MUST be stated plainly in the capability's own documentation (D16).

**Freshness**
- **FR-027**: A voice edit MUST restale dependent editions (report only; rebuild stays the operator's call); a producer model-version change MUST be reported as drift and MUST NOT auto-restale (D18).

**Segregation (backed by shipped content-zone-segregation)**
- **FR-028**: An edition MUST be treated as a machine artifact throughout its life, written to the dot-zoned `.ai/` root (a sibling of `dist/` under the episode dir), and MUST NEVER be hand-edited in place. Human polish MUST be a SEPARATE companion document authored in a human-safe area, modeled by the manifest's existing `follows` advisory edge (D19).
- **FR-029**: The capability MUST rely on the shipped segregation enforcement (impure output confined to `.ai/`; an authored node declared under a dot-zone refused; `pc audit-zones` reporting routing violations pre-build) rather than a new adoption verb (D19).

**Failure levels**
- **FR-030**: Failure behavior MUST mirror quote-bank: a source unit the producer cannot account for fails the run with NO partial edition; an unreadable/non-UTF-8 source fails before any unit; a structurally invalid ledger is refused before fidelity is evaluated; an interruption leaves the prior accepted edition untouched via stage-then-rename; a validator that cannot decide exits non-zero with NO verdict (D20).

### Key Entities *(include if feature involves data)*

- **Voice**: an authored, versioned document of narration-governing traits (distance, evidence posture, movement, transitions, temperature, quote handling, avoids); a declared input, never interpreted by production-control.
- **Source draft**: the single source-locked authored document a governed target revises; decomposed into source units.
- **Source unit**: a maximal run of non-separator lines; identity is `(source identity, content_hash, occurrence_index)`.
- **Edition**: the impure machine artifact produced by `voice revise`; a revised-narration document carrying its coverage ledger in frontmatter; routed under `.ai/`.
- **Coverage ledger**: the declared per-source-unit disposition mapping (`verbatim`/`represented`/`merged`/`cut` → destination units), carrier-independent, embedded in the edition frontmatter for v1.
- **Coverage report**: the validator's structured first-class output enumerating every check's state and counts, including uncorroborated-unit count and not-checkable checks.
- **Companion**: a separate human-authored document in a human-safe area that `follows` an edition; where human polish lives (the edition itself is never modified).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of source units in a passing edition carry exactly one declared disposition; an edition with any unaccounted unit is refused in 100% of cases.
- **SC-002**: Every quoted span, citation, and numeric literal present in a non-`cut` source unit survives (multiset) into that entry's destinations for a passing edition; a single tampered span, dropped citation, or altered literal is caught in 100% of cases.
- **SC-003**: An edition whose ledger hash does not match the supplied source version is refused before any unit obligation is evaluated, 100% of the time.
- **SC-004**: Every validator run emits a coverage report naming every applicable check and every check it did NOT run (not-run / not-checkable); a `passed` verdict never appears alongside an unrun applicable obligation.
- **SC-005**: An impure edition is confined to a dot-zoned location in 100% of builds; an edition whose resolved output is human-safe is refused, and the routing audit reports it pre-build.
- **SC-006**: A validator that cannot decide an obligation exits non-zero and emits no verdict in 100% of such cases (never a false clean).
- **SC-007**: An independent implementation of the source-unit algorithm reproduces byte-identical unit ids for the same source (the algorithm is fully specified).

## Assumptions

- Content-zone-segregation is SHIPPED (merged 2026-07-26, PR #7) and its enforcement (impure→`.ai/`, authored-in-dot-zone refusal, `pc audit-zones`) is available; this feature relies on it and adds no adoption verb (satisfies D19).
- `design:feature/directory-outputs` is deliberately NOT a blocker; v1 carries the ledger in frontmatter (D10), accepting the reading-copy weight until directory outputs land.
- The existing manifest mechanisms (`authored` nodes, `inputs`, the `follows` advisory edge, impurity declaration, stage-then-rename, drift/restale) are reused; no core change is required for v1 (D1, D19).

### Clarification outcomes

Resolved in the 2026-07-26 clarification session (see Clarifications), all confirming the design defaults the requirements already encode:

- **Unit granularity** — RESOLVED: separator-line units (D6); no sentence-level split in v1. (FR-008)
- **Minimum-corroboration policy** — RESOLVED: report-only, no threshold (D12); no project-set refusal threshold in v1. (FR-022)
- **Lexicon provenance/schema** — RESOLVED: optional hand-authored, literal terms, byte-exact case-sensitive, no Unicode normalization; deriving from quote-bank/spine deferred. (FR-020)
- **Ledger carrier** — RESOLVED: frontmatter for v1, carrier-independent schema; `design:feature/directory-outputs` stays a non-blocker. (FR-015)
- **Markdown constructs beyond the current corpus** — DEFERRED to planning/test-design: D6 handles fenced code + separator lines; golden fixtures should cover setext headings, MDX, HTML blocks, and list items with blank lines as they arise.

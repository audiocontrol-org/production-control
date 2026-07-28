# Feature Specification: Voice producer protocol + corpus citation support

**Feature Branch**: `feature/voice` (single long-lived branch; spec dir resolved via the SPECKIT marker)

**Created**: 2026-07-27

**Status**: Draft

**Input**: Approved design record `docs/superpowers/specs/2026-07-27-voice-producer-protocol-design.md` (`design-approved: yes`). Originates from backlog **TASK-29** (`voice-revise-model-no-prompt`), promoted to `roadmap:design:feature/voice-producer-protocol`. Formalizes the real `voice revise` producer that voice-editions v1 (spec 004) shipped as a stub, plus the citation-extraction extension real source-cited corpora need. Already implemented and validated on `spike/nouvelle-france-voice-lab` (a live lab ran 8 catalog voices over the Nouvelle-France epilogue, all fidelity-passed).

## Clarifications

### Session 2026-07-27 (resolved in the design record)

- Q: How does a model produce a hash-keyed coverage ledger when it cannot compute sha256? → A: It does not. The model declares an INDEX-BASED mapping (op + edition-unit indices per source unit); the provider derives units and mechanically builds the hash-keyed ledger. (Rejected: model emits the ledger directly — infeasible; model emits prose and the provider infers the mapping — violates corroborate-not-infer D22.)
- Q: How is the model chosen? → A: Operator-supplied via the `VOICE_REVISE_MODEL` environment variable; the provider fails loud when it is unset. No baked-in default model, no fallback.
- Q: How are the ebook's `[PB-###]` citations handled when the validator only knew `[^1]` footnotes? → A: Extend the extractor to recognize both marker styles and derive the allow-list from the source's `sources:` frontmatter when no explicit `citation_allowlist` exists (FR-020 permits evolving the citation representation).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Produce a fidelity-passing voice edition with a real model (Priority: P1)

An operator declares a governed target (one source draft + one voice), configures a real model command, and builds it. The `voice revise` provider prompts the model with the source (as numbered units), the voice's trait directives, and the deterministic fidelity contract; the model returns a revised edition plus an index-based coverage mapping; the provider mechanically builds the hash-keyed ledger and emits the edition; and the independent `voice fidelity` validator accepts a faithful result.

**Why this priority**: This is the generative half voice-editions v1 stubbed. Without it, the capability only works against a fixture; with it, real editions of real drafts become producible and checkable.

**Independent Test**: With `VOICE_REVISE_MODEL` set to a deterministic model command over a fixture source + voice, build the target; confirm the provider declares impure, the model's index mapping is resolved into a schema-valid frontmatter ledger, the edition is routed under `.ai/`, and `voice fidelity` passes it. Confirm that an unset `VOICE_REVISE_MODEL` refuses the build, naming the missing configuration.

**Acceptance Scenarios**:

1. **Given** a target with one source + one voice and `VOICE_REVISE_MODEL` set, **When** it is built, **Then** the provider prompts the model, resolves the returned index mapping into a hash-keyed `CoverageLedger` accounting for every source unit exactly once, emits the impure edition under `.ai/`, and `voice fidelity` accepts a faithful result.
2. **Given** `VOICE_REVISE_MODEL` is unset, **When** a build runs, **Then** the provider refuses, naming the missing environment variable — no default model, no fabricated output.
3. **Given** the model returns a coverage array whose length differs from the source unit count, or an `edition_units` index out of range, **When** the provider processes it, **Then** the build refuses, naming the mismatch — no partial edition is emitted.
4. **Given** a produced edition, **When** `voice fidelity` runs, **Then** the provider itself reported NO validation verdict; acceptance is the validator's decision alone.

---

### User Story 2 - Validate citations on a real source-cited corpus (Priority: P2)

An operator runs `voice fidelity` over editions of a corpus that cites primary sources as `[PB-###]` markers and declares its allowed sources in `sources:` frontmatter. The validator recognizes those markers, checks their survival and no-fabrication, and treats the `sources:` list as the citation allow-list — so citation fidelity is actually exercised, not silently skipped.

**Why this priority**: Citations are the most central payload class of source-cited nonfiction. v1 recognized only `[^1]` footnotes and only a `citation_allowlist:` key, so real corpora went unchecked — a silent under-check of the exact guarantee the validator exists to make.

**Independent Test**: Point the validator at a fixture source citing `[PB-P056]` with frontmatter `sources: [PB-P056]` and an edition preserving it; confirm the `citations` check runs (checked ≥ 1, not `not-run`), the allow-list precondition passes, an edition dropping the marker is refused, and an edition inventing `[PB-P099]` is refused.

**Acceptance Scenarios**:

1. **Given** a source body citing `[PB-P056]` and frontmatter `sources: [PB-P056]`, **When** the validator runs, **Then** the source citation allow-list precondition passes and the `citations` check reports a positive `checked` count (not `not-run`).
2. **Given** a unit whose text contains both `[PB-P056]` and a numeral like `1879`, **When** payload is extracted, **Then** `[PB-P056]` is counted once as a citation and `1879` once as a numeral — the marker's digits are NOT double-counted as a numeral.
3. **Given** an edition that drops a source `[PB-###]` citation from its declared destination, **When** the validator runs, **Then** it is refused, naming the citation-preservation failure.
4. **Given** an edition citing a `[PB-###]` marker absent from the source and its allow-list, **When** the validator runs, **Then** it is refused for fabrication / allow-list resolution.

### Edge Cases

- The model returns malformed output (not JSON, missing `edition`/`coverage`, an op outside the closed set, a `cut` carrying destinations or lacking a reason, a non-`cut` lacking destinations): the provider refuses, naming the defect, before any edition is written.
- The model's declared edition body, when re-derived by the D6 algorithm, must yield the edition units the indices reference; because unit derivation strips leading frontmatter (FR-011 of spec 004), prepending the built ledger frontmatter does not perturb the body's units.
- A source declares BOTH `citation_allowlist` and `sources`: the allow-list is the union of both forms.
- A source declares neither and its body cites a marker: the allow-list precondition refuses (an undeclared citation), as before.

## Requirements *(mandatory)*

### Functional Requirements

**Producer protocol**
- **FR-001**: The `voice revise` producer MUST prompt the model with a reviewable prompt containing: the source draft presented as NUMBERED source units (derived by the D6 algorithm), the voice document's trait directives, the deterministic fidelity contract stated plainly (every quoted span, citation marker, and numeral in a source unit MUST survive verbatim into that unit's declared destinations; every source unit MUST be accounted for exactly once), and the required output format.
- **FR-002**: The model's output contract MUST be `{ edition: <full revised markdown body, edition units blank-line-separated>, coverage: [ <one entry per source unit, in document order>: { op ∈ {verbatim, represented, merged, cut}, edition_units?: <0-based indices into the edition's derived units>, reason?: <non-empty, for cut> } ] }`. The provider MUST parse this robustly (accept a raw JSON object or a fenced JSON block; ignore surrounding prose) and refuse, naming the defect, on any malformed shape.
- **FR-003**: The provider MUST derive source units and edition units via the D6 algorithm, and MUST mechanically build the hash-keyed `CoverageLedger` by resolving each declared `edition_units` index to a `{hash, occurrence}` reference. The provider — never the model — computes the hashes.
- **FR-004**: The provider MUST validate the declared mapping BEFORE emitting: `coverage.length` MUST equal the source-unit count, and every declared index MUST be in range. A mismatch is a loud refusal with NO partial edition emitted.
- **FR-005**: The model command MUST be read from the required `VOICE_REVISE_MODEL` environment variable; when it is unset the provider MUST fail loud, naming the missing configuration. There MUST be NO baked-in default model and NO fallback output (Constitution V).
- **FR-006**: The producer MUST declare itself impure (`impure: {reason}`) and MUST report NO validation verdict of its own; gating remains the independent `voice fidelity` validator's responsibility (spec 004 D3).
- **FR-007**: The built edition MUST carry the coverage ledger under a top-level `ledger:` frontmatter key (the carrier `voice fidelity`'s extractor expects), followed by the model's revised body.

**Corpus citation support**
- **FR-008**: The citation extractor MUST recognize BOTH footnote `[^label]` markers AND `[PB-###]`-style source markers (an uppercase-initial alpha prefix, a hyphen, an alphanumeric/hyphen tail), preserving multiset multiplicity and document order, byte-exact.
- **FR-009**: Numeral extraction MUST mask citation-marker spans (of both styles) before extracting numerals, so a marker's embedded digits are never double-counted as a numeric literal. The masking set MUST stay in sync with the citation set (one source of truth).
- **FR-010**: When a source declares no `citation_allowlist`, the citation allow-list MUST be derived from its `sources:` frontmatter (each id `PB-P056` → the marker `[PB-P056]`); when both are present the allow-list MUST be their union. This applies to BOTH the source-side allow-list precondition and the edition-side no-fabrication / allow-list checks.
- **FR-011**: These citation changes MUST NOT regress the existing footnote `[^label]` / `citation_allowlist` behavior.

### Non-Functional / Constraints
- **FR-012**: No production-control core change; the producer + citation logic live in the `voice-tooling` craft package (Constitution IV). No `any`/`as`/`@ts-ignore`; no fallbacks outside test code; files ≤500 lines.

## Success Criteria *(mandatory)*

- **SC-001**: With a real model command configured, a governed target builds an edition whose model-declared mapping is resolved into a schema-valid, fully-accounted hash-keyed ledger in 100% of well-formed model responses; a malformed response or an out-of-range/incomplete mapping refuses with no partial edition in 100% of cases.
- **SC-002**: An unset `VOICE_REVISE_MODEL` refuses the build naming the missing configuration in 100% of cases (no default model, no fabricated output).
- **SC-003**: On a corpus citing `[PB-###]` markers with `sources:` frontmatter, the `citations` check runs (positive `checked`, never silently `not-run`); a dropped or fabricated `[PB-###]` citation is caught in 100% of cases; a citation marker's digits are never counted as a numeral.
- **SC-004**: The full `voice-tooling` test suite and the production-control integration suite remain green; the existing `[^1]`/`citation_allowlist` path is unregressed.
- **SC-005**: The end-to-end producer path is demonstrated against a real model over real prose (evidence: the 8-voice epilogue lab, all fidelity-passed).

## Assumptions

- Spec 004 (voice-editions) is implemented: the deterministic `voice fidelity` validator, the coverage-ledger schema + loader, the D6 source-unit derivation, and `.ai/` zoning are available and reused unchanged.
- A real model CLI (e.g. `claude -p`) is available to the operator as `VOICE_REVISE_MODEL`; the producer is model-agnostic (capability, not vendor).
- The implementation already exists on `spike/nouvelle-france-voice-lab` (`729c110`, `06e48ca`); this spec formalizes it, and execution primarily ADOPTS and hardens that code against these requirements rather than building from scratch.

## Deferred — explicit scope boundaries (captured, NOT silently cut)

These are known-necessary follow-ons, recorded here so they are visible boundaries rather than omissions. Each is a tracked backlog item and out of scope for THIS increment:

- **Model identity in provenance** (TASK-31 / TASK-40): `tool.version` records only the package version, so a model swap behind a fixed `VOICE_REVISE_MODEL` is invisible to producer-drift. Resolving/recording a real model identity is deferred.
- **Silent model-stdout truncation** (TASK-30): the output cap currently returns a truncated prefix as success; converting it to a loud refusal naming the limit is deferred.
- **`target` → output-filename safety** (TASK-39): sanitizing/validating the wire `target` before it reaches the output path is deferred.
- **Quote-bank D14 dialect**: still coupled to the deferred asset-bank; the exact-block quote dialect remains the only one exercised.

## Key Entities *(include if feature involves data)*

- **Model revise output**: the model's declared result — `{ edition: markdown body, coverage: per-source-unit { op, edition_units (indices) | reason } }`. A declaration the provider corroborates and mechanizes; the model never computes hashes.
- **Voice revise prompt**: the reviewable instruction the provider builds (numbered source units + voice directives + fidelity contract + output format). A first-class, testable artifact.
- **Citation marker**: a footnote `[^label]` OR a source `[PB-###]` marker; extracted as citation payload; its digits masked from numeral extraction.
- **Citation allow-list**: the set of citation markers a source permits — declared `citation_allowlist` ∪ markers derived from `sources:` frontmatter.

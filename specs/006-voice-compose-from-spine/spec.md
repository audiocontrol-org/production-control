# Feature Specification: Voice compose-from-spine (compose mode)

**Feature Branch**: `feature/voice` (single long-lived branch; spec dir resolved via the SPECKIT marker)

**Created**: 2026-07-29

**Status**: Draft

**Input**: Approved design record `docs/superpowers/specs/2026-07-28-voice-compose-from-spine-design.md` (`design-approved: yes`). Originates from roadmap item `design:feature/voice-compose-from-spine`, which graduated from the spike prototype (`spike/nouvelle-france-voice-lab`, commit `896c132`; env-gated `VOICE_REVISE_MODE=compose`, Ep1 fidelity-passed with 10 numerals + 3 citations byte-exact). Folds in **TASK-50** (revise verbatim-drift); spawns **TASK-51** (revise-edition-side-accounting follow-up). Depends on spec 005 (voice-producer-protocol), whose producer + fidelity machinery is reused unchanged on the source side.

## Clarifications

### Session 2026-07-28 (resolved in the design record + third-party design review)

- Q: How is the compose-vs-revise operation selected? → A: An operator invocation choice exposed as two named CLI verbs (`voice compose`, `voice revise`) over a shared core. NOT a production-control root-schema field and NOT inferred from input type (a spine and a draft are the same kind of markdown). For a governed build the operation is fixed by the provider recipe. (Rejected: root-schema `mode` field; provider-args as sole interface; type-inference.)
- Q: The reused fidelity machinery accounts *source* units — is that enough for composition? → A: No. It is source-directed (verified: `check-unit-accounting.ts` accounts source units only), so an undeclared invented paragraph passes. Compose adds **edition-side grounding accounting**: every edition unit declares exactly one origin, and the validator proves every edition unit is declared exactly once. This prevents *silent* invention; it does not prove semantic support.
- Q: What is compose's op-legality? → A: v1 forbids both `verbatim` and `cut`; every beat is `represented` or `merged`. Additionally, no destination edition unit may be byte-identical to a complete source beat it represents ("whole-unit no-copy" — forbidding the `verbatim` label alone is insufficient).
- Q: How is the artifact prevented from self-selecting its validation rules? → A: The ledger stamps the mode it ran under; a governed build supplies the requested mode independently and the validator refuses on `requested != ledger` mismatch. Standalone `voice fidelity` validates per the ledger mode and reports that no independent comparison was available.
- Q: Is open-question preservation mechanical? → A: Only if the spine uses a declared open-question marker syntax (its bytes must then survive byte-exact). Absent a syntax, it is a producer prompt instruction, not a deterministic gate.
- Q: What does the deterministic gate NOT prove? → A: semantic support of composed prose, invented facts, promotional-as-fact, causality, a semantically papered-over open question, and the spine's own upstream citation correctness. These are reported as producer-instruction or advisory / not-checkable — never claimed as deterministic failures.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compose a fidelity-passing chapter from a spine (Priority: P1)

An operator has a source-cited spine (structured beats of markdown) and a voice document. They run `voice compose <spine> <voice>`. The provider prompts the model to expand each beat into flowing narrative in the voice, carrying every asserted fact and preserving every citation and numeral; the model returns the composed edition plus a per-source-beat coverage mapping and a per-edition-unit grounding declaration; the provider mechanically builds the ledger (stamped `mode: compose`) and emits the edition under a dot-zoned path; the independent `voice fidelity` validator accepts a faithful result.

**Why this priority**: This is the core new capability — the generative half that turns a curated spine into publishable chapter prose while every piece of evidence survives byte-exact. Without it there is no compose mode.

**Independent Test**: With a deterministic model command over a small fixture spine + voice, run `voice compose`; confirm the provider declares impure, the model's index mapping + grounding resolve into a schema-valid ledger stamped `mode: compose`, the edition routes under `.ai/`, every citation/numeral survives byte-exact into its represented destination, and `voice fidelity` passes it.

**Acceptance Scenarios**:

1. **Given** a fixture spine with beats carrying citations + numerals and a voice document, **When** `voice compose` runs with a deterministic model that faithfully expands and declares grounding, **Then** the edition is emitted, the ledger records `mode: compose` with a grounding record per edition unit, and `voice fidelity` passes.
2. **Given** the same inputs, **When** the model expands a beat, **Then** every citation marker and numeral in that beat appears byte-exact in the beat's represented destination unit(s).
3. **Given** a composed edition, **When** it is validated, **Then** the fidelity report states `spine_source_fidelity: not-checked` and `composition_semantic_grounding: not-checkable`.

### User Story 2 - Undeclared invented prose is refused (Priority: P1)

Because composition deliberately generates new prose, the system must guarantee that no edition unit exists without a declared origin. Every edition unit declares exactly one grounding basis (`grounded:[beats]`, `connective`, or `framing`); the deterministic validator proves the declaration set is exhaustive and exclusive over the edition units.

**Why this priority**: This is the trust backstop that distinguishes compose from a mere second prompt. Source-side accounting alone cannot catch an added, unsupported paragraph; edition-side grounding can (it stops *silent* invention). Without it, "invent nothing" is unenforceable.

**Independent Test**: Feed the validator a composed edition whose ledger omits a grounding record for one edition unit (a silently invented paragraph); confirm it is refused, naming the unaccounted edition unit. Feed a grounding record naming a nonexistent edition unit; confirm it is refused.

**Acceptance Scenarios**:

1. **Given** a composed edition with an edition unit that has no grounding record, **When** validated, **Then** the gate fails naming the unaccounted edition unit.
2. **Given** a grounding record referencing an edition-unit index that does not exist, **When** validated, **Then** the gate fails naming the dangling record.
3. **Given** a composed edition where every edition unit has exactly one grounding record, **When** validated, **Then** edition-side accounting passes (independent of whether the prose is semantically supported — which is reported not-checkable).

### User Story 3 - Compose never copies (Priority: P2)

Compose expands beats; it must never reproduce a beat verbatim. The op-legality check forbids the `verbatim` op AND forbids any destination edition unit from being byte-identical to a complete source beat it represents. `cut` is forbidden entirely in v1 (every beat is `represented` or `merged`).

**Why this priority**: "Never copy" is a load-bearing product rule for composition; enforcing only the `verbatim` label leaves a whole-unit-copy hole. Guarantees the operation is genuinely expansion.

**Independent Test**: Feed a compose ledger containing a `verbatim` op → refused. Feed a compose edition whose destination unit is byte-identical to a complete beat it represents → refused ("whole-unit copy"). Feed a compose ledger with a `cut` op → refused.

**Acceptance Scenarios**:

1. **Given** a compose ledger entry with `op: verbatim`, **When** validated (or self-checked pre-emit), **Then** it is refused as illegal in compose mode.
2. **Given** a compose destination unit byte-identical to a complete source beat it represents, **When** validated, **Then** it is refused as a whole-unit copy.
3. **Given** a compose ledger entry with `op: cut`, **When** validated, **Then** it is refused (v1 forbids cut).

### User Story 4 - Revise verbatim-drift is refused before emit (TASK-50) (Priority: P2)

In revise mode the producer hardens the prompt (verbatim means byte-exact) and, before emitting, verifies each `verbatim`-declared unit is byte-exact against its source unit; on drift it refuses at the producer, before any write — rather than only being caught by the downstream gate after a full model call.

**Why this priority**: The full-ebook run refused 2/56 editions for verbatim-drift; the gate caught them but only post-hoc. The pre-emit self-check is the same mechanism compose uses and closes TASK-50 with earlier, cheaper, named refusal. revise otherwise stays unchanged (its 54 shipped editions remain valid).

**Independent Test**: With a deterministic model that declares a source unit `verbatim` but alters its bytes, run `voice revise`; confirm the producer refuses pre-emit (byte-mismatch), naming the drifted unit, and writes nothing. Confirm a byte-exact `verbatim` unit is accepted.

**Acceptance Scenarios**:

1. **Given** a revise run where the model declares `verbatim` but the destination bytes differ from the source unit, **When** the producer runs its pre-emit self-check, **Then** it refuses naming the drifted unit and emits no edition.
2. **Given** a revise run where a `verbatim` unit's destination bytes equal the source unit, **When** self-checked, **Then** it is accepted and emitted.
3. **Given** an already-shipped revise edition (no grounding records), **When** re-validated, **Then** it still passes (no reverse-accounting requirement on revise in v1).

### User Story 5 - A governed build's mode cannot be forged (Priority: P3)

For a governed build the requested operation is declared independently (the provider recipe). The validator requires `requested == ledger.mode` and refuses on mismatch, before op-legality — so an artifact that stamped `mode: revise` to legalize a smuggled `verbatim` cannot receive revise-mode validation.

**Why this priority**: Closes the self-certification hole (the artifact must not select its own rules). Lower priority because it binds the governed-build path; direct standalone use validates per the ledger mode and reports the absence of an independent comparison.

**Independent Test**: Invoke the validator with `requested_mode = compose` against a ledger stamped `mode: revise`; confirm refusal before op-legality. Invoke standalone `voice fidelity` (no requested mode); confirm it validates per `ledger.mode` and the report states no independent comparison was available.

**Acceptance Scenarios**:

1. **Given** `requested_mode = compose` and a ledger stamped `mode: revise`, **When** validated, **Then** it is refused for mode mismatch before any op-legality check.
2. **Given** no independently-supplied requested mode (standalone), **When** validated, **Then** it validates per `ledger.mode` and reports that no independent comparison was available.

### Edge Cases

- A spine beat that carries no citation/numeral/quoted payload: still requires exactly one disposition (`represented`/`merged`); cannot be cut (v1 forbids cut).
- Multiple beats merged into one edition unit (`merged`): every merged beat is accounted, and the single destination carries each beat's required payload.
- One edition unit grounded in several beats: its grounding record lists all contributing beats; still exactly one record for that unit.
- A composed edition where all payload survives but the prose invents a causal claim: passes the deterministic gate; the report states `composition_semantic_grounding: not-checkable` (regression protection against overclaiming).
- A spine using a declared open-question marker: the marker bytes must survive; if dropped, the gate fails. A spine with no marker syntax: open-question preservation is prompt-instruction only, not gated.
- An empty spine, or a spine input that also parses as a voice document (ambiguous input): refused loudly, naming the cause (reuses the existing input-resolution refusals).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tooling MUST expose two named CLI verbs, `voice compose` and `voice revise`, over a shared `buildEdition(mode, request)` core; each verb's help MUST state its fidelity contract.
- **FR-002**: Mode MUST be an operator invocation choice (the CLI verb), NOT inferred from input structure and NOT a production-control root-schema field. For a governed build the operation MUST be fixed by the provider recipe (independent of the artifact).
- **FR-003**: In compose mode the producer prompt MUST instruct expansion of each beat into narrative prose (not rephrasing), carrying every asserted fact and preserving every citation and numeral; it MUST require a grounding declaration for every edition unit.
- **FR-004**: Compose op-legality MUST forbid the `verbatim` op and the `cut` op; every source beat MUST be `represented` or `merged` (the existing exactly-one-disposition-per-source-unit rule is unchanged).
- **FR-005**: Compose MUST forbid whole-unit copying: no destination edition unit may be byte-identical to a complete source beat it represents.
- **FR-006**: Compose MUST enforce edition-side grounding accounting — every edition unit declares exactly one origin (`grounded:[beats]` / `connective` / `framing`); the validator MUST prove every edition unit is declared exactly once, with no undeclared edition unit and no grounding record naming a nonexistent edition unit.
- **FR-007**: The coverage ledger MUST record the `mode` it was produced under and, for compose, the per-edition-unit `grounding` records (provenance + judged-under).
- **FR-008**: For a governed build the validator MUST require `requested_mode == ledger.mode` and refuse on mismatch before op-legality. Standalone validation (no requested mode) MUST validate per `ledger.mode` and report that no independent comparison was available.
- **FR-009**: Op-legality and grounding MUST be enforced defense-in-depth: a producer pre-emit self-check (fast, named refusal, before any write) AND the deterministic validator (the trust anchor). They MAY share one pure normative-policy module, but validation MUST remain independent — producer success MUST NOT imply validator success.
- **FR-010**: In revise mode the producer MUST harden the prompt (verbatim means byte-exact) AND, before emitting, verify each `verbatim`-declared unit is byte-exact against its source unit, refusing drift at the producer, naming the drifted unit (folds in TASK-50).
- **FR-011**: All refusals MUST name the specific unit and cause; the system MUST NOT silently fall back, downgrade in place, or emit a partial artifact on a refusal.
- **FR-012**: The fidelity report MUST classify guarantees as mechanically-enforced vs producer-instruction vs advisory, and MUST report `spine_source_fidelity: not-checked` and `composition_semantic_grounding: not-checkable`. The system MUST NOT claim the deterministic gate detects invented facts, promotional-as-fact, causality, or a semantically papered-over open question.
- **FR-013**: Open-question preservation MUST be mechanically gated only when the spine uses a declared open-question marker syntax (the marker bytes must then survive byte-exact); absent such a syntax, open-question preservation is a producer prompt instruction and is not a deterministic failure.
- **FR-014**: Compose MUST reuse the existing source-side machinery unchanged (unit derivation, payload corroboration, source-unit accounting, citation no-fabrication + allow-list); the spine is ordinary source-cited markdown on the existing derivation path (no new file format, no separate loader).
- **FR-015**: Composed (impure) output MUST route to a dot-zoned path, consuming the shipped content-zone-segregation contract; the system MUST refuse to land impure bytes in a human-safe path.
- **FR-016**: Reverse (edition-side) accounting is compose-only in v1; revise mode MUST continue to validate without a grounding requirement so the already-shipped revise editions remain valid (extending edition-side accounting to revise is the captured follow-up, TASK-51).

### Non-Functional / Constraints

- **NFR-001**: The tooling MUST remain subject-agnostic (Constitution VII): the consumer supplies the spine documents, the voice catalog, and its citation-marker conventions; no subject-specific data is baked in.
- **NFR-002**: The mode-specific prompt contracts MUST be extracted from the single-mode prototype into a mode-keyed prompt module so no file exceeds the 300–500 line ceiling.
- **NFR-003**: No `any`, no `as Type` bypass, no `@ts-ignore`; interface-first, dependency-injected, composition over inheritance (repo TS guidelines).
- **NFR-004**: No production-control root-package schema change is required (mode lives at the CLI/recipe layer).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A composed chapter from a fixture spine preserves 100% of the citations and numerals present in each represented beat, byte-exact, in that beat's destination unit(s) (the empirical Ep1 bar).
- **SC-002**: 100% of composed editions in which any edition unit lacks a grounding record are refused, naming the unaccounted edition unit; 0% pass silently.
- **SC-003**: 100% of composed editions that declare a `verbatim` op, declare a `cut` op, or contain a destination byte-identical to a complete beat are refused.
- **SC-004**: 100% of revise runs in which a `verbatim`-declared unit drifts from its source are refused at the producer before any edition is written.
- **SC-005**: 100% of governed validations where `requested_mode != ledger.mode` are refused before op-legality.
- **SC-006**: The 54 previously-shipped revise editions continue to validate with zero regressions; the existing package test suite stays green.
- **SC-007**: For every composed edition, the fidelity report states its not-checkable limits (`spine_source_fidelity`, `composition_semantic_grounding`); no report claims semantic grounding as proven.

## Assumptions

- The spine is taken as the given source input; validating that the spine cites the correct evidence is out of scope here (asset-bank territory). Reported as `spine_source_fidelity: not-checked`.
- A model command is operator-supplied (as for revise, via the producer-protocol configuration); the provider fails loud when it is unset. No baked-in default model, no fallback.
- The spine's beats are derived into source units by the existing `deriveUnits` path unchanged; a "beat" is a source unit.
- Merge (`merged`) absorbs structural/heading beats, so forbidding `cut` in v1 loses no legitimate disposition.
- Standalone `voice fidelity` may be run with no external build declaration; in that case ledger-declared mode governs and the report states the absence of an independent comparison.

## Deferred — explicit scope boundaries (captured, NOT silently cut)

- **Edition-side accounting for revise mode** — deferred to TASK-51 (would invalidate the 54 shipped editions without a migration/regeneration path; revise's invention risk is lower and TASK-50 verbatim-drift is handled here).
- **Substring-copy detection** — v1 draws the deterministic no-copy line at whole-unit byte-identity; phrase-level reuse is unavoidable because citations/numerals must survive. Revisit only if empirically needed.
- **Model-based / semantic grounding review** — an advisory grounding check (does the connective prose actually follow from the beats?) is future work; v1 reports it `not-checkable`.
- **The exact grounding-basis enum and ledger field grammar, and the open-question marker grammar** — settled in the data-model/plan pass; the spec commits to their existence and semantics, not the final wire shape.
- **The spine's own upstream fidelity** — out of scope (asset-bank).

## Key Entities *(include if feature involves data)*

- **Spine**: source-cited markdown of ordered beats; an input *role*, not a new file format or a separate loader. May carry optional authored conventions (e.g. an open-question marker) that compose validates when present.
- **Beat**: a source unit derived from the spine (the existing `SourceUnit`); carries citations, numerals, quoted spans.
- **Edition unit**: a unit of the composed output body, separated in reading order.
- **Coverage entry**: per source beat — its disposition (`represented`/`merged` in compose; plus `verbatim`/`cut` legal only in revise) and the edition-unit indices it lands in.
- **Grounding record** (compose): per edition unit — its origin basis (`grounded:[beat indices]` / `connective` / `framing`).
- **Coverage ledger**: the emitted provenance artifact — the coverage entries, the `mode` stamp, and (compose) the grounding records; the artifact the validator judges.
- **Mode**: the operation (`compose` | `revise`) — chosen at invocation, stamped in the ledger, and (for governed builds) supplied independently as the requested mode the ledger must match.

# Phase 0 Research: Voice compose-from-spine

Resolves the design's deferred wire/grammar questions and the plan's open technical choices. Each decision is grounded in the existing `voice-tooling` code so implementation has no unresolved unknowns.

## R1 — Grounding-basis vocabulary

**Decision**: A closed 3-value basis per edition unit: `grounded` (carries `beats: [<source-unit refs>]`, ≥1), `connective` (glue prose with no independently-checkable factual assertion), `framing` (explicitly-permitted authorial framing). Deterministically the validator treats `connective` and `framing` **identically** (both = declared-non-grounded); the distinction is descriptive provenance metadata, not a different mechanical rule.

**Rationale**: The mechanical guarantee is "every edition unit has exactly one declared origin" — that needs only *grounded vs not*. Keeping `connective`/`framing` as distinct labels preserves honest provenance (a reader/report can see which non-grounded prose is glue vs framing) without adding a check. A closed enum keeps the ledger loader deterministic and fail-loud on an unknown basis.

**Alternatives considered**: (a) binary `grounded | ungrounded` — loses provenance nuance for no mechanical simplification; (b) free-text basis — not deterministically checkable, invites drift. Rejected.

## R2 — How the model declares grounding

**Decision**: Mirror the existing index-based coverage protocol (spec 005, D22 corroborate-not-infer). The model returns, alongside `edition` and `coverage`, a `grounding` array: one entry per edition unit, `{ edition_unit: <0-based index>, basis: "grounded"|"connective"|"framing", beats?: [<0-based source-unit indices>] }`. The **provider** (not the model) resolves indices into the hash-keyed `UnitRef` form and builds the ledger's `grounding` records — exactly as `ledger-build.ts` already resolves the coverage index mapping. The model never computes hashes.

**Rationale**: Reuses the proven producer-protocol shape; the model emits indices it can produce, the provider derives the hash-keyed provenance. No new capability is asked of the model.

**Alternatives considered**: model emits hash-keyed grounding directly — infeasible (model cannot compute sha256), same reason the coverage protocol is index-based. Rejected.

## R3 — Ledger schema landing (mode + grounding)

**Decision**: Add `mode: "compose" | "revise"` and (compose only) `grounding: GroundingRecord[]` to `CoverageLedger`. They land on the ledger's **existing additive-extensibility seam** (`schema/ledger.ts` D21 — unknown keys already pass through untouched), and `loadLedger` is extended to *validate* them: `mode` is a required closed-enum string; `grounding` is required-and-non-empty when `mode == compose`, forbidden when `mode == revise`; each grounding record is structurally validated (known basis, `beats` present+non-empty iff `grounded`). Structural validation only — edition-unit existence/exhaustiveness is a fidelity-validator concern (needs the derived edition), consistent with the loader's D20 boundary.

**Rationale**: The additive seam means existing revise ledgers (no `mode`) must still load. Resolution: absent `mode` defaults to `revise` on read (backward-compatible with the 54 shipped editions), but the producer always *writes* `mode` going forward. This keeps SC-006 (zero regressions) while making new editions explicit.

**Alternatives considered**: a new ledger version (2) — heavier, would restale all existing editions; rejected in favor of the additive seam + default-on-read.

## R4 — Whole-unit no-copy comparison basis

**Decision**: Compare the **normalized** bytes of the composed destination edition unit against the **normalized** bytes of each complete source beat it represents (the same normalization `units/derive.ts` + `units/identity.ts` already use for unit hashing). A destination byte-identical (post-normalization) to a whole beat is refused. Comparison is whole-unit only — substring reuse is explicitly out (citations/numerals force phrase-level recurrence; spec Deferred).

**Rationale**: Normalized comparison matches how units are already identified, so "identical" means the same thing the rest of the system means. Whole-unit is the defensible deterministic line (design decision 10 / open-question 4).

**Alternatives considered**: raw-byte comparison — would diverge from unit identity semantics; substring detection — noisy and unavoidable-false-positive given required payload survival. Rejected for v1.

## R5 — Mode agreement wire (requested vs ledger)

**Decision**: Extend the `ValidateRequest` wire (`fidelity/cli.ts`) with an **optional** `requested_mode: "compose" | "revise"`. When present (a governed build supplies it from the provider recipe), the validator refuses on `requested_mode != ledger.mode` **before** op-legality. When absent (standalone `voice fidelity`), the validator judges per `ledger.mode` and the report records `mode_comparison: none-supplied` (fail-loud honesty, Principle V — it reports the absence rather than silently trusting).

**Rationale**: Optional keeps standalone direct use working and adds no production-control root-schema field (NFR-004); the governed path passes the recipe-declared operation. The artifact cannot self-select its rules when a requested mode is supplied.

**Alternatives considered**: mandatory `requested_mode` — breaks standalone use; infer mode only from the ledger — the self-certification hole the review flagged. Rejected.

## R6 — CLI surface: two bins vs one multiplexer

**Decision**: Ship a `voice-compose.mjs` bin alongside the existing `voice-revise.mjs`, both thin wrappers over a shared mode-parameterized producer core in `revise/cli.ts` (`runProducer(mode, …)`). The user-facing verbs `voice compose` / `voice revise` map to these bins (the package's existing per-capability bin convention — `voice-revise`, `voice-fidelity`, `voice-reader`). A `voice <subcommand>` multiplexer is a possible later ergonomic layer but is not required and adds a dispatch surface now.

**Rationale**: Matches the established one-bin-per-capability convention in this package; the shared core keeps the two verbs honest (same machinery, mode-specific policy). Minimal new surface.

**Alternatives considered**: single `voice` multiplexer bin — a larger change to the package's CLI convention for no functional gain in v1; a `--mode` flag on one bin — the design already rejected this (two verbs carry different contracts and help). Rejected.

## R7 — Open-question marker syntax

**Decision**: Optional, opt-in per spine. If a source beat contains a marker matching a declared syntax `[OPEN-QUESTION: <text>]` (single-line, bracketed), those marker bytes are treated as required payload for that beat and MUST survive byte-exact into the beat's destination — enforced by the existing payload-survival machinery extended to recognize the marker, exactly as citation markers are. If no beat carries the marker, open-question preservation is a producer prompt instruction only (not gated), and the report notes `open_question_markers: none-declared`.

**Rationale**: Reuses the citation-marker payload-survival mechanism (`payload/extract.ts`), so no new checker is needed — only a recognized token. Opt-in keeps the spine a plain-markdown role (no mandatory schema), honoring "a spine is not a new file format" while allowing deterministic preservation when the convention is used.

**Alternatives considered**: mandatory spine frontmatter for open questions — imposes a schema on the spine (rejected, keeps the input-role light); prose-only (never mechanical) — cannot satisfy FR-013's "mechanical when declared". The opt-in token threads both.

## R8 — Producer/validator independence with shared policy

**Decision**: The pure policy functions (`policy/op-legality.ts`, `policy/grounding.ts`) take plain data (mode, coverage, grounding records, derived source units, derived edition units) and return a named result. The producer's `preflight.ts` calls them pre-emit over the model's just-parsed output; the validator's `run.ts` calls them over the emitted artifact it independently re-derives. Neither entry point can influence whether the other runs; producer success provides no token the validator consults.

**Rationale**: Shared normative logic ≠ self-certification (design's independence boundary; Principle VI). One source of truth for the rules; two independent invocations.

**Alternatives considered**: duplicate the rules in producer and validator — drift risk; let the validator trust a producer "self-check passed" flag — self-certification hole. Rejected.

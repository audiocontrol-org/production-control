---
description: "Task list for voice-compose-from-spine (compose mode)"
---

# Tasks: Voice compose-from-spine (compose mode)

**Input**: Design documents from `specs/006-voice-compose-from-spine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included and REQUIRED — the design mandates RED-first TDD; the whole feature is a deterministic gate, so tests are load-bearing, not optional.

## Format: `[ID] [P?] [Story] [tier] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1..US5 (from spec.md); Setup/Foundational/Polish carry none
- **[tier:fast|balanced|powerful]**: model tier (fast=haiku, balanced=sonnet, powerful=opus)
- Paths are under `voice-tooling/` (the craft package)

## Path Conventions

- Source: `voice-tooling/src/…`; tests: `voice-tooling/src/__tests__/…`; bins: `voice-tooling/bin/…`

---

## Phase 1: Setup

- [x] T001 [tier:fast] Create the new module directories `voice-tooling/src/policy/` and `voice-tooling/src/revise/prompt/`, and a `voice-tooling/src/__tests__/fixtures/spine/` fixture area, per plan.md Project Structure.
- [x] T002 [P] [tier:fast] Add fixtures in `voice-tooling/src/__tests__/fixtures/spine/`: a minimal source-cited spine (2–3 beats carrying ≥1 citation marker + ≥1 numeral, one beat with an `[OPEN-QUESTION: …]` marker) and a reusable voice document; a deterministic model-stub helper that emits a fixed `{edition, coverage, grounding}` JSON.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**Goal**: mode plumbing + the shared pure policy, so compose is runnable end-to-end and both consumers (producer preflight, validator) can call one normative source.

- [x] T003 [tier:balanced] Extract the mode-keyed prompt module: create `voice-tooling/src/revise/prompt/revise.ts`, `.../compose.ts`, `.../index.ts` (`buildPrompt(mode, …)`), moving the prompt bodies out of `voice-tooling/src/revise/model.ts` so `model.ts` drops under the 500-line ceiling; `model.ts` gains a `mode` param and delegates. (Compose prompt = expand/forbid-verbatim/grounding-declaration; revise prompt hardened per US4.)
- [x] T004 [P] [tier:balanced] RED: tests in `voice-tooling/src/__tests__/prompt.test.ts` asserting the compose prompt demands expansion + a grounding declaration + forbids verbatim, and the revise prompt states verbatim==byte-exact.
- [x] T005 [tier:balanced] Ledger schema additions in `voice-tooling/src/schema/ledger.ts`: add `mode` ("compose"|"revise", default `revise` on read) and `grounding: GroundingRecord[]` on the additive-extensibility seam; extend `loadLedger` with structural validation per `contracts/coverage-ledger-additions.md` (mode enum; grounding required-non-empty iff compose, absent iff revise; each record: basis enum, beats present-non-empty iff grounded).
- [x] T006 [P] [tier:balanced] RED: tests in `voice-tooling/src/__tests__/ledger-mode-grounding.test.ts` — pre-006 ledger (no mode) loads as revise; compose ledger requires non-empty grounding; revise+grounding rejected; malformed grounding record rejected naming the field.
- [x] T007 [tier:powerful] Pure policy `voice-tooling/src/policy/op-legality.ts`: `checkOpLegality(mode, coverage, sourceUnits, editionUnits)` — compose forbids `verbatim` and `cut`; compose whole-unit no-copy (normalized-byte comparison per R4); revise verbatim byte-exact against source unit (the TASK-50 predicate). Pure, DI, named results.
- [x] T008 [tier:powerful] Pure policy `voice-tooling/src/policy/grounding.ts`: `checkGrounding(groundingRecords, editionUnits, sourceUnits)` — exhaustive + exclusive over edition units; grounded `beats` resolve to real source units; named failure per unaccounted/dangling.
- [x] T009 [P] [tier:powerful] RED adversarial tests in `voice-tooling/src/__tests__/policy-op-legality.test.ts` and `.../policy-grounding.test.ts`: verbatim-in-compose, cut-in-compose, whole-unit copy, revise verbatim drift/byte-exact, missing grounding record, duplicate record, dangling edition-unit, dangling beat, all-legal pass.
- [x] T010 [tier:balanced] `voice-tooling/src/revise/protocol.ts`: parse the model's `grounding` array (index-based `{edition_unit, basis, beats?}`) alongside coverage; validate shape; leave hash resolution to ledger-build.
- [x] T011 [tier:balanced] `voice-tooling/src/revise/ledger-build.ts`: stamp `mode`; resolve the index-based grounding into hash-keyed `GroundingRecord[]` (compose); omit grounding for revise.
- [x] T012 [tier:balanced] Shared producer core `voice-tooling/src/revise/cli.ts`: `runProducer(mode, request)`; wire `voice-tooling/bin/voice-compose.mjs` (new) and keep `voice-tooling/bin/voice-revise.mjs`, both thin wrappers; each `--help` states its contract (R6).

**Checkpoint**: `voice compose` produces an edition + `mode: compose` ledger with grounding; the pure policy modules are green.

---

## Phase 3: US1 — Compose a faithful chapter (Priority: P1)

**Goal**: the happy path — a faithful composed chapter passes fidelity with all payload byte-exact.
**Independent test**: run `voice compose` over the fixture spine+voice with the deterministic stub; `voice fidelity` passes; report shows the not-checkable limits.

- [x] T013 [US1] [tier:balanced] RED integration test `voice-tooling/src/__tests__/compose-happy.int.test.ts`: `voice compose` emits a dot-zoned edition + compose ledger; every beat citation/numeral survives byte-exact into its represented destination (SC-001).
- [x] T014 [US1] [tier:balanced] Wire `runProducer('compose', …)` end-to-end through prompt→model→protocol→ledger-build→emit; route output dot-zoned (consume content-zone contract, FR-015).
- [x] T015 [US1] [tier:balanced] Report trust-boundary fields in `voice-tooling/src/fidelity/report.ts`: emit `mode`, `spine_source_fidelity: not-checked`, `composition_semantic_grounding: not-checkable`, `open_question_markers` state (FR-012); GREEN T013.

---

## Phase 4: US2 — Undeclared invention is refused (Priority: P1)

**Goal**: edition-side grounding accounting makes silent invention impossible.
**Independent test**: a composed edition missing a grounding record (or with a dangling one) is refused, naming the unit.

- [x] T016 [P] [US2] [tier:balanced] RED tests `voice-tooling/src/__tests__/check-edition-grounding.test.ts`: undeclared edition unit → fail; dangling record → fail; fully-declared → pass.
- [x] T017 [US2] [tier:balanced] `voice-tooling/src/fidelity/check-edition-grounding.ts`: wrap `policy/grounding.ts` over the derived edition units + ledger grounding (compose only); GREEN T016.
- [x] T018 [US2] [tier:powerful] Wire into `voice-tooling/src/fidelity/run.ts` in the correct sequence (after source-side checks; compose only) and into `voice-tooling/src/revise/preflight.ts` (producer pre-emit) — sharing `policy/grounding.ts`, independent invocations (Principle VI / R8).

---

## Phase 5: US3 — Compose never copies (Priority: P2)

**Goal**: forbid verbatim/cut ops and whole-unit copying in compose.
**Independent test**: verbatim-op, cut-op, and whole-unit-copy compose editions each refused.

- [x] T019 [P] [US3] [tier:balanced] RED tests `voice-tooling/src/__tests__/check-op-obligations-compose.test.ts` and `.../check-no-copy.test.ts`: verbatim-in-compose fail, cut-in-compose fail, whole-unit copy fail, faithful pass.
- [x] T020 [US3] [tier:powerful] Make `voice-tooling/src/fidelity/check-op-obligations.ts` mode-aware (compose: verbatim/cut are illegal dispositions), delegating the legality rule to `policy/op-legality.ts`.
- [x] T021 [US3] [tier:powerful] `voice-tooling/src/fidelity/check-no-copy.ts`: whole-unit normalized-byte no-copy (R4); wire into `run.ts` (compose only) and `preflight.ts`; GREEN T019.

---

## Phase 6: US4 — Revise verbatim-drift refused pre-emit (TASK-50) (Priority: P2)

**Goal**: the producer refuses a drifted verbatim unit before writing; revise otherwise unchanged.
**Independent test**: a revise run declaring verbatim but altering bytes refuses pre-emit, names the unit, writes nothing; a shipped edition still validates.

- [x] T022 [P] [US4] [tier:balanced] RED tests `voice-tooling/src/__tests__/revise-verbatim-preflight.int.test.ts`: drift → pre-emit refusal, no file written; byte-exact → accepted; plus a regression asserting a pre-006 shipped-shape revise edition still validates (SC-006).
- [x] T023 [US4] [tier:powerful] `voice-tooling/src/revise/preflight.ts`: for revise, verify each `verbatim` unit's destination is byte-exact to its source unit via `policy/op-legality.ts`; refuse drift named, before emit; ensure the hardened revise prompt (T003) is in place; GREEN T022.

---

## Phase 7: US5 — Mode cannot be forged (Priority: P3)

**Goal**: a governed build's requested mode must match the ledger; standalone reports the absence.
**Independent test**: requested≠ledger → refused before op-legality; standalone → validates per ledger mode, reports `none-supplied`.

- [x] T024 [P] [US5] [tier:balanced] RED tests `voice-tooling/src/__tests__/check-mode-agreement.test.ts`: requested compose vs ledger revise → fail before op-legality; no requested mode → pass + `mode_comparison: none-supplied`.
- [x] T025 [US5] [tier:balanced] Extend `voice-tooling/src/fidelity/cli.ts` `ValidateRequest` with optional `requested_mode`; add `voice-tooling/src/fidelity/check-mode-agreement.ts`.
- [x] T026 [US5] [tier:powerful] Sequence mode-agreement FIRST in `voice-tooling/src/fidelity/run.ts` (before op-legality/grounding) and thread `mode_comparison` into the report; GREEN T024.

---

## Phase 8: Polish & cross-cutting

- [x] T027 [P] [tier:balanced] Open-question marker (R7/FR-013): recognize `[OPEN-QUESTION: …]` as required payload in `voice-tooling/src/payload/extract.ts` so its bytes must survive; report `open_question_markers: enforced|none-declared`; test in `voice-tooling/src/__tests__/open-question-marker.test.ts`.
- [x] T028 [P] [tier:balanced] RED overclaim-regression test `voice-tooling/src/__tests__/compose-semantic-notcheckable.test.ts` (SC-007): a grounded/connective edition that invents causality passes deterministically while the report states `composition_semantic_grounding: not-checkable`.
- [x] T029 [P] [tier:fast] Docs: update `voice-tooling` docs / `--help` text for `voice compose` and the revise contract; note the trust boundary (mechanical vs producer-instruction vs advisory).
- [x] T030 [tier:balanced] Final verification: full `vitest` suite green (new + existing, incl. the shipped-editions regression, SC-006); typecheck + eslint clean; assert no file exceeds 500 lines (confirm `model.ts` shrank after T003). Record the gate result.

---

## Dependencies & sequencing

- **Setup (T001–T002)** → **Foundational (T003–T012)** blocks all stories.
- Within Foundational: T007–T009 (pure policy + adversarial tests) are the normative core built before consumers; T010–T012 make compose runnable.
- **US1 (T013–T015)** depends only on Foundational — the MVP.
- **US2 (T016–T018)**, **US3 (T019–T021)** consume `policy/grounding.ts` / `policy/op-legality.ts` — independent of each other; both wire into `run.ts` + `preflight.ts` (coordinate the shared edits).
- **US4 (T022–T023)** depends on `policy/op-legality.ts` (revise predicate) + the hardened prompt (T003).
- **US5 (T024–T026)** depends on the ledger `mode` stamp (T005) + `run.ts`.
- **Polish (T027–T030)** last; T030 is the release gate.

## Parallel opportunities

- T002, T004, T006, T009 (RED tests + fixtures) are `[P]` — author before their implementations.
- Across stories: T016, T019, T022, T024 RED test files are `[P]` (distinct files). The `run.ts`/`preflight.ts` wiring tasks (T018, T021, T026) touch shared files — serialize those.

## MVP scope

**US1 (T001–T015)** delivers a runnable, fidelity-passing compose path — the minimum demonstrable increment. US2 (the invention backstop) is the next-most-critical (also P1) and should follow immediately.

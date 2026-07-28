# Tasks: Voice producer protocol + corpus citation support

**Input**: Design documents from `specs/005-voice-producer-protocol/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUESTED — the fidelity contract (Constitution V) and the acceptance scenarios are the surface; test tasks pin each. The implementation ALREADY EXISTS on `spike/nouvelle-france-voice-lab` (`729c110`, `06e48ca`) and passed a live 8-voice lab, so these are **ADOPT-AND-RATIFY** tasks: verify each module satisfies its requirement, confirm/add the pinning tests, and prove the whole suite green — not build-from-scratch.

**Model-tier tags** (`stack-control-model-tier-v1`): every task carries `[tier:<label>]`, resolved at `resolve-tiers` time. This installation binds fast→haiku, balanced→sonnet, powerful→opus.

## Format: `[ID] [P?] [Story] [tier:<label>] Description`

## Path conventions
- Package: `voice-tooling/src/**`, tests `voice-tooling/test/**` (`node --import tsx --test`); production-control integration `tests/integration/`. No production-control core change. Files ≤500 lines; no `any`/`as`/`@ts-ignore`; no fallbacks outside tests.

## Phase 1: Setup
- [x] T001 [tier:fast] Confirm the spec-005 modules are present on the working branch and the package builds: `voice-tooling/src/revise/{protocol,model,ledger-build,request,emit,cli}.ts`, `src/payload/extract.ts`, `src/fidelity/check-ledger-structure.ts`, `bin/voice-revise.mjs` exist; `npm --prefix voice-tooling run typecheck` is clean.

## Phase 2: Foundational
- [x] T002 [tier:fast] Confirm the reused spec-004 modules are unchanged and importable (`@/units/derive.ts`, `@/schema/ledger.ts`, `@/schema/voice.ts`, `@/fidelity/check-ledger-structure.ts` `extractLedgerYaml`) — this feature adds no production-control core change (FR-012).

## Phase 3: User Story 1 — The real producer protocol (Priority: P1) 🎯 MVP
**Goal**: produce a fidelity-passing edition with a real model via the index-mapping protocol.
**Independent test**: with a model command in `VOICE_REVISE_MODEL`, build a target → schema-valid `.ai/`-routed ledgered edition that `voice fidelity` accepts; unset var refuses.

- [x] T003 [US1] [tier:balanced] Ratify `parseModelOutput` in `voice-tooling/src/revise/protocol.ts` against FR-002: accepts a raw object and a fenced JSON block; refuses (naming the defect) each malformed shape (non-object, missing `edition`, non-array `coverage`, op outside the set, `cut` with destinations or without reason, non-`cut` without destinations or with a reason). Confirm/extend `voice-tooling/test/revise-protocol.test.ts`.
- [x] T004 [US1] [tier:balanced] Ratify `buildRevisePrompt` in `voice-tooling/src/revise/model.ts` against FR-001: prompt contains numbered source units, the voice's trait directives, the deterministic fidelity contract, and the required output format. Confirm the prompt-shape test in `voice-tooling/test/revise.test.ts`.
- [x] T005 [US1] [tier:balanced] Ratify `resolveModelCommand`/`invokeModel` (`model.ts`) against FR-005: reads `VOICE_REVISE_MODEL`, spawns with the prompt on stdin, and FAILS LOUD naming the missing variable when unset — no default model, no fallback. Confirm the fail-loud test.
- [x] T006 [US1] [tier:powerful] Ratify `buildEdition` in `voice-tooling/src/revise/ledger-build.ts` against FR-003/FR-004/FR-007: derives source + edition units, validates `coverage.length === sourceUnits.length` and every index in range (refuse otherwise, no partial edition), resolves indices → hash-keyed `CoverageLedger`, and emits `ledger:` frontmatter + body. Confirm the round-trip test (built edition → `extractLedgerYaml` → `loadLedger` → accounting/op checks clean; frontmatter does not perturb body units). (powerful: the hash-mapping correctness core.)
- [x] T007 [US1] [tier:balanced] Ratify impurity + no-self-verdict (FR-006) in `emit.ts`/`cli.ts`: the provider declares `impure:{reason}` and returns no `validation`. Confirm via the integration test `tests/integration/voice-revise.test.ts` (build routes to `.ai/`, `voice fidelity` gates) stays green with the deterministic stub model (SC-001).
- [x] T008 [P] [US1] [tier:balanced] Add/confirm a fail-loud test for the mapping guards (FR-004): a coverage array whose length ≠ source-unit count, and an out-of-range `edition_units` index, each refuse with no partial edition (SC-001).

**Checkpoint**: US1 ratified — the real producer builds fidelity-passing editions and fails loud on misconfiguration/malformed output.

## Phase 4: User Story 2 — Corpus citation support (Priority: P2)
**Goal**: `[PB-###]` citations are recognized, checked, and allow-listed from `sources:`.
**Independent test**: a source citing `[PB-P056]` with `sources: [PB-P056]` → `citations` check runs; dropped/fabricated marker refused; a marker's digits not counted as a numeral.

- [x] T009 [US2] [tier:balanced] Ratify citation extraction in `voice-tooling/src/payload/extract.ts` against FR-008/FR-009: the regex matches `[^label]` AND `[PB-###]`; numeral extraction masks citation spans (shared source of truth) so a marker's digits are not double-counted. Confirm `voice-tooling/test/payload-extract.test.ts` (incl. `[PB-P056]`+`1879` → 1 citation, 1 numeral).
- [x] T010 [US2] [tier:balanced] Ratify allow-list derivation in `voice-tooling/src/fidelity/check-ledger-structure.ts` against FR-010: when no `citation_allowlist`, derive from `sources:` frontmatter (`PB-P056`→`[PB-P056]`); union when both present; applied to BOTH the source-side precondition and the edition-side no-fabrication/allow-list checks. Confirm `pre-checks.test.ts` + `check-payload.test.ts`.
- [x] T011 [P] [US2] [tier:fast] Confirm no regression of the footnote `[^label]`/`citation_allowlist` path (FR-011) — the existing tests remain green.

**Checkpoint**: US2 ratified — citation fidelity runs on real `[PB-###]` corpora.

## Phase 5: Polish & cross-cutting
- [x] T012 [tier:fast] Confirm the four deferred boundaries are recorded (spec Deferred section + backlog TASK-30/31/39/40) and NOT silently implemented here — the scope boundary is explicit, not a cut.
- [x] T013 [tier:powerful] Whole-suite gate (SC-004): `npm --prefix voice-tooling test` + `run typecheck` green; from repo root `npx vitest run tests/integration/voice-revise.test.ts` green; `npx eslint` clean on touched files; NO file >500 lines across the spec-005 modules; no `any`/`as`/`@ts-ignore` introduced. (powerful: whole-suite gate.)

## Dependencies & order
- Setup (T001–T002) → US1 (T003–T008, MVP) → US2 (T009–T011) → Polish (T012–T013).
- US1 is independently shippable (the producer); US2 is additive citation coverage.

## Tier distribution (sanity)
- fast: T001, T002, T011, T012 (confirm/scaffolding).
- balanced: T003, T004, T005, T007, T008, T009, T010 (ratify + tests).
- powerful: T006 (hash-mapping core), T013 (whole-suite gate).

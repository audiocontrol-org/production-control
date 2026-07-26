# Tasks: Content zone segregation

**Input**: Design documents from `specs/003-content-zone-segregation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUESTED — the Constitution's Test-Driven gate applies, and the design record's
normative adversarial test list plus the quickstart scenarios are the acceptance surface. Test
tasks are included and precede their implementation (RED before GREEN).

**Model-tier tags** (`stack-control-model-tier-v1`): every task carries `[tier:<label>]` beside
`[P]`/`[US n]`, resolved by the installation's `tier_map` at `resolve-tiers` time. This installation
binds cheapest→`fast` (haiku), mid→`balanced` (sonnet), most-capable→`powerful` (opus).

## Format: `[ID] [P?] [Story] [tier:<label>] Description`

- **[P]**: parallelizable (different files, no incomplete dependency).
- **[Story]**: US1/US2/US3 for story-phase tasks only.

## Path conventions

Single TypeScript package: `src/` and `tests/` at repository root; `@/` import alias.

---

## Phase 1: Setup

- [x] T001 [tier:fast] Create the `src/zoning/` module directory and an `index.ts` barrel that re-exports the classifier and router (empty stubs to start), following the existing `src/<domain>/` layout.
- [x] T002 [P] [tier:fast] Create the test directory `tests/unit/zoning/` and an integration test file placeholder `tests/integration/zoning.test.ts` wired to the existing fake-provider/in-memory harness (see `tests/integration/support.ts`).

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the pure classifier and the shared refusal helper that every user story depends on. No story can be enforced before the classifier exists.

- [x] T003 [US-none] [tier:balanced] Write RED golden-case tests for `classifyZone` in `tests/unit/zoning/classify.test.ts` covering every row of `contracts/zone-classifier.md` (basename-only `dist/.draft.md` → human-safe; nested dot `dist/target/.ai/out.md` → ai-permitted; `.cache`/`.tmp`/`.ai` identical; empty/no-dot → human-safe). Tests fail (no impl yet).
- [x] T004 [tier:balanced] Implement `classifyZone(relPath)` in `src/zoning/classify.ts` per `contracts/zone-classifier.md` (any-dot-wins over parent directory segments; basename excluded; total; no I/O; no config). Make T003 green. Keep under 500 lines (it is tiny).
- [x] T005 [P] [tier:fast] Add a shared, named-refusal error helper for zoning violations (message names the offending path/target, FR-022) in `src/zoning/errors.ts`, mirroring the existing FR-036 refusal style in `src/providers/run.ts`.

**Checkpoint**: `classifyZone` is proven by golden tests; the refusal helper exists.

---

## Phase 3: User Story 1 — Impure output can never land in a human's working area (P1) 🎯 MVP

**Goal**: impure output is written only to an AI-permitted path; any attempt to place it in a human-safe path — directly, via a mis-declared provider, or via a symlink — is refused, naming the path.

**Independent test**: build an impure fake-provider target → committed under `.ai/`; force impure output toward a dot-free path / pure-declared-returns-impure / symlink-to-human-safe → each refused, naming the path/target.

### Tests (RED first)

- [x] T006 [P] [US1] [tier:balanced] Integration test in `tests/integration/zoning.test.ts`: an impure target's artifact is committed under `.ai/…` (NOT `ai-generated/`, NOT `dist/`) and its path classifies `ai-permitted`. (quickstart S1)
- [x] T007 [P] [US1] [tier:balanced] Integration test: an impure output whose resolved path is dot-free (human-safe) is refused, message names the path; no bytes committed. (quickstart S2, FR-011)
- [x] T008 [P] [US1] [tier:balanced] Unit test in `tests/unit/providers/invoke-impurity.test.ts`: a provider **declared pure** that returns `impure` is refused, naming the target. (quickstart S3, FR-012)
- [x] T009 [P] [US1] [tier:powerful] Integration test: a symlinked impure output whose lexical path is dot-zoned but whose real target resolves human-safe is refused (realpath, not lexical). (quickstart S4, FR-010/D5c)
- [x] T010 [P] [US1] [tier:balanced] Integration test: a provider output escaping its assigned output dir is rejected as a containment/escape violation **before** zoning, regardless of impurity. (quickstart S5, FR-009)

### Implementation (make the above green)

- [x] T011 [US1] [tier:balanced] Add `routeOutputRoot(class)` in `src/zoning/route.ts` returning the dot-zoned impure root and the pure root, and **rename the impure root string** from `ai-generated` to `.ai` at its source in `src/providers/build.ts:112` and the `stage()` guard/comment (build.ts ~200-214). Impure → `<episodeDir>/.ai/…`, pure → `dist/`.
- [x] T012 [US1] [tier:powerful] In `src/providers/run.ts` (declared-output loop, ~229), implement the fixed ordering (FR-009/010): resolve → reject traversal/escape → `fs.realpath` the destination → confirm containment on the resolved path → then hand off to zoning. Do not let a symlink pass a lexical check.
- [x] T013 [US1] [tier:powerful] Wire the **zoning refusal** into the build path: after containment, `classifyZone` the resolved destination and refuse an impure output resolving to `human-safe`, naming the path (FR-011). Refusal happens before staging (build.ts step 4).
- [x] T014 [US1] [tier:balanced] In `src/providers/invoke.ts` (or `impurityOf` in `build.ts:284`), make a **pure declaration + impure response** a named refusal instead of the current `response.impure ?? decl.impure` coalesce (FR-012). Runtime impurity may only corroborate a static impure declaration.

**Checkpoint**: US1 tests green — the safety MVP holds independently of US2/US3.

---

## Phase 4: User Story 2 — Zone legible from the path + authored-direction refusal (P2)

**Goal**: any path's zone is readable by inspection; authored content is refused from AI zones so the two channels agree in both directions.

**Independent test**: classify the golden path set (US2 view); an authored node in a dot-zone is refused, one in a human-safe path is accepted.

### Tests (RED first)

- [x] T015 [P] [US2] [tier:balanced] Unit test in `tests/unit/graph/authored-zone.test.ts`: an authored node whose declared path is under a dot-zone fails graph validation, naming it; an authored node under a human-safe path passes. (quickstart S7, FR-006/D2b)
- [x] T016 [P] [US2] [tier:fast] Unit test asserting `.cache`/`.tmp`/`.ai` classify identically, a dot **basename** does not zone, and the **above-root exclusion** case — a dotted ancestor *above* the production root does not zone content inside it (FR-003) — as a legibility regression guard co-located in `tests/unit/zoning/classify.test.ts` (extends T003 if simpler). (quickstart S6, FR-002/FR-003/FR-016)

### Implementation

- [x] T017 [US2] [tier:balanced] Add the authored-direction check in `src/graph/validate.ts`: every `authored` node's declared path MUST classify `human-safe`; else refuse, naming the node (FR-006/D2b). Reuse `classifyZone`; no new node kind (FR-018).
- [x] T018 [P] [US2] [tier:fast] Ensure refusal messages across zoning/build/graph convey the asymmetric semantics (*dot-zoned → AI-permitted / not human-safe*; *non-dot → human-safe*) and never claim a path proves exact provenance (FR-016/FR-023).

**Checkpoint**: US2 green — bidirectional agreement and legibility semantics enforced.

---

## Phase 5: User Story 3 — Routing audit, honest scope (P3)

**Goal**: a read-only verb reports routing-policy violations before a build and states its own scope limits.

**Independent test**: clean manifest → exit 0; impure target routed dot-free (or authored in dot-zone) → non-zero, named; every run prints the scope note.

### Tests (RED first)

- [x] T019 [P] [US3] [tier:balanced] Integration test in `tests/integration/audit-zones.test.ts`: clean manifest exits 0 with `--json`; a mis-routed impure target and an authored-in-dot-zone are each reported, named, non-zero exit; the scope statement (runtime filenames/escape checked only at build time) appears in every run. (quickstart S8, FR-013/014/015)

### Implementation

- [x] T020 [US3] [tier:balanced] Implement the read-only routing-audit verb in `src/cli/audit-zones.ts` per `contracts/audit-verb.md`: iterate manifest targets/nodes, apply the class↔zone rule via `routeOutputRoot`/`classifyZone`, emit the `AuditReport` (`--json`), exit 0 clean / non-zero on violation, always print the scope note.
- [x] T021 [US3] [tier:fast] Register the audit verb in `src/cli/index.ts` following the existing verb-registration pattern (`--json`, `--episode`).

**Checkpoint**: US3 green — pre-build detection with an honest contract.

---

## Phase 6: Polish & cross-cutting

- [x] T022 [P] [tier:balanced] Migrate fixtures and existing quickstarts from `ai-generated/` to `.ai/`: grep the repo for `ai-generated` (fixtures under `tests/`, `examples/`, specs 001/002 quickstarts) and update expectations; confirm no test still asserts `ai-generated/`.
- [x] T023 [P] [tier:fast] Add a regression test asserting an accidental in-place edit to a `.ai/` artifact still reports `modified` and that this feature does NOT protect those bytes (FR-024; documents the TASK-15 boundary), in `tests/integration/zoning.test.ts`.
- [x] T024 [tier:powerful] Full-suite verification: `npm test` and `npm run typecheck` green; no file exceeds 500 lines (check `src/zoning/*`, edited `run.ts`/`build.ts`/`invoke.ts`/`validate.ts`, `src/cli/audit-zones.ts`); no `any`/`as`/`@ts-ignore` introduced; every new refusal names its cause (spot-check against FR-022).
- [x] T025 [P] [tier:fast] Update `README.md`/relevant docs to describe the `.ai/` convention and the *dot-zoned = AI-permitted / not human-safe* semantics (INV-2/FR-016), and note the routing-audit verb.

---

## Dependencies & story completion order

- **Setup (P1-2)** → **Foundational (P3-5: classifier T004 + refusal helper)** block everything.
- **US1 (P1)** depends only on Foundational. It is the MVP and is independently shippable.
- **US2 (P2)** depends on Foundational (`classifyZone`); independent of US1's build wiring except shared messages (T018).
- **US3 (P3)** depends on Foundational and reuses `routeOutputRoot`/`classifyZone`; independent of US1/US2 runtime.
- **Polish (P6)** after the stories; T022 (fixture migration) should land with or immediately after T011 to keep the suite green.

## Parallel execution examples

- Foundational: T003 (RED tests) ∥ T005 (refusal helper) — different files.
- US1 tests: T006–T010 are all `[P]` (distinct test files) and can be written together before implementation.
- Cross-story: once Foundational is done, US1 impl (T011–T014), US2 (T015–T018), and US3 (T019–T021) touch mostly distinct files and can proceed in parallel, coordinating only on shared refusal-message wording (T018).

## Implementation strategy

MVP = **US1** (Phases 1–3): the classifier, the `.ai/` rename, the build-time refusal with realpath
ordering, and the pure-returns-impure refusal. That alone delivers the load-bearing guarantee (no
impure bytes in a human-safe path). US2 adds the authored direction + legibility guards; US3 adds
pre-build detection. Ship incrementally; each phase ends green and independently testable.

## Coverage notes (from /speckit-analyze)

- **FR-017** (no standalone file-type layer) is a **negative** requirement — satisfied by NOT
  building one; T024 guards that nothing sneaks in. No implementation task by design.
- **FR-020** (an AI artifact stays a valid reproducible target; a companion does not demote it) is
  **inherent**: no code here demotes it and the graph is unchanged (FR-018/T024). No behavior task.
- **FR-021** (directory-valued impure output classified from its root) is **forward-compatible and
  blocked on `design:feature/directory-outputs`**: `classifyZone` (T004) accepts a root-relative path
  so it composes when directory outputs land; it is not testable end-to-end until then, so no task
  builds directory-output support here (out of scope per spec).

## Tier distribution (sanity)

- `fast`: T001, T002, T005, T016, T018, T021, T023, T025 (mechanical / small / doc).
- `balanced`: T003, T004, T006, T007, T008, T010, T011, T014, T015, T017, T019, T020, T022 (standard impl/tests).
- `powerful`: T009 (symlink adversarial), T012 (realpath+containment ordering, high blast radius), T013 (build-path refusal wiring), T024 (whole-suite gate).

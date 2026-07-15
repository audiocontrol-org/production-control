# Tasks: Episode Production Contract v0.1

**Feature**: `001-episode-production-contract` | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Created**: 2026-07-15

## Format: `[ID] [P?] [Story] [tier:label] Description`

- **[P]**: parallelizable — different files, no dependency on an incomplete task
- **[US n]**: the user story this task serves (user-story phases only)
- **[tier:label]**: model tier. `fast` → haiku, `balanced` → sonnet, `powerful` → opus

## Path Conventions

Single project, library-with-CLI. Source in `src/`, tests in `tests/`, per
[plan.md](./plan.md) § Project Structure.

## Milestone boundary (structural, not advisory)

**Milestone 1** = Phases 1–5 (US1 + US3). The oracle. No execution, no network.
`src/state/` MUST NOT import `src/providers/` (research R6) — T041 enforces this as a test,
so the boundary fails the build rather than eroding quietly.

**Milestone 2** = Phases 6–8 (US2, US4, US5). Execution, strictly additive.

> **Deviation from plan.md, deliberate.** plan.md placed `pc review --waive` in Milestone 2.
> That is wrong: US3's Independent Test in spec.md requires waiving to be exercisable, so
> US3 could not be independently tested until M2 — contradicting the spec's own claim that
> it is an independent slice. Waiving needs no provider and no store; it is a local ledger
> write. It moves to Milestone 1, which makes US1 and US3 both fully deliverable there.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [tier:fast] Initialize package as an installable TypeScript library with CLI bin entry in `package.json`; add `commander`, `zod`, `yaml`, `@aws-sdk/client-s3`; dev-add `vitest`, `tsx`, `typescript`, `@types/node` (research R1)
- [ ] T002 [tier:fast] Configure `tsconfig.json` with strict mode and the `@/` path alias mapping to `src/`; forbid implicit any (constitution § Technology)
- [ ] T003 [P] [tier:fast] Configure `vitest.config.ts` with unit/integration/contract test projects and the `@/` alias resolution
- [ ] T004 [P] [tier:fast] Add eslint + prettier config banning `any`, `as` type assertions, and `@ts-ignore` (constitution § Technology — the rule must be mechanical, not remembered)
- [ ] T005 [P] [tier:fast] Create the `src/` and `tests/` directory skeleton per plan.md § Project Structure

---

## Phase 2: Foundational (Blocking Prerequisites)

**Blocks every user story. No story work begins until this phase completes.**

### Hashing — the substrate everything else compares against

- [ ] T006 [P] [tier:fast] RED: content-hash tests in `tests/unit/hash/content.test.ts` — same bytes yield same hash; different bytes differ; hash is stable across a file's mtime changing (FR-008)
- [ ] T007 [tier:balanced] Implement sha256 content hashing in `src/hash/content.ts`; expose `Hash` as the opaque `sha256:<hex>` string type used everywhere (data-model.md § Hash)
- [ ] T008 [P] [tier:fast] RED: tree-hash tests in `tests/unit/hash/tree.test.ts` — identical trees hash equal regardless of filesystem iteration order; a renamed file changes the hash; a changed file changes the hash; path separators do not leak into the hash; a symlink is an error (research R3)
- [ ] T009 [tier:powerful] Implement the deterministic tree hash in `src/hash/tree.ts` — byte-ordered POSIX-normalized relative paths, NUL-delimited `<path>\0<contentHash>\0`, symlinks error rather than follow-or-skip (research R3). **High blast radius**: every directory-valued output's identity and every fresh-clone answer (SC-004) depends on this being order- and platform-independent

### Boundary schemas — where `zod` earns its place

- [ ] T010 [P] [tier:fast] RED: schema-refusal tests in `tests/unit/manifest/schema.test.ts` — unknown document `version` is refused not best-effort parsed; duplicate identity refused; `follows` on a derived node refused; empty/whitespace waiver reason refused (FR-005, FR-022b)
- [ ] T011 [tier:balanced] Define `zod` schemas for EpisodeManifest, AuthoredDecl, Profile, TargetDecl, ProviderDecl in `src/manifest/schema.ts` — the manifest declares identity, recipe, authored inputs, and targets; an authored decl may declare `follows` (FR-001, FR-018, data-model.md § Entities)
- [ ] T012 [tier:balanced] Define `zod` schemas for Ledger, ArtifactRecord, Waiver, AssetPointer in `src/ledger/schema.ts` and `src/assets/pointer.ts` (data-model.md § Entities)
- [ ] T013 [tier:balanced] Implement manifest + profile loading in `src/manifest/load.ts` — parse through `zod`, throw naming the offending path; no casts anywhere downstream (research R2, FR-036)

### Graph

- [ ] T014 [P] [tier:fast] RED: graph-validation tests in `tests/unit/graph/validate.test.ts` — cycle refused and named; dangling `inputs` reference refused; `follows` naming a non-existent identity refused; unknown target refused (FR-005)
- [ ] T015 [tier:balanced] Implement graph construction in `src/graph/build.ts` — resolve identities across authored ∪ profile targets; classify each node authored vs derived (FR-002, FR-003)
- [ ] T016 [tier:balanced] Implement graph validation in `src/graph/validate.ts` — cycle detection, duplicate identity, dangling references, `follows`-on-derived (FR-005)

### Test fixtures and doubles — prerequisites, not afterthoughts

- [ ] T017 [P] [tier:fast] Create fixture episodes `minimal`, `blocked`, `chain` in `tests/fixtures/` with tiny synthetic files and stable known hashes (data-model.md § Fixture episodes)
- [ ] T018 [P] [tier:fast] Create fixture episodes `advisory`, `dual-signal`, `tree-output`, `cycle`, `asset` in `tests/fixtures/`
- [ ] T019 [P] [tier:fast] Author `profiles/editorial-audio.yaml` — the v0.1 recipe: `{website,epub} ← [longform, assets]`, `voiceover ← [narration]`, `podcast ← [voiceover]`, `transcript ← [narration, spoken]`; nothing subject-specific (FR-004, SC-011, Principle VII)
- [ ] T020 [P] [tier:balanced] Implement the fake provider in `tests/fixtures/fake-provider` — reads a BuildRequest, emits deterministic bytes derived from its inputs, returns a well-formed BuildResponse; runnable by hand with no ffmpeg, no network, no bucket (contracts/provider.md § Test double, SC-007)
- [ ] T021 [P] [tier:fast] Implement the in-memory `AssetStore` double in `tests/fixtures/memory-store.ts` (research R5)

**Checkpoint**: hashing, schemas, graph, and fixtures exist. User stories may begin.

---

## Phase 3: User Story 1 — Know the true state of a production (Priority: P1) 🎯 MVP

**Goal**: An agent asks what is true and gets every node, its state, and *why* — offline, with no craft tools, and identically in a fresh clone.

**Independent test**: Point at `tests/fixtures/blocked` with networking disabled and no craft tools on PATH; every node reports a state and a cause.

### Tests for User Story 1

- [ ] T022 [P] [US1] [tier:fast] RED: freshness tests in `tests/unit/state/freshness.test.ts` — recorded inputs match → fresh; content differs → stale naming the input; never built → missing; `touch` alone never causes staleness (FR-008, quickstart S3)
- [ ] T023 [P] [US1] [tier:fast] RED: state-model tests in `tests/unit/state/resolve.test.ts` — an authored node has no `stale` state; `blocked` outranks `stale`; `absent` outranks `needs-review`; validation absent ≠ passed ≠ failed (FR-006, FR-006a, FR-006b, FR-022c)
- [ ] T024 [P] [US1] [tier:fast] RED: cause-completeness test in `tests/unit/state/resolve.test.ts` — no node may report a state without a cause (FR-007, quickstart S2)
- [ ] T025 [P] [US1] [tier:fast] RED: transitive staleness test in `tests/integration/chain.test.ts` — changing an upstream output's content restales everything downstream at any depth (FR-009, SC-003, quickstart S5)
- [ ] T026 [P] [US1] [tier:fast] RED: fresh-clone determinism test in `tests/integration/clone.test.ts` — identical answers with `dist/` absent and mtimes rewritten; origin records stay meaningful with the built bytes gone (FR-015, SC-002, SC-004, quickstart S4)
- [ ] T027 [P] [US1] [tier:fast] RED: offline test in `tests/integration/offline.test.ts` — the full status suite passes with network access denied (FR-010, FR-025, SC-001, quickstart S10)
- [ ] T028 [P] [US1] [tier:fast] RED: advisory-detection tests in `tests/integration/advisory.test.ts` — a followed node's change raises `needs-review` naming it; never `stale`; never a rebuild (FR-019, FR-020, quickstart S6)
- [ ] T029 [P] [US1] [tier:fast] RED: release-check tests in `tests/integration/release.test.ts` — releasable only when all targets fresh AND all validations passed AND no unwaived review; every negative names what blocks (FR-012, SC-005)
- [ ] T030 [P] [US1] [tier:fast] RED: pointer-guard tests in `tests/unit/assets/pointer.test.ts` — a malformed stand-in fails loud; an untracked over-threshold file with no stand-in fails loud; **status does NOT attempt to verify store existence** (FR-025, FR-026, spec § Edge Cases)

### Implementation for User Story 1

- [ ] T031 [US1] [tier:balanced] Implement ledger reading in `src/ledger/store.ts` — parse through `zod`; absent ledger is a valid empty state, not an error (data-model.md § Ledger)
- [ ] T032 [US1] [tier:balanced] Implement asset-pointer reading and the FR-026 guard in `src/assets/pointer.ts` — validate well-formedness only; the content address is in the pointer, so nothing needs fetching; configurable size threshold with a stated default (FR-025, FR-026)
- [ ] T033 [US1] [tier:powerful] Implement freshness in `src/state/freshness.ts` as a declarative consistency check — rehash declared inputs, compare against the ledger's recorded hashes. **Do NOT implement a propagation pass**: transitive staleness is emergent from content addressing, and writing propagation logic is a bug (FR-008, FR-009)
- [ ] T034 [US1] [tier:powerful] Implement state resolution in `src/state/resolve.ts` — states by node kind, `blocked` > `stale` precedence, validation as a recorded fact rather than a state, advisory `needs-review` detection, and a cause attached to every state. **Cross-cutting and subtle**: FR-006/006a/006b/007/020/022c all land here
- [ ] T035 [US1] [tier:balanced] Implement release readiness in `src/state/release.ts` — fresh ∧ validated ∧ no unwaived review; name every blocker (FR-012)
- [ ] T036 [US1] [tier:balanced] Implement the frontier query in `src/state/frontier.ts` — actionable nodes only, excluding `blocked` (a blocked node is not actionable; its absent input is) (FR-011)
- [ ] T037 [P] [US1] [tier:balanced] Implement `pc status` in `src/cli/status.ts` — `--json` primary, always exit 0, every node carries its cause (contracts/cli.md)
- [ ] T038 [P] [US1] [tier:balanced] Implement `pc next` in `src/cli/next.ts` — renders the *action* (so "unvalidated" appears without being a state), always exit 0 (contracts/cli.md, FR-006b)
- [ ] T039 [P] [US1] [tier:balanced] Implement `pc release-check` in `src/cli/release-check.ts` — exit 1 when not releasable, naming blockers (contracts/cli.md)
- [ ] T040 [US1] [tier:balanced] Wire the `commander` CLI root in `src/cli/index.ts` — every read verb offers `--json` and exits 0 even when reporting problems; gates fail distinguishably; usage errors exit 2 (FR-035, contracts/cli.md)
- [ ] T041 [US1] [tier:powerful] Add the milestone-boundary test in `tests/unit/architecture.test.ts` — assert no module under `src/state/`, `src/graph/`, or `src/manifest/` transitively imports `src/providers/` or `src/assets/s3.ts`. **This is what makes research R6 real**: without it the boundary is a comment, and FR-010's "no network, no craft tools" holds by discipline rather than by construction

**Checkpoint**: US1 is independently demonstrable. `pc status` answers correctly, offline, with nothing installed. **This is the MVP.**

---

## Phase 4: User Story 3 — Surface drift between authored work and a recording of it (Priority: P3)

**Goal**: Revising a script raises `needs-review` on its recorded performance; a human waives it with a reason; the waiver is durable and applies only to the change it was recorded against.

**Independent test**: `tests/fixtures/advisory` — change the script, confirm `needs-review`; waive; confirm cleared; change again; confirm it re-raises.

> Ordered before US2 because it completes Milestone 1 and needs no execution.

### Tests for User Story 3

- [ ] T042 [P] [US3] [tier:fast] RED: waiver tests in `tests/integration/waiver.test.ts` — waiving with a reason clears `needs-review`; the reason is recorded; a subsequent change to the tracked node re-raises it; the production is not releasable until a human decides (FR-021, FR-022, SC-006, quickstart S6)
- [ ] T043 [P] [US3] [tier:fast] RED: waiver-refusal test — an empty or whitespace-only reason is refused (FR-022b)
- [ ] T044 [P] [US3] [tier:powerful] RED: **dual-signal independence** tests in `tests/integration/dual-signal.test.ts` — using `tests/fixtures/dual-signal`, changing `spoken` raises `needs-review` on `narration` AND `stale` on `transcript`; rebuilding `transcript` does NOT clear the review; waiving the review does NOT change `transcript`'s state (FR-022a, quickstart S7). **The subtlest requirement in the spec** — this is where one signal most easily swallows the other

### Implementation for User Story 3

- [ ] T045 [US3] [tier:balanced] Implement ledger waiver writing in `src/ledger/store.ts` — persist `waived_hash`, `reason`, `at`; refuse an empty reason (FR-021, FR-022b)
- [ ] T046 [US3] [tier:powerful] Implement waiver evaluation in `src/state/resolve.ts` — `needs-review` is raised when the tracked node's current hash differs from `waived_hash`. **Storing a boolean instead would silently swallow every later revision** — the exact false-clean the advisory edge exists to prevent (FR-022)
- [ ] T047 [US3] [tier:balanced] Implement `pc review <node> --waive --reason` in `src/cli/review.ts` — `--reason` required, usage error exits 2 (contracts/cli.md)

**Checkpoint**: **Milestone 1 complete.** US1 and US3 both independently demonstrable with no provider, no store, no network.

---

## Phase 5: User Story 2 — Build an output and record its origin inseparably (Priority: P2)

**Goal**: `pc build` runs the craft tool and records provenance in the same act, with no path that does one without the other.

**Independent test**: Build a target with the fake provider; the ledger names each input hash, the tool, and its version; no flag or verb avoids recording.

### Tests for User Story 2

- [ ] T048 [P] [US2] [tier:fast] RED: provider-contract conformance tests in `tests/contract/provider.test.ts` — a well-formed BuildResponse is accepted; exit non-zero is failure; zero outputs is failure; an undeclared output is failure (FR-033, contracts/provider.md)
- [ ] T049 [P] [US2] [tier:fast] RED: build-records-provenance tests in `tests/integration/build.test.ts` — a successful build writes inputs-as-hashed, tool, and version; a failed build writes no record claiming success (FR-013, FR-017)
- [ ] T050 [P] [US2] [tier:fast] RED: indivisibility test in `tests/integration/build.test.ts` — assert the CLI exposes no `--no-record` flag and no `record` verb (FR-014, SC-009, quickstart S8)
- [ ] T051 [P] [US2] [tier:fast] RED: missing-provider test — building a target whose tool is unavailable fails naming it, and does not skip or substitute (FR-036, spec § Edge Cases)
- [ ] T052 [P] [US2] [tier:fast] RED: provider-runnable-by-hand test in `tests/contract/provider.test.ts` — the fake provider produces outputs when piped a BuildRequest with no production-control present (FR-031, SC-008, quickstart S11)

### Implementation for User Story 2

- [ ] T053 [US2] [tier:balanced] Define BuildRequest/BuildResponse `zod` schemas in `src/providers/contract.ts` (contracts/provider.md)
- [ ] T054 [US2] [tier:powerful] Implement the provider runner in `src/providers/run.ts` — subprocess, JSON on stdin, JSON on stdout, stderr as diagnostics; treat non-zero exit, zero outputs, or undeclared outputs as failure. **The architecture's boundary**: it must never branch on which tool it is invoking (Principle IV, FR-033)
- [ ] T055 [US2] [tier:powerful] Implement `pc build` in `src/cli/build.ts` — resolve inputs to local paths, invoke the provider, hash the outputs **itself** rather than trusting the provider's claim, ingest, write the ledger — all in one invocation with no alternative path (FR-014, FR-030, contracts/provider.md)
- [ ] T056 [US2] [tier:balanced] Record `producer_impure` from the provider's declaration and `built_at` as ISO-8601 UTC; ensure `built_at` is never read by any decision (FR-032, research R7)
- [ ] T057 [US2] [tier:balanced] Implement producer version-drift reporting in `src/state/resolve.ts` — report the change; never auto-stale on it (FR-016)
- [ ] T058 [P] [US2] [tier:balanced] Implement `pc validate` in `src/cli/validate.ts` — record the verdict; exit 1 on invalid (FR-006b, contracts/cli.md)

**Checkpoint**: US2 independently demonstrable with the fake provider.

---

## Phase 6: User Story 4 — Large assets outside version control (Priority: P4)

**Goal**: Bytes live in a content-addressed store; a small stand-in is committed; status stays offline.

**Independent test**: Add an asset, confirm the stand-in is what is committed, confirm identical bytes are a no-op, confirm status works with the store unreachable.

### Tests for User Story 4

- [ ] T059 [P] [US4] [tier:fast] RED: content-addressing tests in `tests/unit/assets/store.test.ts` — identical bytes are a no-op; different bytes are a distinct address; a stored asset is immutable (FR-024, FR-028)
- [ ] T060 [P] [US4] [tier:fast] RED: asset-add tests in `tests/integration/asset.test.ts` — a stand-in is written beside the file carrying the address, media type, and size (FR-023)
- [ ] T061 [P] [US4] [tier:fast] RED: absent-asset test — an operation that needs the bytes fails loud naming the asset and its address; **status does not** (FR-036, spec § Edge Cases)
- [ ] T062 [P] [US4] [tier:balanced] RED: S3 adapter contract test in `tests/contract/s3-store.test.ts` against MinIO via testcontainers; **the skip announces itself loudly** when Docker is absent — a silent skip is a false-clean (research R5, FR-027, SC-010)

### Implementation for User Story 4

- [ ] T063 [US4] [tier:balanced] Define the `AssetStore` interface in `src/assets/store.ts` — constructor DI, interface-first; the in-memory double already satisfies it (constitution § Technology)
- [ ] T064 [US4] [tier:balanced] Implement the S3-compatible adapter in `src/assets/s3.ts` using `@aws-sdk/client-s3` with a configurable endpoint; the backend is a config value, never an architectural commitment (FR-027, research R1)
- [ ] T065 [US4] [tier:balanced] Implement the local read-through cache in `src/assets/cache.ts` writing to `.production/cache/` (gitignored)
- [ ] T066 [US4] [tier:balanced] Implement input resolution in `src/assets/resolve.ts` — store → cache → local path, so providers receive only local paths and never credentials (FR-030)
- [ ] T067 [US4] [tier:balanced] Implement `pc asset add` in `src/cli/asset.ts` — hash, upload-if-absent, write the stand-in (FR-023, FR-024)

---

## Phase 7: User Story 5 — Replace a craft tool without invalidating the production (Priority: P5)

**Goal**: The graph, contracts, and records survive any tool being swapped.

**Independent test**: Rebind a target to a different tool; the structure and prior records stay valid; the change is reported, not silently ignored.

- [ ] T068 [P] [US5] [tier:fast] RED: tool-swap test in `tests/integration/swap.test.ts` — rebinding a target to a different provider leaves the graph and existing records valid; version drift is reported and does not by itself stale (FR-016, FR-034)
- [ ] T069 [US5] [tier:balanced] Verify and, where needed, correct that no module encodes a specific provider's behavior; the runner treats every tool identically (FR-034, Principle VI)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T070 [P] [tier:fast] Add `npm run test:offline` and `npm run test:integration:store` scripts backing quickstart S9/S10
- [ ] T071 [P] [tier:fast] Verify every source file is under 500 lines; decompose any that is not (constitution § Technology)
- [ ] T072 [P] [tier:balanced] Author `README.md` usage for the CLI surface and the provider contract, linking contracts/ rather than restating it
- [ ] T073 [P] [tier:fast] Add `examples/` fixture episode with a note that it is a fixture and that authored content never lives in this repository (Principle VII)
- [ ] T074 [tier:powerful] Walk all 12 quickstart scenarios end-to-end and confirm each behaves as written; treat any divergence as a defect in the code or the spec, not as a scenario to reword

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → blocks everything
- **Phase 2 (Foundational)** → blocks all user stories
- **Phase 3 (US1)** → the MVP; depends only on Phase 2
- **Phase 4 (US3)** → depends on Phase 3 (reuses `src/state/resolve.ts`). **Completes Milestone 1**
- **Phase 5 (US2)** → depends on Phase 2; **begins Milestone 2**
- **Phase 6 (US4)** → depends on Phase 5 (input resolution feeds the provider runner)
- **Phase 7 (US5)** → depends on Phase 5
- **Phase 8 (Polish)** → last

### User Story Dependencies

- **US1** — independent. Deliverable alone.
- **US3** — extends US1's state resolver; needs no execution or store.
- **US2** — independent of US1's CLI, but shares the foundational layer.
- **US4** — needs US2's runner to demonstrate the local-path resolution rule.
- **US5** — proven by US2 existing; mostly verification.

### Parallel Opportunities

All `[P]` RED-test tasks within a phase run together — they touch different files and depend
on nothing incomplete. T017–T021 (fixtures, profile, doubles) are fully parallel. T037–T039
(the three read verbs) are parallel once T033–T036 land.

---

## Implementation Strategy

### MVP first (User Story 1 only)

Phases 1 → 2 → 3 delivers the oracle: `pc status`, `pc next`, `pc release-check`, offline,
with no craft tools and no bucket. This is genuinely useful against a production that is
half-authored and has never been built — which is the design's whole argument for
sequencing the graph ahead of execution.

**Stop here and validate before starting Milestone 2.** If the oracle is wrong, everything
built on it inherits the error.

### Incremental delivery

1. **Milestone 1**: Phases 1–4 (US1 + US3). The oracle plus advisory drift. No execution.
2. **Milestone 2**: Phases 5–7 (US2, US4, US5). Execution, strictly additive.
3. **Polish**: Phase 8.

### Tier distribution

74 tasks, per `stackctl resolve-tiers`: **36 `fast`** (RED tests, fixtures, scaffolding),
**29 `balanced`** (standard implementation), **9 `powerful`**.

The nine `powerful` tasks are the tree hash (T009), freshness (T033), state resolution
(T034), the milestone-boundary test (T041), dual-signal independence (T044), waiver
evaluation (T046), the provider runner (T054), `pc build` (T055), and the quickstart walk
(T074) — each cross-cutting, subtle, or high-blast-radius. Everything else earns a cheaper
tier, which is the point of tagging rather than defaulting.

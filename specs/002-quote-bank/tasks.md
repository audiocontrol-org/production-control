# Tasks: Quote bank

**Input**: Design documents from `specs/002-quote-bank/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: TDD is binding (constitution). RED test tasks precede the implementation
tasks that make them pass, and are separate tasks.

## Format: `[ID] [P?] [Story?] [tier:label] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency).
- **[Story]**: US1/US2/US3 (story-phase tasks only).
- **[tier:label]**: `fast` (haiku) / `balanced` (sonnet) / `powerful` (opus).

All code lives in a NEW `editorial-tooling/` package (own package.json, plain ESM
`.mjs`, `node --test`), separate from production-control `src/` (which is UNTOUCHED).

---

## Phase 1: Setup

- [ ] T001 [tier:fast] Create the `editorial-tooling/` package: `package.json`
  (`type: module`, `test: node --test`, bin `quote-validator`/`quote-miner`), and the
  `src/`, `bin/`, `test/`, `test/fixtures/` directories. (plan.md structure; FR-022)

---

## Phase 2: Foundational (blocking prerequisites)

- [ ] T002 [P] [tier:fast] Synthetic fixture sources under
  `editorial-tooling/test/fixtures/sources/` — a few tiny UTF-8 documents with
  filename-stem ids (one with a repeated passage, one with an OCR error, one with
  non-adjacent quotable passages). Shared by US1 and US2. (FR-001, FR-018)

---

## Phase 3: User Story 1 — the deterministic validator (Priority: P1) 🎯 MVP

**Goal**: An independent, deterministic validator that accepts a faithful quote bank
and rejects any structurally invalid or unfaithful one, naming each defect.
**Independent test**: run `bin/quote-validator.mjs` against hand-written bank fixtures
(no miner); it passes the valid bank and fails each bad one. (quickstart S1–S3)

### RED tests (US1)

- [ ] T003 [P] [US1] [tier:fast] RED: hand-written bank fixtures under
  `test/fixtures/banks/` — valid; fabricated span; reconstruction-mismatch
  (undisclosed alteration); out-of-set edit; multi-span ellipsis join; ambiguous
  `ocr-fix`; overlapping `ocr-fix`; edit → nonexistent span; duplicate quote id;
  empty span list; unresolvable source; unknown version; empty bank; location-ambiguous
  repeated span. (data-model.md; FR-005/007/009/010)
- [ ] T004 [US1] [tier:fast] RED: `test/validator.test.mjs` — structural pre-check
  rejects each malformed fixture BEFORE fidelity (FR-007); fidelity accepts the valid
  bank and the empty bank; rejects the fabricated span and the out-of-set edit;
  reports a reconstruction MISMATCH with the first differing byte (never an inferred
  op) for the altered fixture (FR-009); flags the location-ambiguous span but still
  passes it (FR-010); byte-for-byte, UTF-8 exact, no normalization (FR-001/002).
- [ ] T005 [US1] [tier:fast] RED: `test/validator-bin.test.mjs` — pipe a ValidateRequest
  to `bin/quote-validator.mjs`; assert a well-formed ValidateResponse
  (`passed` / `failed`+`errors` naming quotes by id); a malformed request or unreadable
  source → non-zero exit, stderr, and NO `passed`. (contracts/quote-validator.md; SC-002/003)

### Implementation (US1)

- [ ] T006 [US1] [tier:balanced] `src/schema.mjs` — parse the YAML bank; the structural
  validity pre-check (version, required fields, non-empty spans, unique quote id,
  edit→span references, ellipsis-join count = spans−1 over consecutive pairs,
  ocr-fix non-overlap/disambiguation). Fail loud naming the defect. (FR-007; data-model.md)
- [ ] T007 [US1] [tier:powerful] `src/edits.mjs` — the closed edit set and the
  **deterministic reconstruction algorithm**: apply `ocr-fix` (span/before/after/optional
  `at`) then `ellipsis-join` (between/separator) in declared order over the spans' raw
  bytes; return the reconstructed bytes and, on mismatch with `text`, the first differing
  byte offset. Byte-exact; no normalization. (FR-005/024; data-model.md)
- [ ] T008 [US1] [tier:balanced] `src/validator.mjs` — the source-id mapping
  (filename stem, unambiguous; duplicate/case-colliding/invalid → fail before any quote,
  FR-018); the four fidelity checks over every quote (source resolves; span.raw is an
  exact substring; reconstruction reproduces text; closed edit set); the
  location-ambiguity advisory. Reads only; mutates nothing. (FR-008/009/010/011)
- [ ] T009 [US1] [tier:balanced] `bin/quote-validator.mjs` — the ValidateRequest→
  ValidateResponse entrypoint over `src/validator.mjs`: `passed` only if structurally
  valid AND every quote passes; else `failed` with each violation named by quote id;
  no verdict → non-zero exit. Runnable by hand. (contracts/quote-validator.md)

**Checkpoint (US1 done, MVP)**: `node --test` green; a bank produced by any means can
be trusted or rejected. quickstart S1–S3 pass.

---

## Phase 4: User Story 2 — the impure miner (Priority: P2)

**Goal**: Build a quote bank from a source directory: an LLM selects, the tool grounds
by copying exact bytes, ungroundable selections are omitted; declared impure, no
self-verdict. **Depends on US1** (the validator gates its output).
**Independent test**: run the miner over the fixture corpus; feed its output to the US1
validator; it is accepted. (quickstart S4)

### RED tests (US2)

- [ ] T010 [P] [US2] [tier:fast] RED: `test/miner.test.mjs` (INJECTED FAKE model) —
  grounding: a passage present in a source → the exact byte span is extracted; a passage
  the fake model invents (not present) → OMITTED and counted in the report (FR-014;
  SC-004). Schema emission produces a bank the REAL validator accepts. Source-id mapping
  and mapping-failure (duplicate/invalid id → fail before any quote, FR-018).
- [ ] T011 [US2] [tier:fast] RED: `test/miner-bin.test.mjs` (fake model) — pipe a
  BuildRequest to `bin/quote-miner.mjs`; assert a single-output BuildResponse declaring
  `impure` and reporting NO `validation` (FR-013); a machine-readable mining report on
  STDERR (FR-017); a source-level failure (unreadable/non-UTF-8) or model failure → the
  run fails, no bank emitted (FR-015/016). (contracts/quote-miner.md)

### Implementation (US2)

- [ ] T012 [US2] [tier:balanced] `src/claude.mjs` — the `claude` CLI adapter (spawn,
  prompt in, selection out), injectable so `miner.mjs` is testable with a fake. (R4)
- [ ] T013 [US2] [tier:powerful] `src/miner.mjs` — selection prompt; **grounding**
  (locate the model's pointer in the source, snap to the exact byte span, record raw +
  disclosed closed-set edits; OMIT the ungroundable); assemble the bank via `schema.mjs`;
  emit the mining report to stderr. Fail loud on source/model failure; never a partial
  bank. (FR-012/014/015/017)
- [ ] T014 [US2] [tier:balanced] `bin/quote-miner.mjs` — the BuildRequest→BuildResponse
  entrypoint: exactly one output (the bank), `impure` declared with the model identity in
  `tool.version` (FR-020), NO validation verdict, atomic (complete bank only on success).
  (contracts/quote-miner.md; FR-013/016)
- [ ] T015 [US2] [tier:balanced] Live by-hand run: pipe a real BuildRequest over the
  fixture corpus through `bin/quote-miner.mjs` (spawns `claude`); feed its bank to
  `bin/quote-validator.mjs`; confirm accepted and every quote attributed. (quickstart S4)

**Checkpoint (US2 done)**: the miner produces validator-accepted banks; fabricated
selections never appear; the report shows selected/grounded/omitted.

---

## Phase 5: User Story 3 — orchestration & lifecycle (Priority: P3)

**Goal**: `quote-bank ← [sources]` as a production-control derived target with the
validator; regeneration is editorial, not freshness. **Depends on US1/US2.**
**Independent test**: in a proving-ground episode, `pc build` then `pc validate`, and the
drift/staleness semantics hold. (quickstart S5–S6)

- [ ] T016 [US3] [tier:balanced] Proving-ground episode (in the nouvelle-france trial):
  a `sources/` directory input and a `quote-bank` target whose profile binds the provider
  to `bin/quote-miner.mjs` and the `validator` to `bin/quote-validator.mjs`. (quickstart S5)
- [ ] T017 [US3] [tier:balanced] Exercise end-to-end: `pc build quote-bank` → a bank
  under `ai-generated/`, ledger records producer + impurity + input hash, node NOT
  validated; `pc validate quote-bank` → the independent validator records `passed`;
  `pc status` → `fresh` + `validated: passed`. (quickstart S5; FR-013)
- [ ] T018 [US3] [tier:balanced] Lifecycle: change a source file → bank reported `stale`;
  change only the miner `tool.version` → producer drift reported, bank stays `fresh`
  (not auto-restaled); regeneration is a deliberate `pc build`. (quickstart S6;
  FR-019/020/021)

---

## Phase 6: Polish & cross-cutting

- [ ] T019 [P] [tier:fast] `editorial-tooling/README.md` — what it is, the two tools,
  running each by hand, the schema (link data-model.md). No production-control coupling.
- [ ] T020 [tier:fast] Verify: every file < 500 lines; `node --test` green; no fallbacks
  or mock data outside tests; no subject knowledge in any tool (SC-005). Confirm
  production-control `src/` is untouched.

---

## Dependencies & story order

- Setup (T001) → Foundational (T002) → US1 (T003–T009) → US2 (T010–T015) → US3
  (T016–T018) → Polish (T019–T020).
- **US1 is the MVP** and is deliverable/testable alone. US2 depends on US1 (its output is
  gated by the US1 validator). US3 depends on US1+US2.
- Within US1: RED tests (T003–T005) before impl (T006–T009); `edits.mjs` (T007) and
  `schema.mjs` (T006) before `validator.mjs` (T008) before the bin (T009).
- Within US2: RED tests (T010–T011) before impl (T012–T014) before the live run (T015);
  `claude.mjs` (T012) before `miner.mjs` (T013) before the bin (T014).

## Parallel opportunities

- T002 and T003 (fixtures) are `[P]`.
- Within US1 RED, T004/T005 can be authored in parallel with T003 fixtures once shapes are
  fixed.
- T010/T011 (US2 RED) are independent of US1 impl once the validator exists.

## Implementation strategy

Ship **US1 first** — the deterministic validator is the trust anchor and independently
valuable (it validates any bank, however produced). Then US2 (the miner, gated by US1),
then US3 (orchestration). The reconstruction algorithm (T007) is the crux — build it
byte-exact and test-first.

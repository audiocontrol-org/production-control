# Quickstart / Validation Guide: Voice compose-from-spine

Runnable scenarios that prove compose mode works end-to-end. Details live in the contracts + data-model; this is the run/validate guide.

## Prerequisites

- The `voice-tooling` package builds and its suite is green (`vitest`).
- A deterministic model command for tests (a stub that echoes a fixed `{edition, coverage, grounding}` JSON), wired as the producer's model — no live model needed for the deterministic scenarios.
- Fixtures under `voice-tooling/src/__tests__/fixtures/` (or the package's fixtures dir): a small **spine** (2–3 beats carrying a citation + a numeral, one optional open-question marker) and a **voice** document.

## Scenario 1 — Compose a faithful chapter (SC-001, US1)

1. Run `voice compose` with the deterministic model over the fixture spine + voice.
2. **Expect**: an edition is emitted under a dot-zoned path; its frontmatter ledger is `mode: compose` with one `grounding` record per edition unit; every citation + numeral from each beat appears byte-exact in its represented destination.
3. Run `voice fidelity` over the emitted edition (no `requested_mode`).
4. **Expect**: PASS; report shows `mode: compose`, `mode_comparison: none-supplied`, `spine_source_fidelity: not-checked`, `composition_semantic_grounding: not-checkable`.

## Scenario 2 — Undeclared invention is refused (SC-002, US2)

1. Feed the validator a composed edition whose ledger omits a grounding record for one edition unit (a silently added paragraph).
2. **Expect**: FAIL naming the unaccounted edition unit.
3. Feed a grounding record referencing a nonexistent edition-unit index.
4. **Expect**: FAIL naming the dangling record.

## Scenario 3 — Compose never copies (SC-003, US3)

1. Feed a compose ledger containing an `op: verbatim` entry → **Expect**: FAIL (verbatim illegal in compose).
2. Feed a compose ledger containing an `op: cut` entry → **Expect**: FAIL (cut illegal in compose v1).
3. Compose a destination unit byte-identical to a complete beat → **Expect**: FAIL (`whole-unit copy`).

## Scenario 4 — Revise verbatim-drift refused pre-emit (SC-004, US4, TASK-50)

1. Run `voice revise` with a deterministic model that declares a unit `verbatim` but alters its bytes.
2. **Expect**: the producer refuses at pre-emit (byte-mismatch), names the drifted unit, and writes **no** edition.
3. Re-validate one of the 54 already-shipped revise editions.
4. **Expect**: still PASS (no grounding requirement on revise; `mode` defaults to `revise`) — SC-006.

## Scenario 5 — Mode cannot be forged (SC-005, US5)

1. Run `voice fidelity` with `requested_mode: compose` against a ledger stamped `mode: revise`.
2. **Expect**: FAIL (`mode mismatch`) before any op-legality check.
3. Run standalone (no `requested_mode`) against the same ledger.
4. **Expect**: validates per `ledger.mode: revise`; report `mode_comparison: none-supplied`.

## Scenario 6 — Overclaim regression protection (SC-007)

1. Compose an edition where all payload survives and every unit is grounded/connective, but a `connective` paragraph invents a causal claim.
2. **Expect**: PASS deterministically; report states `composition_semantic_grounding: not-checkable`. (The gate proves accounting + evidence, not truth — this test guards against a future change that would wrongly claim semantic detection.)

## Suite gate

- `vitest` green (new + existing tests); the full existing revise/fidelity suite unchanged and passing (SC-006).
- Typecheck/lint clean; no file over 500 lines (verify `model.ts` shrank after the prompt extraction).

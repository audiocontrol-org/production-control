# Quickstart: Content zone segregation

Runnable validation scenarios that prove the feature works end-to-end. Uses the existing in-memory /
fake-provider harness (Constitution: Test-Driven — no bucket, no craft tools). Implementation detail
lives in `tasks.md`; this is the run/verify guide.

## Prerequisites

- `npm install`
- `npm test` and `npm run typecheck` green on the branch.

## Scenario 1 — Impure output lands in the dot-zone, not a human path (US1)

1. Define an **impure** target with a fake provider emitting deterministic bytes.
2. `pc build <target>`.
3. **Expect**: the artifact is committed under **`.ai/…`** (not `ai-generated/`, not `dist/`); the
   ledger records it; `classifyZone` of its path is `ai-permitted`.

## Scenario 2 — Impure output aimed at a human path is refused (US1)

1. Arrange an impure output whose resolved destination is dot-free (human-safe).
2. `pc build <target>`.
3. **Expect**: refusal (non-zero), message **names the path**; no bytes are committed.

## Scenario 3 — Pure declaration that returns impure is refused (US1, FR-012)

1. Fake provider **declared pure** but returns `impure` in its `BuildResponse`.
2. `pc build <target>`.
3. **Expect**: refusal, **naming the target** (contradictory provenance metadata; fail-loud). No silent
   reclassification.

## Scenario 4 — Symlink cannot defeat zoning (US1, FR-010/D5c)

1. Impure output is a symlink whose lexical path is dot-zoned but whose **real target** resolves into a
   human-safe path.
2. `pc build <target>`.
3. **Expect**: refusal — classification runs on the `realpath`-resolved destination.

## Scenario 5 — Provider escape is caught before zoning (US1, FR-009)

1. Provider returns a path escaping its assigned output dir (`../../x.md`).
2. `pc build <target>`.
3. **Expect**: rejected as a containment/escape violation **regardless of impurity**, before zoning is
   evaluated.

## Scenario 6 — Zone is readable from the path alone (US2)

1. Apply `classifyZone` to the golden set in `contracts/zone-classifier.md`.
2. **Expect**: each path resolves to the specified zone — including basename-only (`dist/.draft.md` →
   human-safe), nested dot (`dist/target/.ai/out.md` → ai-permitted), and identical treatment of
   `.cache`/`.tmp`/`.ai`.

## Scenario 7 — Authored content is refused from an AI zone (US2, FR-006/D2b)

1. Declare an **authored** node whose path is under a dot-zone.
2. `pc validate` / `pc build` (whichever surfaces graph validation).
3. **Expect**: refusal (authored must be human-safe); an authored node under a human-safe path is
   accepted.

## Scenario 8 — Routing audit catches a mis-routed target, honestly (US3)

1. Manifest with one impure target whose assigned root is dot-free (or an authored node in a dot-zone).
2. `pc <audit-verb> --json`.
3. **Expect**: non-zero exit; the offending target is named; the report states that runtime filenames
   and provider escape are checked only at build time. A clean manifest exits 0.

## Regression / migration check

- Confirm the `ai-generated/` → `.ai/` rename is reflected in fixtures and the existing quickstart
  (`specs/001-…`, `002-…` scenarios) so no test still expects `ai-generated/`.
- Confirm an accidental in-place edit to a `.ai/` artifact still reports `modified` (this feature does
  NOT protect those bytes — FR-024; TASK-15 remains open).

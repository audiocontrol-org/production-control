# Quickstart: Quote bank

Runnable scenarios that prove the capability end-to-end. Details live in
`contracts/` and `data-model.md`; this is the validation guide.

## Prerequisites

- Node (macOS/Linux); the `editorial-tooling` package installed (`node --test`
  runnable).
- For the live miner scenario only: the `claude` CLI on PATH. The validator needs
  neither a model nor a network.

## Scenario S1 — The validator accepts a faithful bank (US1, P1)

1. A fixture source and a hand-written bank whose every quote's `raw` is a verbatim
   substring and whose `edits` reproduce each `text`.
2. Pipe a ValidateRequest (`contracts/quote-validator.md`) to
   `bin/quote-validator.mjs`.
3. **Expect**: `{ "state": "passed" }`, exit 0.

## Scenario S2 — The validator rejects fabrication and alteration (US1; SC-002)

For each of a bank with a fabricated span, one with an undisclosed alteration, and
one using an out-of-set edit:

1. Pipe the ValidateRequest to `bin/quote-validator.mjs`.
2. **Expect**: `{ "state": "failed", "errors": [ … ] }` naming the offending quote,
   exit 0 (the validator answered) — and, run under `pc validate quote-bank`, a
   non-zero gate exit.

## Scenario S3 — Determinism (SC-003)

1. Run S1 twice.
2. **Expect**: byte-identical ValidateResponse both times; no network access occurs.

## Scenario S4 — The miner grounds selections and omits the ungroundable (US2; SC-004)

1. A tiny fixture corpus (2–3 short sources).
2. Pipe a BuildRequest (`contracts/quote-miner.md`) to `bin/quote-miner.mjs` (live —
   spawns `claude`).
3. **Expect**: a `quote-bank.yaml` whose every quote passes `bin/quote-validator.mjs`;
   the BuildResponse declares `impure` and reports **no** validation. A passage the
   model names but that is not exactly in a source does not appear in the bank.

## Scenario S5 — Orchestrated build + independent gate (US2/US3)

In a proving-ground episode with a `sources` input and a `quote-bank` target wired
to the miner (provider) and validator (`validator`):

1. `pc build quote-bank` → a real bank under `ai-generated/`; the ledger records the
   producer, its impurity reason, and the input hash; the node is **not validated**
   (the miner reported no verdict).
2. `pc validate quote-bank` → the independent validator decides; on a faithful bank,
   `passed` is recorded.
3. **Expect**: `pc status` shows the bank `fresh` and `validated: passed`.

## Scenario S6 — Regeneration is editorial, not freshness (US3; SC-006)

1. After S5, change only the miner tool's recorded version.
2. **Expect**: `pc status` reports producer drift and the bank stays `fresh` — it is
   **not** restaled or rebuilt automatically.
3. Change a source file → the bank is reported `stale` (new material), which a
   deliberate `pc build quote-bank` resolves.

## Reproduce the checks

```
# in editorial-tooling/
node --test                     # validator-first unit tests, then miner tests
# in the proving ground:
npx pc build quote-bank    --episode <dir>
npx pc validate quote-bank --episode <dir>
npx pc status              --episode <dir>
```

# Spec 006 (voice-compose-from-spine) — Final Release-Gate Verification (T030)

Date: 2026-07-29
Package: `voice-tooling`

## 1. Full test suite

Command: `npm test` (`node --import tsx --test`), run from `voice-tooling/`.

```
# tests 369
# suites 0
# pass 369
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Result: **PASS** — all 369 tests green, 0 failures.

### SC-006 shipped-editions regression

Confirmed present and passing: `test/revise-verbatim-preflight.int.test.ts:146`,

```
SC-006 regression: a pre-006 shipped-shape revise edition (no mode field,
no grounding) still validates through runFidelity, loading as mode: revise
```

Re-ran this file in isolation (`node --import tsx --test
test/revise-verbatim-preflight.int.test.ts`) — the SC-006 subtest reports
`ok`. This pins that a pre-006-shape revise edition (no `mode` field, no
grounding declarations) still validates through `runFidelity`, loading with
an inferred `mode: revise`. Other files also reference SC-006 by FR/SC
citation (`fidelity-refuse.test.ts`, `fidelity-pass.test.ts`,
`fidelity-uncorroborated.test.ts`, `mode-agreement-run.int.test.ts`,
`pre-checks.test.ts`) but the dedicated shipped-shape regression is the one
in `revise-verbatim-preflight.int.test.ts`.

## 2. Typecheck

Command: `npm run typecheck` (`tsc --noEmit`).

Result: **PASS** — clean, no errors emitted.

## 3. ESLint

**Not configured for `voice-tooling`.** Checked both locations:

- `voice-tooling/`: no `.eslintrc*`, no `eslint.config.*`, no `eslint`
  dependency and no `lint` script in `voice-tooling/package.json`.
- Repo root: `eslint.config.mjs` exists and is used by the root
  `production-control` package (`npm run lint` → `eslint .`), but it
  explicitly excludes this package:

  ```js
  ignores: [
    ...
    // voice-tooling is a self-contained sub-package: its own package.json,
    // tsconfig, dependencies, and gates (`node --test` + `tsc --noEmit`),
    // and no eslint config of its own. ...
    'voice-tooling/',
  ],
  ```

Honest status: there is no eslint gate for `voice-tooling`, by explicit
design of the root config's own comment. The enforced static gate for this
package is `tsc --noEmit` (typecheck), plus the hand-written "no `any`, no
`as` casts, no `@ts-ignore`" discipline enforced by code review / task
convention rather than by a linter. No new linter was installed or
configured as part of this task.

## 4. File-size ceiling (≤ 500 lines, `src/`, excluding tests)

All `.ts` files under `voice-tooling/src/` were measured. None exceeds the
500-line ceiling. Largest 8 files:

| Rank | File | Lines |
|---|---|---|
| 1 | `src/fidelity/run.ts` | 490 |
| 2 | `src/fidelity/check-op-obligations.ts` | 440 |
| 3 | `src/schema/ledger.ts` | 409 |
| 4 | `src/fidelity/report.ts` | 324 |
| 5 | `src/reader/discover.ts` | 288 |
| 6 | `src/revise/protocol.ts` | 285 |
| 7 | `src/fidelity/cli.ts` | 266 |
| 8 | `src/revise/request.ts` | 264 |

`src/revise/model.ts` (the T003 extraction) is **140 lines** — well under
the ceiling.

Result: **PASS**.

## 5. Build-request smoke

- `node bin/voice-compose.mjs --help` → exit 0, prints the compose
  contract (three fidelity guarantee tiers, input/output shape,
  `VOICE_REVISE_MODEL` config, no default model / no fallback).
- `node bin/voice-revise.mjs --help` → exit 0, prints the revise contract
  (VERBATIM byte-exact guarantee, coverage protocol, no default model / no
  fallback).

Result: **PASS**.

## Overall verdict

**PASS.** All enforced gates (full test suite, typecheck, file-size
ceiling, CLI smoke) are green. ESLint is not configured for this package
by explicit, documented design of the root config — that is reported
honestly above, not claimed as a pass.

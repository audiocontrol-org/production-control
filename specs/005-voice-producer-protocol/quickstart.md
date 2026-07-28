# Quickstart: Voice producer protocol + corpus citation support

Runnable validation that the producer produces a fidelity-passing edition with a model, and that `[PB-###]` citations are checked.

## Prerequisites

- `voice-tooling` installed (`npm --prefix voice-tooling install`).
- A source draft + a voice document; a model command in `VOICE_REVISE_MODEL` (a real CLI like `claude -p`, or the deterministic test stub `tests/fixtures/voice-revise/stub-model.mjs`).

## S1 — Produce an edition with the deterministic stub (build gate green)

Drives the shipped production-control integration path:

```
npx vitest run tests/integration/voice-revise.test.ts
```

Expected: `pc build` invokes `voice revise`, the model's index mapping is resolved into a schema-valid `.ai/`-routed edition, and `voice fidelity` accepts it (2 tests pass).

## S2 — Produce an edition with a real model, then validate

```
VOICE_REVISE_MODEL="claude -p" \
  node voice-tooling/bin/voice-revise.mjs < build-request.json   # writes the edition under output_dir
node voice-tooling/bin/voice-fidelity.mjs < validate-request.json   # verdict on stdout, coverage report on stderr
```

Expected: the provider declares impure; the edition carries a `ledger:` frontmatter accounting for every source unit; `voice fidelity` reports `verdict: passed` when the model preserved every quote, citation, and numeral. Evidence: the 8-voice epilogue lab (all fidelity-passed).

## S3 — Fail-loud checks

- Unset `VOICE_REVISE_MODEL` → the build refuses naming the missing variable (no default model).
- A model response whose `coverage` length ≠ the source-unit count, or an out-of-range `edition_units` index → the build refuses; no partial edition is written.

## S4 — Corpus citations

Point `voice fidelity` at a source citing `[PB-P056]` with frontmatter `sources: [PB-P056]` and an edition preserving it:

- The `citations` check runs with a positive `checked` count (not `not-run`).
- A unit with `[PB-P056]` and `1879` extracts one citation and one numeral (the marker's digits are not double-counted).
- Dropping the citation, or inventing `[PB-P099]`, is refused.

## Package-level

```
npm --prefix voice-tooling test        # protocol parse, ledger-build round-trip, prompt shape, citation extraction, allow-list derivation
npm --prefix voice-tooling run typecheck
```

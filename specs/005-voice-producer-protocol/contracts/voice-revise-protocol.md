# Contract: the `voice revise` model↔provider protocol

## Provider ← Model (stdout)

The provider spawns `VOICE_REVISE_MODEL` with the prompt on stdin and reads one `ModelReviseOutput` on stdout:

```json
{
  "edition": "The revised narration body.\n\nEach edition unit separated by a blank line.\n\n> \"a preserved primary-source quote\" [PB-P056]",
  "coverage": [
    { "op": "verbatim",    "edition_units": [0] },
    { "op": "represented", "edition_units": [1], "treatment": "compressed" },
    { "op": "merged",      "edition_units": [2] },
    { "op": "merged",      "edition_units": [2] },
    { "op": "cut",         "reason": "restates the preceding unit; no new claim" }
  ]
}
```

- Accept a raw JSON object OR a ```` ```json ```` fenced block; ignore surrounding prose.
- `coverage` has EXACTLY ONE entry per source unit, in source document order.
- `edition_units` are 0-based indices into the edition's D6-derived units.
- Malformed shape → the provider refuses, naming the defect; NO edition is written.

## Provider behavior (deterministic)

1. Parse + validate the model output (`parseModelOutput`).
2. Derive source units (from the source draft) and edition units (from `edition`) via the D6 algorithm.
3. Validate the mapping: `coverage.length === sourceUnits.length`; every `edition_units` index in range. Else refuse (no partial edition).
4. Build the hash-keyed `CoverageLedger`: for source unit *i*, `source_unit = {hash: sha256:<hex>, occurrence}`, `op`, `edition_units` = resolved `{hash, occurrence}` refs (absent for `cut`), `reason`/`treatment`.
5. Emit the edition = `---\nledger:\n<ledger yaml>\n---\n` + `edition` body. Because D6 strips leading frontmatter before hashing, the prepended ledger does not perturb the body's units.
6. Return the impure `BuildResponse` (`impure: {reason}`, `outputs`, `tool`); NO validation verdict.

## Model command

- Read from `VOICE_REVISE_MODEL` (a command line, e.g. `claude -p`); unset → fail loud naming the missing variable.
- No baked-in default model; no fallback output.

## Citation extraction (validator side)

- Citation payload = footnote `[^label]` ∪ source `[A-Z][A-Z0-9]*-[A-Z0-9-]+` markers; byte-exact multiset.
- Numeral extraction masks citation spans first (shared source of truth) — a marker's digits are never a numeral.
- Allow-list = declared `citation_allowlist` ∪ markers derived from `sources:` frontmatter (`PB-P056` → `[PB-P056]`).
- The existing `[^1]` / `citation_allowlist` behavior is preserved.

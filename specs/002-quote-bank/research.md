# Phase 0 Research: Quote bank

The architecture was settled in the approved design record; this consolidates the
decisions with rationale and the alternatives rejected, so the plan carries no
unresolved unknowns.

## R1 — Impure producer + independent deterministic validator

- **Decision**: An impure miner produces the bank; a separate deterministic
  validator (the target's independent `validator`, run by `pc validate`) decides
  acceptance. The miner reports no verdict of its own.
- **Rationale**: A quote's integrity is verbatim fidelity, which is mechanically
  checkable, so a generator can be trusted for *selection* but never for
  *fidelity*. Splitting them makes the miner disposable and stops it certifying
  itself. production-control already supports this (the independent-validator
  capability + the `script-provider`/`citation-validator` precedent).
- **Alternatives rejected**: producer self-reported validation (a generator grading
  its own homework — the false-clean the system exists to prevent); a human-authored
  bank (nothing to author in literal quotes).

## R2 — Fidelity model: raw spans + disclosed, closed-set edits

- **Decision**: Each quote records exact source `spans` (`raw` = byte-for-byte
  source substrings), a presentation `text`, and the disclosed `edits`
  (`ocr-fix`, `ellipsis-join` only) between them. The validator re-derives the
  presentation from the raw bytes and the edits and compares byte-for-byte.
- **Rationale**: Real sources are OCR-degraded and passages are often non-adjacent;
  readable quotes therefore differ from raw bytes. Recording the raw span + the
  explicit transformation keeps the gate deterministic while producing usable
  quotes. A closed edit set is what stops "cleanup" becoming "authoring."
- **Alternatives rejected**: raw-only exact substrings (a bank of OCR garble is
  unusable); a fuzzy edit-distance threshold (a threshold is a non-deterministic
  gate).

## R3 — Grounding: the model points, the tool copies the bytes

- **Decision**: The LLM identifies a passage (approximately); the tool then locates
  that passage in the source and extracts the *exact* byte span from the source
  itself. A selection the tool cannot locate as an exact span is **omitted**.
- **Rationale**: An LLM cannot be trusted to transcribe verbatim, but it is good at
  *pointing*. Having the tool copy the bytes makes the miner's output usually pass,
  and the independent validator remains the guarantee. Omission (not emission) of an
  ungroundable selection is the fail-loud posture (V).
- **Approach**: normalize whitespace for the *search* to tolerate the model's
  paraphrased pointer, then snap to the exact source substring for the recorded
  `raw`; record the closed-set edits (OCR fixes, ellipsis joins) the tool applied to
  reach the presentation. Exact mechanism is a task-level detail; the invariant is
  that recorded `raw` is always a verbatim source substring.

## R4 — Model interface: the `claude` CLI

- **Decision**: The miner spawns the `claude` CLI as a subprocess, as the
  `script-provider` does.
- **Rationale**: No Anthropic API key or `ant` profile is available in this
  environment; the `claude` CLI is the credentialed path already used by the govern
  fleet and the script provider. Keeping the model call behind a subprocess adapter
  (`claude.mjs`) makes the miner's deterministic parts testable with an injected
  fake.
- **Alternatives rejected**: the Anthropic SDK (no credentials here; adds a
  dependency); baking the model client into the miner (untestable).

## R5 — Schema serialization: YAML

- **Decision**: The quote bank is a YAML file, matching production-control's
  manifest / profile / ledger convention.
- **Rationale**: Consistency with the rest of the system; human-readable for review;
  a mature parser exists. The schema stays extensible (optional fields) for the
  future asset-bank metadata without adding any now.
- **Alternatives rejected**: JSON (less readable for a review-heavy artifact);
  a bespoke format (needless).

## R6 — Orchestration and lifecycle

- **Decision**: `quote-bank ← [sources]` is a derived target whose provider is the
  miner and whose `validator` is the quote-fidelity checker. Being impure, the bank
  is committed under `ai-generated/`. Sources changing restales it; a miner
  model-version change is producer drift (reported, not auto-restaled). Regeneration
  is a deliberate human action.
- **Rationale**: Fits the existing derived-target + impure routing + independent
  validator + producer-drift semantics with no core change; the lifecycle matches
  "editorial, not freshness."
- **Alternatives rejected**: treating the bank as authored (loses provenance/gating);
  auto-rebuild on model drift (would churn an equally-faithful bank).

## R7 — Package placement

- **Decision**: A standalone `editorial-tooling` package (own `package.json`),
  co-located at the production-control repo root for governability on this branch,
  separate from `src/`, intended to graduate to its own repository.
- **Rationale**: Honors "craft tools are separate" (IV) and "for any project" while
  keeping the code reviewable by the govern gate on the feature branch.
- **Alternatives rejected**: inside production-control `src/` (would make it core —
  violates IV); inside the proving-ground subject repo (makes a reusable capability a
  one-subject one-off).

# Phase 0 Research: Voice producer protocol + corpus citation support

Decisions are settled (validated by a live lab). Recorded here in decision/rationale/alternatives form.

## R1 — How a model produces a valid coverage ledger

- **Decision**: A model↔provider **index-mapping protocol**. The model returns `{ edition, coverage }` where `coverage` declares, per source unit in order, an `op` plus 0-based `edition_units` indices (or a `reason` for `cut`). The provider derives units via D6 and builds the hash-keyed ledger.
- **Rationale**: A model cannot compute sha256 over exact bytes, so it cannot emit hash-keyed refs. It CAN declare which source unit became which edition unit(s) — the disposition it actually performed. The provider mechanizes the hashing.
- **Alternatives**: (a) model emits the hash-keyed ledger directly — infeasible (fabricated hashes → always structurally invalid). (b) model emits prose only, provider infers the mapping — violates corroborate-not-infer (D22); the provider must not guess dispositions.

## R2 — Model selection

- **Decision**: Operator-supplied via the required `VOICE_REVISE_MODEL` environment variable; the provider spawns it with the prompt on stdin and fails loud when unset.
- **Rationale**: Capability, not vendor (Constitution VI/VII) — any model CLI works. No baked-in default avoids a hidden dependency and a fallback that masks misconfiguration (Constitution V).
- **Alternatives**: a hardcoded `claude` default (rejected — vendor coupling + a silent fallback); an in-process SDK (rejected — providers are subprocesses, Constitution).

## R3 — The prompt as a reviewable artifact

- **Decision**: Build the prompt in `model.ts`: numbered source units + the voice's trait directives + the deterministic fidelity contract stated plainly + the required output format. Pin it with a test.
- **Rationale**: The load-bearing instruction must be code-reviewed and version-controlled, not an operator shell string; a test makes it a first-class artifact.

## R4 — Corpus citation markers

- **Decision**: Extend the citation regex to match `[^label]` AND `[A-Z][A-Z0-9]*-[A-Z0-9-]+` (e.g. `[PB-P056]`); mask citation spans before numeral extraction (shared source of truth); derive the allow-list from `sources:` frontmatter when no `citation_allowlist` is declared, unioning when both are present.
- **Rationale**: Real source-cited corpora use `[PB-###]` and declare `sources:`; without this, citation fidelity was silently a no-op. FR-020 (spec 004) explicitly permits evolving the citation representation.
- **Alternatives**: footnote-only (rejected — under-checks the corpus's central payload class); a per-project configurable marker grammar (rejected — YAGNI for now; the uppercase-prefix rule + `sources:` covers the corpus).

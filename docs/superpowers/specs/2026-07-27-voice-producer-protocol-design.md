---
item: design:feature/voice-producer-protocol
slug: voice-producer-protocol
date: 2026-07-27
design-approved: yes
---

# Voice producer protocol + corpus citation support — design

Formalizes the `voice revise` producer half that voice-editions v1 deliberately shipped as a
stub, plus the citation-extraction extension the real ebook corpus needs. The implementation
already exists, is tested, and was validated by a live lab (8 voices × the Nouvelle-France
epilogue, all fidelity-passed) on branch `spike/nouvelle-france-voice-lab`; this record captures
the design that produced it and routes it through the governed flow.

## Problem domain

voice-editions v1 shipped `voice revise` as an impure provider whose real model call was never
wired: `model.ts` sent the model a bare JSON blob and no instruction, so only the deterministic
test stub could satisfy the documented output contract (a real `claude -p` emits conversational
prose, not a ledgered edition). The load-bearing obstacle is structural, not cosmetic: **a
language model cannot compute the `sha256` content hashes the coverage ledger keys on**, so it
cannot emit a valid hash-keyed ledger directly. Without a real producer, the generative half of
the feature only works against a fixture.

Second, the target corpus (the ebook) cites primary sources as `[PB-P056]` markers and declares
the allowed set in each chapter's frontmatter as `sources: [PB-P056, …]`. The v1 validator only
recognized footnote `[^1]` markers and only read a `citation_allowlist:` key, so citation
fidelity was silently a no-op on real content — the one payload class most central to
source-cited nonfiction went unchecked.

Audience: an operator running voice editions of a source-locked draft through the real model;
and the deterministic `voice fidelity` gate that must be able to judge the result.

## Solution space

### Rejected — model emits the coverage ledger directly
Have the model output the full ledger (hash-keyed `source_unit`/`edition_units` refs). Rejected:
a model cannot reliably compute `sha256` over exact bytes, so the refs would be fabricated and the
ledger structurally invalid — every real run would fail `ledger_structure`/`unit_accounting`. This
is the obstacle the whole design exists to route around.

### Rejected — model emits prose only; the provider infers the mapping
Have the model return just the revised prose and let the provider derive both source and edition
units and *infer* which source unit became which edition unit(s). Rejected: it violates
corroborate-not-infer (D22) — the provider would be guessing dispositions the producer never
declared, exactly the inference the validator is forbidden to do. The declaration must come from
the producer, which knows what it did to each unit.

### Chosen — a model↔provider index-mapping protocol
The model declares the *mapping* (which it can), the provider mechanizes the *hashes* (which it
must). The model outputs `{ edition: <full revised body, units blank-line-separated>, coverage:
[ {op, edition_units: <0-based indices>, reason?} … one entry per source unit, in order ] }`. The
provider derives source units and edition units via the D6 algorithm, validates the declared
mapping is complete and in range (fail loud otherwise), and builds the hash-keyed `CoverageLedger`
by resolving each declared index to `{hash, occurrence}`. The prompt presents the source as
numbered units and states the fidelity contract plainly (quotes/citations/numerals survive
verbatim into declared destinations; account for every unit). The model command is operator-
supplied via `VOICE_REVISE_MODEL` and fails loud when unset — no baked-in model, no fallback.

### Citation support — chosen: recognize `[PB-###]` + derive the allow-list from `sources:`
Extend the citation extractor to match both `[^label]` footnotes and `[A-Z][A-Z0-9]*-[A-Z0-9-]+`
source markers, and mask those spans before numeral extraction so a marker's digits are not double-
counted. When a source declares no `citation_allowlist`, derive the allow-list from its `sources:`
frontmatter (each id → `[id]`); union both when present. FR-020 explicitly permits evolving the
citation representation, so this is in-bounds rather than a contract break. (Alternative rejected:
leave citations footnote-only and treat `[PB-###]` as unchecked — rejected because it silently
under-checks the corpus's most important payload class.)

## Decisions

- The producer is a **subprocess speaking a declarative index-mapping protocol**; the provider
  owns hashing and ledger construction (Constitution VI: providers disposable, oracle authoritative).
- The prompt is a **reviewable artifact** built in `model.ts` (numbered source units + voice
  directives + the fidelity contract + the output-format spec), pinned by a test — not an operator
  shell string.
- `VOICE_REVISE_MODEL` is required; the provider **fails loud** when it is unset (no default model).
- Citation extraction recognizes `[PB-###]` and derives the allow-list from `sources:`; the numeric
  extractor masks citation spans (single source of truth for what a marker is).
- The provider still reports **no validation verdict**; gating stays the independent `voice fidelity`
  validator's job (D3).

## Open questions

- **Model identity in provenance (backlog TASK-31 / -40):** `tool.version` records the package
  version only, so a model swap behind a fixed `VOICE_REVISE_MODEL` is invisible to producer-drift.
  Should the adapter resolve and record a model identity, or refuse when it cannot?
- **Silent stdout truncation (TASK-30):** the model-output cap drops the crossing chunk and returns
  the prefix as success. Convert to a loud refusal naming the limit.
- **`target` → filename path safety (TASK-39):** the wire `target` flows into the output filename
  unvalidated; needs sanitization/refusal.
- **Quote-bank D14 path:** still deferred (couples to asset-bank); the exact-block dialect remains
  the only one exercised.
- **Prompt robustness on bolder voices:** the lab's 8 voices all passed on the epilogue, but a
  bolder revision or a harder passage may drop payload and be refused — expected, but the prompt's
  failure rate is not yet characterized.

## Provenance

- Implementation (spike, tested, pushed): `729c110` (producer protocol), `06e48ca` ([PB-###]
  citations + sources-as-allowlist) on `spike/nouvelle-france-voice-lab`.
- Validation: live lab — 8 catalog voices × the Nouvelle-France epilogue on a real `claude` model,
  all fidelity-passed (8 quotes, 3 citations, 7 figures preserved verbatim across 28 units).
- Origin: backlog TASK-29 (`voice-revise-model-no-prompt`), promoted to
  `roadmap:design:feature/voice-producer-protocol`.
- Prior design: `docs/superpowers/specs/2026-07-27-nouvelle-france-voice-lab-design.md` (the lab spike).
- Depends on: `design:feature/voice-editions` (the validator, ledger schema, unit derivation).

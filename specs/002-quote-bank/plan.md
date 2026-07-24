# Implementation Plan: Quote bank

**Branch**: `002-quote-bank` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-quote-bank/spec.md`

**Design record** (authoritative for HOW): `docs/superpowers/specs/2026-07-22-quote-bank-design.md`

## Summary

Build a reproducible **quote-bank** capability: from a project's plain-text primary
sources, produce a bank of verbatim, source-cited passages. A quote is literal
source text, so the bank's integrity is verbatim fidelity — mechanically
checkable. An **impure** miner (a language model *selects* passages; the tool
*grounds* each by copying exact source bytes) is gated by an **independent,
deterministic** validator that guarantees every quote is real and unaltered except
in disclosed, closed-set edits. The capability is a new reusable craft package
orchestrated by production-control as a derived target `quote-bank ← [sources]`
with the validator — with **no change to production-control core**.

## Technical Context

**Language/Version**: Plain ESM `.mjs` for the craft tools (miner + validator),
matching the existing epub/script/citation craft tools — directly runnable by hand,
no build step (Constitution IV; Tech Constraints "providers are subprocesses").

**Primary Dependencies**: a YAML parser (`js-yaml` or `yaml`) for the bank schema;
the `claude` CLI (spawned as a subprocess — the impure model call, as the
`script-provider` does) for the miner; production-control's existing subprocess+JSON
**provider** contract (BuildRequest/BuildResponse) and **validator** contract
(ValidateRequest/ValidateResponse). No API SDK; no production-control code imported.

**Storage**: files. `sources` is a directory input of plain-text docs. The produced
`quote-bank` is a YAML file; being impure it lands in production-control's committed
`ai-generated/` tree (its selection is irreproducible and is the durable record).

**Testing**: `node --test` for the craft package (validator-first TDD), plus
production-control integration tests in the proving ground. No new production-control
unit surface.

**Target Platform**: Node (macOS/Linux) CLI craft tools, orchestrated by `pc`.

**Project Type**: a standalone reusable craft package (`editorial-tooling`) +
orchestration through production-control's existing model (no core change).

**Performance Goals**: none load-bearing. The validator is linear in bank size and
runs offline; the miner's latency is the model's.

**Constraints**: the validator is **deterministic, offline** (no LLM, no threshold,
no network); **no production-control core change**; files under 500 lines; no
`any`/`as`/`@ts-ignore` in any TypeScript; no fallbacks or mock data outside tests
(throw and name what is missing).

**Scale/Scope**: a project's corpus — order dozens of sources, hundreds of quotes.
No hard scale target; the tools handle whatever corpus is supplied.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Human-Authored Narrative (NON-NEGOTIABLE)** — PASS. A quote is *literal source
  text*; the capability writes, edits, or generates **no** creative work. The miner's
  only judgment is *selection* (editorial: which real passages to include), never
  authoring. The design record makes this the defining distinction.
- **II. Deterministic Production** — PASS. The miner is a **declared-impure** provider
  (a model call; it states its impurity, as II permits). The trust anchor — the
  validator — is **fully deterministic**: same bank + sources ⇒ same verdict, no LLM,
  no network. Freshness is content-hash based (no mtime).
- **III. Explicit Provenance** — PASS. The bank is built by `pc build` (build+record
  indivisible), recording inputs by hash, the producing tool, and its impurity
  reason. The validator's verdict is recorded by `pc validate`.
- **IV. Crafts Remain Specialized** — PASS. All quote-bank craft knowledge lives in a
  **separate package** (`editorial-tooling`), never in production-control core. The
  tools are subprocesses that receive local paths and emit local files; they hold no
  asset-store credentials and touch no object storage. (The miner spawns the `claude`
  CLI as a craft dependency, like an audio tool spawning ffmpeg — not a store
  credential.) No orchestration-layer change is required.
- **V. Fail Loud, Never False-Clean** — PASS. The validator **rejects** any fabricated
  or undisclosed-altered quote, naming it. The miner **omits** any selection it cannot
  ground (never emits unverified text) and fails loudly if the model is unavailable —
  it never fabricates or produces a partial-but-clean bank. No fallbacks, no mock
  outside tests.
- **VI. The Oracle Is Authoritative; Providers Are Disposable** — PASS. The
  independent validator (not the generator's self-report) decides acceptance; the
  impure miner is disposable and replaceable without changing the trust model. The
  bank's graph node, schema, and ledger record stay valid if the miner is swapped.
- **VII. Subject-Agnostic** — PASS. Schema, miner, and validator encode **no** subject
  knowledge — they operate on arbitrary text sources with ids. A quote bank is built
  for a new subject by supplying only its sources. Fixtures under the package's test
  tree are synthetic; no authored content lives in this repository.

**Verdict: PASS — no violations.** Complexity Tracking is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-quote-bank/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (miner + validator wire contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code

A **new standalone reusable package**, separate from production-control core. It is
co-located at the production-control repo root for this feature so it is reviewable
on the branch and governable, but it is its own package (`editorial-tooling`), not
part of production-control's `src/`, and is intended to graduate to its own
repository. production-control's `src/` is **untouched**.

```text
editorial-tooling/                    # NEW reusable craft package (own package.json)
├── package.json
├── src/
│   ├── schema.mjs                    # parse/serialize the YAML quote-bank; shape checks
│   ├── edits.mjs                     # the closed edit set + deterministic re-derivation
│   ├── validator.mjs                 # the deterministic quote-fidelity check (pure)
│   ├── miner.mjs                     # miner orchestration: prompt, ground, emit (impure)
│   └── claude.mjs                    # the `claude` CLI adapter (the impure model call)
├── bin/
│   ├── quote-validator.mjs           # validator entrypoint (ValidateRequest→ValidateResponse)
│   └── quote-miner.mjs               # miner entrypoint (BuildRequest→BuildResponse)
└── test/
    ├── validator.test.mjs
    ├── miner.test.mjs
    └── fixtures/                     # synthetic sources + hand-written banks

# Proving ground (separate repo, nouvelle-france): a `sources/` input + a
# `quote-bank` target wired to bin/quote-miner.mjs (provider) and
# bin/quote-validator.mjs (validator), exercised end-to-end.
```

**Structure Decision**: A standalone `editorial-tooling` package holds the schema,
miner, and validator; production-control orchestrates it through its existing
derived-target + impure-provider + independent-validator + directory-input model with
zero core change. The validator (`src/validator.mjs`, `src/edits.mjs`, `src/schema.mjs`)
is built and tested first; the miner (`src/miner.mjs`, `src/claude.mjs`) second; the
proving-ground wiring last.

## Complexity Tracking

> No Constitution Check violations — nothing to justify.

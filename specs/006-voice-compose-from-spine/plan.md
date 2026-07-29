# Implementation Plan: Voice compose-from-spine (compose mode)

**Branch**: `feature/voice` (single long-lived branch; spec dir resolved via the SPECKIT marker) | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-voice-compose-from-spine/spec.md`; approved design record `docs/superpowers/specs/2026-07-28-voice-compose-from-spine-design.md`.

## Summary

Add a second producer **mode** — `compose` — to the existing `voice-tooling` package: expand a source-cited spine (structured beats) into a full narrative chapter in a chosen voice, alongside `revise`. The source-side machinery from spec 005 (unit derivation, payload corroboration, source-unit accounting, citation checks) is reused unchanged. The new work is: a mode-keyed prompt module, a pure shared op-legality + grounding policy module (consumed by both a producer pre-emit self-check and the validator), ledger schema additions (a `mode` stamp + compose `grounding` records — landing on the ledger's existing additive-extensibility seam, D21), validator mode-awareness (requested==ledger mode agreement, edition-side grounding accounting, compose op-legality, whole-unit no-copy), the revise verbatim pre-emit self-check (TASK-50), and two CLI verbs over a shared producer core. Reverse (edition-side) accounting is compose-only in v1; revise is unchanged so its 54 shipped editions stay valid.

## Technical Context

**Language/Version**: TypeScript on Node 20 (ESM, `@/…` import pattern), executed via `tsx`.

**Primary Dependencies**: existing `voice-tooling` internals only (`yaml`, `node:crypto`); no new runtime dependency. Reuses `@/units/derive.ts`, `@/schema/ledger.ts`, `@/revise/*`, `@/fidelity/*`, `@/payload/*`.

**Storage**: filesystem — editions + frontmatter coverage ledger; impure output routes to a dot-zoned path (content-zone contract).

**Testing**: `vitest` (the package suite), RED-first; deterministic model stub for producer integration tests.

**Target Platform**: CLI provider invoked directly by the operator or as a production-control provider subprocess (wire = stdin JSON `BuildRequest`/`ValidateRequest`).

**Project Type**: single package (the `voice-tooling` craft tool), subject-agnostic.

**Performance Goals**: not latency-bound; correctness + determinism of the gate is the objective. One edition per invocation.

**Constraints**: no `any`/`as`/`@ts-ignore`; interface-first; DI; composition over inheritance; every file ≤ 500 lines (the prototype's inline `if(compose)` branches in `model.ts` must be extracted); no production-control root-schema change; fail-loud named refusals, no fallback.

**Scale/Scope**: additive to a ~250-test package; ~6–8 new/changed source modules + tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Human-Authored Narrative (NON-NEGOTIABLE)** — *The load-bearing gate for this feature.* Compose generates prose, which at first glance touches this principle. It **passes on the same footing as voice-editions (004) and voice-producer-protocol (005), which already shipped model-backed prose generation**: production-control the orchestrator writes nothing; the **human authors the spine** (the narrative structure — beat content and order — and the evidence) and the **voice**; an **impure, operator-configured model provider** realizes the prose; and the result is provenance-tracked and deterministically fidelity-gated. Compose is in fact **more constrained** than revise, not less: edition-side grounding accounting mechanically forbids *silent* invention (no edition unit without a declared origin), whole-unit no-copy forbids copying, and the trust model reports — never overclaims — semantic limits. The tooling expands a human's structured outline into voiced prose; it does not acquire authorship or editorial judgment.
- **II. Deterministic Production** — the compose producer is a model call → declares itself impure (reuses the existing impure-provider declaration). The validator and all op-legality/grounding checks are pure and deterministic. ✓
- **III. Explicit Provenance** — the ledger records inputs by hash, the producing tool, the `mode`, and (compose) per-edition-unit grounding; build-and-record stays one indivisible act. ✓
- **IV. Crafts Remain Specialized** — the work lands in the `voice-tooling` craft (independently useful CLI verbs), not the orchestration layer; providers receive local paths, hold no credentials, touch no storage. ✓
- **V. Fail Loud, Never False-Clean** — every refusal names its unit + cause; no fallback, no silent skip; standalone validation reports the absence of an independent mode comparison rather than assuming. ✓
- **VI. Oracle Authoritative; Providers Disposable** — the ledger + validator are authoritative; the producer's pre-emit self-check never certifies itself (producer success ≠ validator success; the validator re-derives independently). ✓
- **VII. Subject-Agnostic** — no subject data in code; the consumer supplies spine documents, voice catalog, and citation conventions; `examples/` holds fixtures only. ✓
- **Files ≤ 500 lines** — enforced by extracting the mode-keyed prompt module. ✓
- **Design precedes spec** — `design-approved: yes`. ✓ **Test-driven** — RED tests precede implementation. ✓

**Verdict: PASS.** No unjustified violations; no Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/006-voice-compose-from-spine/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── voice-compose-cli.md
│   ├── coverage-ledger-additions.md
│   └── fidelity-mode-agreement.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
voice-tooling/src/
├── policy/                        # NEW — pure shared normative logic (producer + validator)
│   ├── op-legality.ts             #   compose: no verbatim/cut/whole-unit-copy; revise: verbatim byte-exact
│   └── grounding.ts               #   edition-side grounding accounting (exhaustive + exclusive)
├── revise/
│   ├── prompt/                    # NEW — mode-keyed prompt module (extracted from model.ts)
│   │   ├── compose.ts             #   compose contract (expand; forbid verbatim; grounding declaration)
│   │   ├── revise.ts              #   revise contract (hardened: verbatim == byte-exact, TASK-50)
│   │   └── index.ts               #   buildPrompt(mode, ...)
│   ├── model.ts                   # CHANGED — mode param; delegates to prompt/ (shrinks under ceiling)
│   ├── protocol.ts                # CHANGED — parse model grounding declaration (compose)
│   ├── ledger-build.ts            # CHANGED — stamp mode; build grounding records (compose)
│   ├── preflight.ts               # NEW — producer pre-emit self-check (calls policy/*)
│   └── cli.ts                     # CHANGED — mode-parameterized producer core
├── schema/
│   └── ledger.ts                  # CHANGED — mode stamp + grounding records (additive-extensibility seam)
├── fidelity/
│   ├── check-mode-agreement.ts    # NEW — requested_mode == ledger.mode
│   ├── check-edition-grounding.ts # NEW — edition-side accounting (compose)
│   ├── check-no-copy.ts           # NEW — whole-unit no-copy (compose)
│   ├── check-op-obligations.ts    # CHANGED — mode-aware compose op-legality (no verbatim/cut)
│   ├── run.ts                     # CHANGED — sequence new checks; carry mode
│   └── cli.ts                     # CHANGED — ValidateRequest optional requested_mode
└── bin/
    ├── voice-compose.mjs          # NEW — the `voice compose` verb
    └── voice-revise.mjs           # EXISTING — the `voice revise` verb

voice-tooling/src/__tests__/       # RED-first tests mirroring each module above
```

**Structure Decision**: additive to the existing `voice-tooling` package. The shared normative policy is lifted into a new neutral `src/policy/` module so the producer (`revise/`) and validator (`fidelity/`) both import it without either depending on the other (preserves validator independence, Principle VI). The mode-keyed prompt module resolves the file-ceiling pressure on `model.ts`. Whether the two CLI verbs ship as two bins or one `voice <subcommand>` multiplexer is a Phase 0 research decision (see research.md).

## Complexity Tracking

> No Constitution Check violations — this section intentionally empty.

---
title: Voice compose-from-spine
roadmap-item: design:feature/voice-compose-from-spine
date: 2026-07-28
status: designed
depends-on: design:feature/voice-producer-protocol
folds-in: TASK-50, TASK-51
---

# Voice compose-from-spine — design

Formalize the env-gated `compose` prototype into a governed voice-tooling
increment: a second producer mode that expands a source-cited **spine**
(structured beats) into a full narrative chapter in a given voice, gated by the
same deterministic fidelity machinery as `revise`, with a mode-aware op-legality
check that both enforces compose's "never copy" discipline and closes the
`revise`-mode verbatim-drift bug (TASK-50).

## Problem domain

Voice-editions today has one producer mode: `revise` re-narrates an
already-rendered source draft into a voice while a deterministic fidelity
validator gates the result (every quoted/cited/numeric payload survives
byte-exact; every source unit gets exactly one disposition; the ledger is
complete). The full-ebook empirical run (56 editions, live model) validated this
holds on real prose — 54/56 faithful.

Two findings from that run motivate this increment:

1. **A second, distinct authoring need surfaced: composition, not revision.** The
   project holds a *spine* — a structured, source-cited outline of beats — that
   the operator wants expanded into full chapter prose in a chosen voice.
   Expansion is a fundamentally different operation from re-narration: you are
   *growing* terse beats into flowing narrative, never *copying* an existing
   rendered draft. The prototype (spike branch, `voice-tooling/src/revise/model.ts`,
   env-gated `VOICE_REVISE_MODE=compose`) proved the shape works: Ep1 composed
   and fidelity-passed with 10 numerals + 3 citations preserved byte-exact and no
   verbatim-drift. It must be formalized as a first-class, tested, governed mode
   rather than an env-var probe.

2. **`revise` mode has a verbatim-drift failure class (TASK-50).** In 2/56
   editions the model declared a source unit `op: verbatim` but altered its bytes
   (ch04/investigative-momentum, ch06/intimate-witness). The deterministic gate
   correctly refused both — this is not a tooling defect — but the failure is
   caught only *after* a full model call, and the remedy (stronger prompt
   discipline + a producer-side pre-emit self-check) is the *same* mechanism
   compose needs. The two tasks share one enforcement point.

**Key structural fact that shapes everything below:** a spine is *byte-structurally
identical* to a source draft. The prototype feeds it through the exact same
`deriveUnits` → `[SOURCE UNIT n]` markers → coverage ledger → fidelity checks.
Therefore (a) mode **cannot** be inferred from the input's type the way
source-vs-voice is discriminated, so it must be an explicitly chosen field; and
(b) essentially none of the downstream machinery changes — the mode-specific
surface is small and isolable (prompt framing + op-legality rules).

### Constraints

- **Constitution VII (subject-agnostic craft tool).** The tooling must carry only
  generic capability; the consumer project supplies the spine documents, the
  voice catalog, and its citation-marker conventions.
- **No `any` / no type bypass; DI; composition over inheritance** (repo TS
  guidelines).
- **300–500 line file ceiling** — the prototype's inline `if (compose)` branches
  in `model.ts` must be refactored into a mode-keyed prompt module.
- **Impure output stays dot-zoned** (content-zone-segregation) — a composed
  edition is AI prose and routes to a `.ai/`-zoned path exactly as a revised
  edition does; unchanged by this increment.
- **Never bypass the fidelity gate.** Compose reuses the deterministic validator;
  it does not introduce a weaker path.

## Solution space

The central decision was **how the compose-vs-revise choice is surfaced and how
op-legality is enforced**. Alternatives considered:

### Rejected — infer mode from input type (spine as a distinct document type)

Mirror the existing source-vs-voice discrimination: define a `loadSpine` that
recognizes a structurally-distinct spine document, and infer `compose` when the
non-voice input is a spine. **Rejected on empirical grounds:** a spine and a
draft are the same kind of source-cited markdown — there is no structural
signature to discriminate on. Forcing an artificial one (e.g. a mandatory
frontmatter `kind: spine`) would be a fabricated distinction, and would still not
tell the tool whether the operator wants that document *composed* or (nonsensically)
*revised*. Mode is an intent, not a property of the bytes.

### Rejected — declare mode on the manifest target (BuildRequestSchema field)

Add `mode: compose|revise` to the edition target in the production-control
manifest; extend `BuildRequestSchema` so it flows to the provider on the wire.
Explicit and manifest-visible, but: it puts the *intent* in the wrong layer (a
cross-package root-schema change for what is an operator invocation choice), and
introduces a mismatch failure mode (target says compose, operator wanted revise
today). **Rejected** per operator steer: "I'll tell you whether I want you to
compose vs revise" — the choice is made at invocation, not baked into the target.

### Rejected — carry mode through provider-args (`modelCmd` landing spot)

Thread mode through the existing request-level provider-args field. No root-schema
change, but mode reads as a model-command detail and stays invisible in both the
manifest and the CLI. **Rejected:** it hides an operator-facing intent inside a
provider-internal field.

### Chosen — mode as an operator invocation choice, two CLI verbs over a shared core

`voice compose` and `voice revise` are two named verbs that both call a single
`buildEdition(mode, …)` core. The verb name *is* the mode; each verb's help states
its fidelity contract. Op-legality is enforced defense-in-depth: a producer-side
pre-emit self-check (fast, honest refusal) plus the deterministic validator
reading `mode` from the coverage ledger (the trustworthy backstop). Chosen
because: it matches the operator's "I decide at invocation" intent; it needs **no**
production-control schema change; `compose` and `revise` genuinely are different
operations with different contracts, so distinct verbs read most honestly; and the
mode-specific surface stays small and isolable.

## Architecture

**One shared core, two thin verbs.**

```
voice compose spine.md voice.md ─┐
                                 ├─▶ buildEdition(mode, request) ─▶ prompt(mode) ─▶ model
voice revise  draft.md voice.md ─┘                                      │
                                                                        ▼
                                        parse coverage ─▶ op-legality self-check(mode) ─▶ REFUSE on illegal
                                                                        │ (legal)
                                                                        ▼
                                        emit edition + coverage ledger (ledger stamps `mode`)
                                                                        │
                                                                        ▼
                                        deterministic fidelity validator (reads `mode` from ledger,
                                        enforces mode-aware op-legality as the backstop gate)
```

Everything from `deriveUnits` onward is already shared and unchanged — the spine
is the same markdown shape as a draft. The mode-specific surface is only:

| Concern | `revise` | `compose` |
|---|---|---|
| Prompt framing | re-narrate this draft | expand each beat into prose |
| `verbatim` op | allowed (must be byte-exact) | **forbidden** (expansion never copies) |
| `cut` op | allowed with reason | **forbidden** for a fact/citation-bearing beat |
| Fidelity contract | preserve quoted/cited/numeric payload byte-exact | carry every asserted fact + every citation/numeral; invent nothing; claims-as-assertions; preserve open-question flags |

### Components

- **`prompt/` module (mode-keyed), extracted from `revise/model.ts`.** Two prompt
  contracts (`revise`, `compose`) built behind a `mode` parameter, replacing the
  prototype's inline branches. Keeps `model.ts` under the ceiling. The `revise`
  prompt is *hardened* for TASK-50: verbatim means byte-exact, stated
  emphatically.
- **`op-legality` check (new, deterministic, pure).** Given `(mode, coverage,
  sourceUnits, editionUnits)`, returns legal / a named refusal. Compose: no
  `verbatim`; no `cut` of a payload-bearing beat. Revise: each `verbatim` unit's
  destination bytes are byte-exact to its source unit (the TASK-50 self-check).
  Consumed by the producer pre-emit AND available to the validator.
- **`buildEdition(mode, …)` core.** Runs the mode's prompt, parses coverage, runs
  the op-legality self-check *before emitting*, refuses on illegality, else emits
  the edition and a coverage ledger that records `mode`.
- **Coverage ledger `mode` stamp.** The ledger schema gains a `mode` field
  (provenance) so the edition is reproducible and the validator knows how to judge
  it.
- **Fidelity validator mode-awareness.** The validator reads `mode` from the
  ledger and applies the same op-legality rules deterministically — the backstop
  independent of whether the producer self-check ran.
- **Two CLI verbs.** `voice compose` / `voice revise` dispatch to `buildEdition`
  with the corresponding mode; help text states each contract.

### Data flow

Operator invokes `voice compose spine.md voice.md` (or `revise`) → `buildEdition`
resolves inputs (unchanged `parseReviseRequest`) → builds the mode's prompt →
model returns `{ edition, coverage }` → pre-emit op-legality self-check for the
mode (refuse on illegality, before any write) → emit edition (dot-zoned) +
coverage ledger stamped with `mode` → later, `voice fidelity` reads the ledger's
`mode` and gates the edition with mode-aware op-legality.

### Error handling / refusals

- **Compose, model declared `verbatim`:** producer refuses pre-emit, named
  (`compose-mode forbids verbatim: unit N`); validator independently fails the gate
  if such a ledger reaches it.
- **Compose, `cut` of a payload-bearing beat:** producer refuses pre-emit, named.
- **Revise, `verbatim` unit drifted (TASK-50):** producer refuses pre-emit
  (byte-mismatch against source), named; validator continues to fail the gate as
  it does today.
- All refusals name the specific unit and cause — no silent fallback, no
  downgrade-in-place (throwing over fallback per repo rules).

## Testing strategy

RED-first, predominantly deterministic (no live model):

- **op-legality unit tests:** compose rejects a `verbatim` entry; compose rejects
  `cut` of a fact-bearing beat; revise refuses a drifted `verbatim` unit; revise
  accepts a byte-exact `verbatim`; both accept legal coverage.
- **validator mode-awareness:** a composed edition carrying a `verbatim` op fails
  the gate; a faithful composed edition passes; the ledger round-trips `mode`.
- **fixtures:** a small spine fixture → faithful composed edition passes
  (citations + numerals byte-exact); infidelity fixtures (invented fact, dropped
  citation, papered-over open-question) fail.
- **CLI:** `voice compose` / `voice revise` dispatch to the right mode; help text
  states each contract.
- **regression:** the full existing revise/fidelity suite stays green (compose is
  additive; the shared core is unchanged downstream of the prompt).

## Decisions

1. **Mode is an operator invocation choice, exposed as two CLI verbs**
   (`voice compose` / `voice revise`) over a shared `buildEdition(mode, …)` core —
   **not** a manifest/BuildRequest field and **not** inferred from input type.
   No production-control schema change.
2. **A spine is not a new document type.** It is source-cited markdown fed through
   the existing `deriveUnits` path unchanged; the beats are source units.
3. **Compose op-legality:** `verbatim` is forbidden; `cut` of a payload-bearing
   (fact/citation/numeral) beat is forbidden. Every beat gets exactly one
   disposition, in order (the existing unit-accounting check, unchanged).
4. **Op-legality is enforced defense-in-depth:** a producer-side pre-emit
   self-check (fast, honest, pre-write refusal) AND the deterministic validator
   reading `mode` from the ledger (the trustworthy backstop).
5. **The coverage ledger records `mode`** — provenance that makes the edition
   reproducible and lets the validator judge it.
6. **TASK-50 is folded in fully:** the revise prompt is hardened (verbatim ==
   byte-exact) AND the pre-emit self-check verifies verbatim units against the
   source and refuses on drift — the same mechanism compose uses.
7. **Prompt contracts are extracted** from `model.ts` into a mode-keyed `prompt/`
   module to hold the file ceiling and isolate the mode surface.
8. **Compose prose discipline:** invent nothing beyond what the beats + their
   sources support; promotional/defense claims are voiced as *assertions* ("the
   prospectus claimed"), never as established fact; open-question flags are
   preserved as flagged gaps, never papered over.

## Open questions

1. **May a beat ever be legally `cut` in compose?** Leaning yes for a pure
   structural/heading beat that carries no fact/citation/numeral payload; a
   payload-bearing beat may never be cut. Settle the exact predicate in the spec.
2. **Does `merged` need extra constraints in compose** when beats fuse? The
   prototype allowed `represented`/`merged` freely; confirm no additional rule is
   needed.
3. **The spine's own upstream fidelity** (is the spine itself source-validated?)
   is **out of scope** here — the spine is taken as the given source input; that
   validation is asset-bank territory (`design:feature/asset-bank`).

## Provenance

- **Prototype:** spike branch `spike/nouvelle-france-voice-lab`,
  commit `896c132` — env-gated compose in `voice-tooling/src/revise/model.ts`;
  Ep1 fidelity-passed (10 numerals + 3 citations byte-exact, no verbatim-drift).
- **Empirical basis:** full-ebook run (56 editions, live model), 54/56 faithful;
  the 2 refusals were revise verbatim-drift (TASK-50).
- **Tasks:** TASK-51 (formalize compose-from-spine), TASK-50 (revise verbatim-drift).
- **Predecessor design:** `docs/superpowers/specs/2026-07-27-voice-producer-protocol-design.md`
  (the producer protocol + fidelity machinery this reuses unchanged).
- **Depends-on:** `design:feature/voice-producer-protocol` (shipped, spec 005).
- **Design conversation:** in-session, 2026-07-28, via `/stack-control:design`
  (backend: `superpowers:brainstorming`); operator approved shape (Part A),
  enforcement (Part B), and testing/scope (Part C); chose two-CLI-verbs surface
  and full TASK-50 fold-in.

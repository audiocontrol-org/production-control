---
title: Voice compose-from-spine
roadmap-item: design:feature/voice-compose-from-spine
date: 2026-07-28
status: designed
depends-on: design:feature/voice-producer-protocol
implements: design:feature/voice-compose-from-spine (the compose formalization; graduated from the spike prototype)
folds-in: TASK-50 (revise verbatim-drift)
spawns: TASK-51 (revise-edition-side-accounting follow-up)
---

# Voice compose-from-spine — design

Formalize the env-gated `compose` prototype into a governed voice-tooling
increment: a second producer mode that expands a source-cited **spine**
(structured beats) into a full narrative chapter in a given voice. Composition
deliberately writes large amounts of new prose, so this increment adds the
mechanical backstop that pure re-narration never needed — **edition-side
grounding accounting** — alongside the mode-aware op-legality pass that also
closes the `revise`-mode verbatim-drift bug (TASK-50).

The load-bearing correction from design review: the reused fidelity machinery is
**source-directed** (it proves every source beat was handled), and that is *not*
sufficient for composition (which must also prove every generated unit was
declared). This design states that boundary plainly and adds the reverse
accounting to close it — without ever claiming to prove semantic truth, which no
deterministic gate can.

## Problem domain

Voice-editions today has one producer mode: `revise` re-narrates an
already-rendered source draft into a voice while a deterministic fidelity
validator gates the result (every quoted/cited/numeric payload survives
byte-exact; every source unit gets exactly one disposition; the ledger is
complete). The full-ebook empirical run (56 editions, live model) validated this
holds on real prose — 54/56 faithful.

Three findings motivate this increment:

1. **A distinct operation surfaced: composition, not revision.** The project
   holds a *spine* — a structured, source-cited outline of beats — that the
   operator wants expanded into full chapter prose in a chosen voice. Expansion
   is fundamentally different from re-narration: you *grow* terse beats into
   flowing narrative, never *copy* a rendered draft. The prototype (spike branch,
   commit `896c132`, env-gated `VOICE_REVISE_MODE=compose`) proved the shape:
   Ep1 composed and fidelity-passed with 10 numerals + 3 citations byte-exact and
   no verbatim-drift. It must be formalized as a first-class, tested, governed
   mode.

2. **The reused fidelity machinery is source-directed — insufficient for
   composition.** Verified in code: `check-unit-accounting.ts` proves *"every
   source unit derived from the source draft has exactly one ledger coverage
   entry, and every ledger entry names a real source unit."* It accounts **source**
   units. Nothing accounts **edition** units. So a composed edition can map every
   beat correctly, preserve every citation/numeral, and still contain an
   undeclared invented paragraph that no check ever looks at:

   > Spine beats: `The prospectus claimed the colony had fertile land. [PB-P001]`
   > / `Thirty settlers departed in March.`
   > Composed edition adds a third paragraph — *"Company officials had secretly
   > known the soil was poisoned…"* — grounded in nothing. Both beats map; all
   > payload survives; the gate passes. The invention is invisible.

   For `revise` (transforming an existing draft) this is a minor risk; for
   `compose` (deliberately generating connective prose) it is *the* defining
   risk. Composition therefore needs **edition-side accounting**, not merely
   source-side.

3. **`revise` mode has a verbatim-drift failure class (TASK-50).** In 2/56
   editions the model declared a source unit `op: verbatim` but altered its bytes.
   The deterministic gate correctly refused both — not a tooling defect — but the
   failure is caught only *after* a full model call, and the remedy (stronger
   prompt discipline + a producer-side pre-emit self-check) is the *same*
   mechanism compose needs for op-legality. The two fold into one enforcement
   point.

**Structural fact that shapes the design:** a spine is *byte-structurally similar*
to a draft — the prototype feeds it through the same `deriveUnits` →
`[SOURCE UNIT n]` path, and the beats are source units. Consequently (a) mode
cannot be inferred from input structure, so it is an explicitly chosen operation;
and (b) the *source-side* machinery is reused unchanged. What compose adds is on
the *edition side* (grounding accounting) and in *op-legality* (mode-specific
rules), not in source derivation.

### Constraints

- **Constitution VII (subject-agnostic craft tool).** The tooling carries only
  generic capability; the consumer supplies the spine documents, voice catalog,
  and citation-marker conventions.
- **Honest trust boundary (inherited from voice-editions).** The gate proves
  *evidence and accounting*, never *semantic truth or prose quality*. Every
  guarantee below is classified as mechanically-enforced, producer-instruction,
  or advisory — and the report states its own limits.
- **No `any`/type bypass; DI; composition over inheritance; 300–500 line ceiling.**
  The prototype's inline `if (compose)` branches in `model.ts` refactor into a
  mode-keyed prompt module.
- **Impure output stays dot-zoned** (content-zone-segregation) — a composed
  edition is AI prose and routes to a `.ai/`-zoned path exactly as a revised
  edition does; this increment consumes that shipped contract, it does not
  re-specify layout.
- **Never weaken the gate.** Compose reuses the deterministic validator and *adds*
  checks; it introduces no laxer path.

## Trust model (the honest boundary)

Stated up front because the review showed the previous draft blurred it. Three
tiers, mirroring the parent voice-editions feature:

**Mechanically enforced (deterministic; a violation fails the gate):**
- every source beat has exactly one disposition (existing check, unchanged);
- **every edition unit has exactly one declared grounding record** (new — reverse
  accounting);
- cited/quoted/numeric payload survives byte-exact where a disposition requires it
  (existing check);
- no fabricated citation marker appears (existing check);
- in compose: no `verbatim` op; no `cut` op; **no edition unit byte-identical to a
  complete source beat it represents** (new — the real "never copy" rule);
- the requested operation matches the ledger's stamped `mode` (new — mode
  agreement);
- if the spine uses a declared open-question marker syntax, those marker bytes
  survive (new — conditional on a declared syntax).

**Producer instruction, not proven (prompt contract; cannot be gated):**
- invent no facts beyond what the beats + their sources support;
- render promotional/defense claims as attributed assertions ("the prospectus
  claimed"), never as established fact;
- preserve semantic uncertainty; do not resolve an open question with invented
  connective tissue;
- add only connective prose the beats support.

**Advisory / not-checkable (reported, not enforced):**
- semantic grounding of composed prose (`composition_semantic_grounding:
  not-checkable`);
- correctness of the spine's own citations (`spine_source_fidelity: not-checked`
  — upstream, out of scope here);
- a future optional model-based grounding review may live here.

The reverse-accounting rule does **not** prove a declared-`connective` paragraph
is fact-free — a model can mislabel. It guarantees only that **no unit exists
without a declared origin**, so nothing is added *silently*. That is the same
honest guarantee voice-editions already makes for causality/negation.

## Solution space

Two decisions drove the shape: **how the compose-vs-revise operation is selected**
and **what compose must additionally prove**. The mode-surface alternatives:

### Rejected — infer mode from input type (spine as a distinct document type)

Define a `loadSpine` and infer `compose` from a structurally-distinct spine.
**Rejected empirically:** a spine and a draft are the same kind of source-cited
markdown — no structural signature to discriminate on — and even a `kind: spine`
marker would describe the document's *role*, not the operator's *intent* (a spine
could be revised, summarized, or composed). Mode is an intent, not a byte-property.

### Rejected — declare mode as a production-control root-schema target field

Add `mode` to `BuildRequestSchema` as an operator-facing manifest field.
**Rejected:** a cross-package root-schema change for what is an invocation intent,
and it invites a manifest/intent mismatch. (Note: this is *not* the same as the
provider-recipe operation adopted below — that lives inside the reusable provider
config, not the root schema.)

### Rejected — provider-args as the sole human interface

Thread mode through a request-level provider-args field only. **Rejected as the
sole interface:** it hides an operator-facing intent inside a provider-internal
field with no visibility in command history, help, or logs. (The recipe-level
operation below *does* use provider config — but paired with visible CLI verbs,
which is what makes it honest.)

### Chosen — operation as invocation intent: two CLI verbs + a recipe declaration for governed builds

`voice compose` and `voice revise` are two named verbs over a shared
`buildEdition(mode, …)` core; the verb name *is* the mode and each verb's help
states its contract (direct/human use — the operator's "I choose at invocation").
When run as a **governed** production-control provider, the operation is fixed by
the **provider recipe** (e.g. `command: ["voice","compose"]` or a typed
`operation:` field) — a durable, graph-visible declaration of build intent that
lives where transformation selection belongs, **without** a production-control
root-schema `mode` field. The ledger stamps the operation it ran under, and the
validator requires **requested operation == ledger mode** (below), so intent is
declared independently of the artifact and the artifact cannot self-select its
rules. This preserves the CLI ergonomics, keeps governed builds reproducible and
stale-detectable, and adds no root-package coupling.

## Architecture

**One shared core, two thin verbs, an enriched ledger.**

```
voice compose spine.md voice.md ─┐
                                 ├─▶ buildEdition(mode, request) ─▶ prompt(mode) ─▶ model
voice revise  draft.md voice.md ─┘                                      │
   (governed: operation fixed by provider recipe)                       ▼
                                     parse { edition, coverage, grounding }
                                                                        │
                              op-legality + grounding self-check(mode)  │  pre-emit REFUSE on illegal
                                                                        │ (legal)
                                                                        ▼
                              emit edition + ledger (stamps mode, coverage, grounding)
                                                                        │
                     deterministic validator: requested-mode == ledger-mode;      │
                     source-side accounting + payload; EDITION-side grounding;     │  ← the trust anchor
                     compose op-legality + whole-unit no-copy; report limits       │
```

Source derivation, payload corroboration, and source accounting are reused
unchanged. Compose adds edition-side grounding and compose-specific op-legality.

### Mode-specific surface

| Concern | `revise` | `compose` |
|---|---|---|
| Prompt framing | re-narrate this draft | expand each beat into prose |
| `verbatim` op | allowed (must be byte-exact) | **forbidden** |
| `cut` op | allowed with reason | **forbidden** (v1 — every beat represented or merged) |
| Whole-unit copy | n/a | **forbidden** (no destination byte-identical to a beat) |
| Edition-side grounding | not required (v1; see follow-up) | **required** (every edition unit declares origin) |
| Fidelity contract | preserve quoted/cited/numeric payload byte-exact | + carry every asserted fact; invent nothing; claims-as-assertions; preserve declared open-question markers |

### Components

- **`prompt/` module (mode-keyed), extracted from `revise/model.ts`.** Two prompt
  contracts behind a `mode` parameter. The `revise` prompt is *hardened* for
  TASK-50 (verbatim == byte-exact, emphatically). The `compose` prompt demands a
  grounding declaration per edition unit.
- **`op-legality` check (new, pure, deterministic).** Given `(mode, coverage,
  sourceUnits, editionUnits)`: compose ⇒ no `verbatim`, no `cut`, no destination
  byte-identical to a complete beat; revise ⇒ each `verbatim` destination
  byte-exact to its source unit (the TASK-50 self-check). Shared normative logic
  (below).
- **`edition-grounding` check (new, pure, deterministic — compose).** Given the
  grounding records + derived edition units: every edition unit is declared
  exactly once as `grounded:[beats]` / `connective` / `framing`; no undeclared
  unit; no record naming a nonexistent unit. Does **not** judge semantic support.
- **`mode-agreement` check (new).** For a governed build, `requested_mode` (from
  the recipe/build integration) must equal `ledger.mode`; mismatch fails *before*
  op-legality. Standalone `voice fidelity` (no external declaration) validates per
  `ledger.mode` and the report states no independent comparison was available.
- **`buildEdition(mode, …)` core.** Runs the mode prompt, parses `{ edition,
  coverage, grounding }`, runs op-legality + grounding self-checks *pre-emit*,
  refuses named on any violation, else emits the edition (dot-zoned) + a ledger
  stamping `mode`, `coverage`, and `grounding`.
- **Ledger schema additions.** `mode` (provenance + judged-under) and, for
  compose, a `grounding` array (edition-unit → basis).
- **Validator mode-awareness.** Reads `mode`, enforces mode agreement, source-side
  accounting/payload (existing), edition-side grounding, compose op-legality +
  whole-unit no-copy, and emits the limits report.
- **Two CLI verbs.** `voice compose` / `voice revise` dispatch to `buildEdition`;
  help states each contract.

### Producer / validator independence

The op-legality and grounding predicates are **shared normative logic** (one pure
module), but the validator remains independent: it takes the emitted artifact plus
independently-supplied inputs (including `requested_mode`), the producer cannot
control whether validation runs, and **producer success never implies validator
success**. Shared policy ≠ self-certification.

### Data flow

Operator runs `voice compose spine.md voice.md` (or `revise`; governed builds get
the operation from the recipe) → resolve inputs (unchanged) → build the mode
prompt → model returns `{ edition, coverage, grounding }` → pre-emit op-legality +
grounding self-check (refuse named, before any write) → emit edition + ledger
(stamps `mode`/`coverage`/`grounding`) → later, `voice fidelity` checks
requested==ledger mode, source accounting + payload, edition grounding, compose
op-legality + no-copy, and reports the not-checkable limits.

### Error handling / refusals (all named, no silent fallback)

- compose declared `verbatim` → pre-emit refusal; validator independently fails.
- compose declared `cut` → pre-emit refusal (v1 forbids cut).
- compose destination byte-identical to a beat → refusal ("whole-unit copy").
- compose edition unit with no grounding record / undeclared unit → refusal.
- revise `verbatim` unit drifted (TASK-50) → pre-emit refusal (byte-mismatch);
  validator continues to fail as today.
- requested mode ≠ ledger mode → refusal before op-legality.

## Testing strategy

RED-first, deterministic unless noted. **Tests are split by what is actually
provable** (the review's core correction).

**Deterministic — expected to FAIL (real gate teeth):**
- compose ledger contains `verbatim`;
- compose destination byte-identical to a complete source beat (whole-unit copy);
- compose declares `cut`;
- compose edition unit missing a grounding record (undeclared invented paragraph);
- compose grounding record names a nonexistent edition unit;
- revise declares `verbatim` but destination bytes drift (TASK-50);
- source citation/numeral dropped; fabricated citation marker present;
- source beat unaccounted;
- governed build: `requested_mode == compose` but `ledger.mode == revise`
  (mismatch fails before op-legality);
- declared open-question marker dropped (only if a marker syntax is in use).

**Deterministic — expected to PASS while the report states the limit
(regression protection against future overclaiming):**
- a declared-`connective` paragraph that invents a fact → passes structurally;
  report says `composition_semantic_grounding: not-checkable`;
- composed prose invents causality while all payload survives → passes; report
  states the limit;
- an open-question marker survives byte-exact but the prose falsely resolves it
  elsewhere → passes; report states the limit.

**Advisory / prompt-eval (not deterministic gate):**
- invented-fact, promotional-as-fact, papered-over-open-question detection — a
  future model-based grounding review, not a deterministic fixture.

**CLI + regression:**
- `voice compose`/`voice revise` dispatch correctly; help states each contract;
- the full existing revise/fidelity suite stays green (compose is additive;
  source-side machinery unchanged; the 54 shipped editions remain valid).

## Decisions

1. **Operation is invocation intent with two surfaces.** `voice compose` /
   `voice revise` are the operator-facing verbs over a shared
   `buildEdition(mode, request)` core. For governed builds the operation is fixed
   by the **provider recipe** (not a production-control root-schema `mode` field,
   and not inferred from input type). The ledger stamps the operation; the
   validator requires **requested operation == ledger mode**.
2. **A spine is not a distinct byte-level file format and needs no loader** — it is
   ordinary source-cited markdown on the existing `deriveUnits` path. It *is* an
   input **role** that MAY carry optional authored conventions (e.g. an
   open-question marker) that compose validates deterministically *when present*.
   (Softened from the prior absolute claim, per review.)
3. **Compose op-legality (v1):** `verbatim` and `cut` are both forbidden — every
   beat is `represented` or `merged` (merge absorbs structural beats). No
   destination edition unit may be byte-identical to a complete source beat it
   represents. This dissolves the undeterminable "fact-bearing beat" predicate
   entirely. (Was the prior draft's fact-bearing cut rule.)
4. **Edition-side grounding accounting (compose, new):** every edition unit
   declares exactly one origin (`grounded:[beats]` / `connective` / `framing`);
   the validator proves every unit is declared exactly once. Prevents *silent*
   invention. Does not prove semantic support.
5. **Op-legality enforced defense-in-depth:** producer pre-emit self-check (fast,
   named, pre-write) AND the deterministic validator (the trust anchor). Shared
   normative policy, independent validation; producer success ≠ validator success.
6. **The ledger records `mode`, `coverage`, and (compose) `grounding`** — judged
   under an independently-supplied requested mode, never self-selected.
7. **TASK-50 folded in fully:** revise prompt hardened + pre-emit verbatim
   byte-exact self-check (the same mechanism), refusing drift at the producer.
8. **Prompt contracts extracted** into a mode-keyed `prompt/` module (file ceiling
   + isolated mode surface).
9. **Guarantee wording is split** (see Trust model): mechanically-enforced vs
   producer-instruction vs advisory. The prior draft's "invent nothing / carry
   every fact" language is producer-instruction; the report states not-checkable
   limits.
10. **"Never copy" is defined narrowly:** compose forbids the `verbatim` label AND
    whole-unit byte-identity; phrase-level reuse (citations/numerals/quotes that
    must survive) is not "copying." State it as "no whole-unit verbatim copying."
11. **Reverse accounting is compose-only in v1.** Applying it to revise would
    invalidate the 54 shipped editions (no grounding records); captured as a
    follow-up (`spawns:` frontmatter + backlog item). TASK-50 is still fully
    handled for revise.

## Open questions

1. **Grounding basis vocabulary.** `grounded:[beats]` / `connective` / `framing`
   is the working set; the exact enum + ledger field names are settled in the
   define/data-model pass. The design commits to *their existence and semantics*,
   not the final wire grammar.
2. **Open-question marker syntax.** IF mechanical preservation is wanted, the spine
   needs a declared marker (e.g. `[OPEN-QUESTION: …]`) tied to a unit; the define
   pass fixes the grammar. Absent a syntax, open-question preservation is
   prompt-only and advisory (not a deterministic fixture).
3. **Spine's own upstream fidelity is out of scope** — the spine is taken as the
   given source input; validating that the spine cites the right evidence is
   asset-bank territory (`design:feature/asset-bank`). Reported as
   `spine_source_fidelity: not-checked`.
4. **Whole-unit vs substring copy.** V1 draws the deterministic line at whole-unit
   byte-identity; substring-copy detection is deliberately out (citations/numerals
   force phrase reuse). Revisit only if empirically needed.

## Provenance

- **Prototype:** spike `spike/nouvelle-france-voice-lab`, commit `896c132` —
  env-gated compose in `voice-tooling/src/revise/model.ts`; Ep1 fidelity-passed
  (10 numerals + 3 citations byte-exact, no drift).
- **Empirical basis:** full-ebook run (56 editions, live model), 54/56 faithful;
  the 2 refusals were revise verbatim-drift (TASK-50).
- **Code verification:** `voice-tooling/src/fidelity/check-unit-accounting.ts`
  confirmed source-directed (accounts source units only) — the basis for adding
  edition-side grounding.
- **Tasks (this branch, feature/voice):** this design *is* the compose
  formalization — tracked by the roadmap item, which graduated from the spike's
  prototype (the spike branch also holds a `formalize-voice-compose-from-spine`
  task, unmerged; on this branch the roadmap item is the tracker). Folds in TASK-50
  (revise verbatim-drift). Spawns TASK-51 (revise-edition-side-accounting) as the
  follow-up to extend edition-side accounting to revise.
- **Predecessor design:**
  `docs/superpowers/specs/2026-07-27-voice-producer-protocol-design.md` (the
  producer + fidelity machinery reused unchanged on the source side).
- **Depends-on:** `design:feature/voice-producer-protocol` (shipped, spec 005).
- **Design conversation:** in-session, 2026-07-28, via `/stack-control:design`
  (backend `superpowers:brainstorming`). Operator approved shape (Part A),
  enforcement (Part B), testing/scope (Part C); chose two-CLI-verbs + full TASK-50
  fold-in; chose compose-only reverse accounting.
- **Third-party design review** (2026-07-28) drove a substantive revision: the
  directional-coverage gap (edition-side grounding), the requested==ledger mode
  invariant, the governed provider-recipe declaration, forbidding `cut` in compose
  v1, the whole-unit no-copy rule, an open-question marker syntax, and the
  mechanical/semantic guarantee split. Points accepted after code verification;
  the revise-reverse-accounting scope resolved to compose-only-now by operator.

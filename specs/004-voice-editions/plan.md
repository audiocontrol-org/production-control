# Implementation Plan: Voice editions

**Branch**: `feature/voice` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-voice-editions/spec.md`

**Design record** (authoritative for HOW): `docs/superpowers/specs/2026-07-25-voice-editions-design.md` (D1–D22)

## Summary

Voice editions let an operator produce a voice-varied edition of a single
source-locked draft: a `voice` is a first-class declared input (an ordinary
`authored` node — never a named living author, D17), an **impure** `voice revise`
provider rewrites narration and emits a per-source-unit disposition ledger in the
edition's frontmatter, and a **deterministic** `voice fidelity` validator
corroborates — never infers (D22) — that every source unit is accounted for and
every declared literal payload (quotes, citations, numerics, optional lexicon
terms) survives. The validator ships independently of the producer so any
edition, however produced, becomes checkable (D3). The capability lives in a new
standalone reusable craft package, sibling to `editorial-tooling`, with **no
change to production-control's core** (D1). Editions are impure machine artifacts
that route to the already-shipped dot-zoned `.ai/` root and are never hand-edited;
human polish lives in a separate `follows` companion in a human-safe area (D19).

## Technical Context

**Language/Version**: TypeScript, same toolchain as production-control's own
`src/` (`tsc`/`tsc-alias` build, `@/` path-alias convention, `strict` +
`noImplicitAny` + no `any`/`as`/`@ts-ignore`). **Deviation from the brief and
correction of it**: the brief that scoped this plan states "Bun runtime, matching
the repo." That is not correct — this repo runs on **Node** (`package.json`
`engines.node: ">=20"`, `tsx`/`tsc` scripts, `vitest`; no `bun.lockb`, no
`bunfig.toml`, no Bun reference anywhere in the codebase; the two doc hits for the
substring "bun" are both the word "bundle(r)"). The plan below targets Node, the
repo's actual runtime, and this discrepancy is flagged rather than silently
carried forward — see the final report for this artifact set.

**Primary Dependencies**: `yaml` (ledger + voice-document parsing, matching
`editorial-tooling`'s single dependency); Node's built-in `crypto` for
`sha256`; production-control's existing subprocess+JSON **provider** contract
(`BuildRequest`/`BuildResponse`) and **validator** contract
(`ValidateRequest`/`ValidateResponse`, `src/providers/contract.ts`). No API SDK
vendored into the package; the `voice revise` provider spawns a model CLI the same
way `editorial-tooling`'s `quote-miner.mjs` spawns `claude`. No production-control
source is imported by the package (Constitution IV) — it speaks the same wire
contracts editorial-tooling speaks, from outside.

**Storage**: files. A voice is an `authored` YAML document. An edition is a single
markdown file — the impure output — carrying its coverage ledger in YAML
frontmatter (D10); it lands under the target's dot-zoned `.ai/` root per
`impureOutputRoot()` (`src/zoning/route.ts`), a sibling of `dist/` directly under
the episode dir (D19, matching what content-zone-segregation shipped).

**Testing**: two layers, mirroring `editorial-tooling`'s own split —
1. **The package's own suite**: `node --test`, run via `node --import tsx --test`
   so the package's TypeScript sources run directly without a build step (matching
   this repo's `tsx` convention — user directive: use `tsx`, never `ts-node`).
   Adversarial-by-construction against fixture sources/editions, per the design
   record's Testing strategy section (a clean edition; one each for a dropped
   figure, an uncovered unit, a lying `represented` entry, a `cut` with no reason,
   a `cut` carrying a destination, a `merged` with no shared destination, a stale
   `source.hash`, a fabricated citation — every bad case must fail *naming the
   defect*; zero false-cleans is the pass criterion).
2. **production-control's own `vitest` suite**: integration tests over a fixture
   episode exercising `pc build` / `pc validate` end-to-end — routing to `.ai/`,
   validator gating, restale-on-voice-edit, drift-on-model-version (D18) — with no
   change to production-control's unit surface, matching quote-bank's precedent.

**Target Platform**: Node (macOS/Linux) CLI craft tools, orchestrated by `pc`.

**Project Type**: a standalone reusable craft package (new sibling of
`editorial-tooling`, tentatively `voice-tooling/`) + orchestration through
production-control's existing model (no core change).

**Performance Goals**: none load-bearing. The validator is linear in source/edition
size (one pass to derive units, one pass to check the ledger) and runs offline; the
producer's latency is the model's. Corpus measurement from the design record:
57–84 source units per chapter, ~480 ledger entries per full edition — informs
frontmatter-carrier acceptability (research.md R-LEDGER) but sets no numeric target.

**Constraints**: the validator is **deterministic, offline** (no LLM, no
similarity threshold, no network — quote-bank FR-009 discipline, reused verbatim
per D22); **no production-control core change** (D1, D3); files stay ≤300–500
lines (architecture guideline; Constitution "Files stay under 500 lines"); no
`any`/`as`/`@ts-ignore`; no fallbacks or mock data outside test code — throw and
name what is missing (Constitution V, Fail Loud). No `#` characters in bash
heredocs during authoring; no `sed` writes.

**Scale/Scope**: v1 governs exactly one source draft per target (D5); a target may
bind that source to several voices for a "voice lab" fan-out, each producing an
independent edition. No hard scale ceiling; the algorithm and ledger are specified
to handle whatever corpus is supplied (SC-007).

**Resolved v1 decisions (no NEEDS CLARIFICATION remains)**: the spec's
Clarifications session resolved every open question the design record had left:
separator-line unit granularity (no sentence-level split, FR-008); report-only
uncorroborated count with no refusal threshold (FR-022); an optional
hand-authored, byte-exact, case-sensitive lexicon with no Unicode normalization,
absent → `not-run` (FR-020); frontmatter ledger carrier with a carrier-independent
schema (FR-015). The one item explicitly left open — markdown constructs beyond
the current corpus (setext headings, MDX, HTML blocks, list items with blank
lines) — is deferred to test-design (golden-fixture coverage, not a blocking
unknown; see research.md R-FIXTURES).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Human-Authored Narrative (NON-NEGOTIABLE) — PASS, by construction outside core

This is the principle under most direct tension and is resolved explicitly, not
hand-waved. Principle I binds **production-control**: it "MUST NOT write, edit,
improve, or restructure creative work… and MUST NOT acquire the capability later."
`voice revise` unquestionably generates prose. The resolution is architectural, not
a reinterpretation of the principle:

- `voice revise` is **not production-control**. It is a specialized craft tool in
  a separate, independently-installable, independently-useful package (D3, mirrors
  Constitution IV — "Crafts remain specialized… Craft tools MUST remain
  independently useful outside production-control"). It can be run entirely by
  hand, `echo '<BuildRequest>' | node bin/voice-revise.mjs`, exactly as
  `quote-miner.mjs` can, with no production-control process involved.
- production-control's role is **orchestration only**: it resolves the target's
  declared `inputs` (source + voice) to local paths, invokes the provider
  subprocess, records what it produced (hash, provenance, impurity reason), and
  gates acceptance through the independent `validator`. None of that is "writing,
  editing, improving, or restructuring creative work" — it is the same
  build-a-subprocess-and-record-the-result act production-control already performs
  for the `script-provider` and `quote-miner`.
- The **deterministic** half, `voice fidelity`, never generates or infers (D22): it
  corroborates a producer's *declared* mapping against mechanical obligations. A
  validator that only ever answers "is what was declared mechanically true?" does
  not "generate prose, scripts, narrative structure, or editorial judgment" in any
  sense Principle I prohibits — it is closer to a linter than an author.
- **The boundary that makes this hold, stated as the gate**: if production-control
  ever imported the package's revision logic, called the model directly, or made
  the validator infer alignments it wasn't told, Principle I would be violated.
  The plan below keeps the package a subprocess speaking JSON over stdio
  (Constitution "Providers are subprocesses… never in-process plugins") with zero
  production-control source imports, so that boundary cannot be crossed by
  accident.

**Verdict**: PASS. The generative capability exists, but outside production-control
core, exactly where Constitution IV requires specialized craft to live; core
touches only orchestration and deterministic corroboration.

### II. Deterministic Production — PASS, with a stated exception

Freshness is computed from content hashes (source-unit `content_hash`, voice hash,
edition hash), never timestamps. The producer (`voice revise`) is **not**
deterministic — a model call — and it **declares itself impure** with a reason
(`impure: {reason}`, reusing `BuildImpureSchema`, FR-005), which is exactly what
Principle II requires for the case it cannot avoid ("Where a provider cannot be
deterministic… it MUST declare itself impure"). The validator (`voice fidelity`)
**is** fully deterministic — same ledger + same source + same edition bytes yields
the same verdict every run, no model, no network (D4, D22; mirrors quote-bank
FR-009's "no language model, no similarity threshold, and no network").

**Verdict**: PASS. The one non-deterministic component is declared, not hidden;
everything downstream of it (hashing, ledger validation) is fully deterministic.

### III. Explicit Provenance — PASS

Build-and-record stays one indivisible act, unchanged from production-control's
existing `build.ts` behavior: the provider's declared output is staged, hashed,
and the ledger entry (`producer`, `producer_impure`, `inputs`, `output`,
`built_at`) is written in the same act (`src/providers/build.ts`), with no new
skippable step introduced by this feature. The coverage ledger is **additional**
provenance carried *inside* the artifact (frontmatter, D10) — the per-unit
disposition record IS the product in the sense D22 describes ("the ledger is
therefore the authoritative editorial declaration, not a convenience record").
Nothing about this feature lets a build succeed without recording provenance, and
nothing records it in a separate, skippable step.

**Verdict**: PASS.

### IV. Crafts Remain Specialized — PASS

Voice-editions is editorial craft (narration revision), so it lives in its own
package, not production-control's orchestration layer (D3, FR-005). The package
is independently useful (runnable by hand against any source+voice+ledger,
irrespective of production-control), and providers receive **local, already-
resolved** input paths and emit local output files — they hold no credentials and
never touch object storage (Constitution "Providers receive local input paths and
emit local output files"). This mirrors `editorial-tooling` exactly.

**Verdict**: PASS.

### V. Fail Loud, Never False-Clean — PASS, this is the validator's whole design

Every failure mode in the spec's Edge Cases and FR-030 is a named, loud refusal,
never a fallback: an unaccounted source unit fails the run with no partial
edition (D20); an unreadable/non-UTF-8 source fails before any unit is processed;
a structurally invalid ledger is refused before fidelity is evaluated; an
interruption leaves the prior accepted edition untouched (existing stage-then-
rename, `src/providers/build.ts`); and — the sharpest instance of this principle
in the whole feature — **a validator that cannot decide an obligation exits
non-zero and emits NO verdict**, distinct from `failed`, never a false clean
(FR-030, SC-006). The coverage report itself is built around this: every check
carries an explicit state (`passed`/`not-run`/`reported`/`not-checkable`), so an
unrun applicable obligation can never hide behind a bare `passed` (FR-025, D15).
Uncorroborated entries are reported with a first-class count rather than silently
passed (D12, FR-022) — vacuous success is visible, not hidden.

**Verdict**: PASS.

### VI. The Oracle Is Authoritative; Providers Are Disposable — PASS

The manifest schema, the provider/validator wire contracts, and the ledger stay
untouched by this feature (D1: "no core change is required"). `voice revise` and
`voice fidelity` are ordinary `provider`/`validator` commands under a `TargetDecl`
— disposable, swappable for a different model or a different validator
implementation without the graph, contracts, or ledger schema changing. The
package does not teach production-control's oracle any voice-editions-specific
craft; it only adds a `voice` document type the oracle never interprets (FR-003:
"production-control MUST NOT interpret these fields").

**Verdict**: PASS.

### VII. Subject-Agnostic — PASS, with a normative refusal carrying the weight

A voice is expressed as generic, reusable narration traits — `narrator_distance`,
`evidence_posture`, `sentence_movement`, `paragraph_movement`, `transitions`,
`emotional_temperature`, `quote_handling`, `avoid` — never a named living author's
identity (D17, FR-004). This is enforced as a **documented refusal**, not a fake
mechanical check (a mechanical name-blocklist would be both incomplete and false
precision) — the schema and its accompanying documentation state the refusal in
words a producer and a reviewer both read. No subject specifics (a story name, a
publication, a research archive) appear anywhere in the package's schemas, code,
or fixtures; `examples/`-only fixtures follow the same convention as
`editorial-tooling`'s `test/fixtures/`.

**Verdict**: PASS.

**Overall Constitution Check: PASS on all seven principles.** No Complexity
Tracking entry is required.

## Project Structure

### Documentation (this feature)

```text
specs/004-voice-editions/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── voice-revise-provider.md
│   ├── voice-fidelity-validator.md
│   ├── coverage-ledger-schema.md
│   └── voice-document-schema.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not produced here)
```

### Source Code (repository root)

A new standalone package, sibling to `editorial-tooling/`, matching its shape
(package.json + bin/ + src/ + test/) but written in TypeScript per this repo's
own convention (`@/` imports inside the package's own `src/`, strict typing, no
`any`/`as`/`@ts-ignore`):

```text
voice-tooling/                       # tentative package name — sibling of editorial-tooling/
├── package.json                     # name, bin (voice-revise, voice-fidelity), deps: yaml
├── bin/
│   ├── voice-revise.mjs             # thin entry: reads stdin, invokes src/revise/*, writes stdout
│   └── voice-fidelity.mjs           # thin entry: reads stdin, invokes src/fidelity/*, writes stdout
├── src/
│   ├── schema/
│   │   ├── voice.ts                 # Voice document schema + loader (D17); no-author-imitation refusal
│   │   └── ledger.ts                # Coverage ledger schema + loader (D10); carrier-independent
│   ├── units/
│   │   ├── derive.ts                # D6 normative source-unit derivation (byte-exact)
│   │   └── identity.ts              # (source identity, content_hash, occurrence_index) triple (D6.9)
│   ├── payload/
│   │   ├── extract.ts               # numeric literals, citation markers, blockquote spans, lexicon
│   │   └── match.ts                 # unit-local, byte-exact, multiset matching (D11, D13)
│   ├── fidelity/
│   │   ├── check-source-hash.ts     # ordered check 1: source.hash match (D15 checks.source_hash)
│   │   ├── check-ledger-structure.ts# structural validity (D20): unknown unit, dup disposition, etc.
│   │   ├── check-unit-accounting.ts # every source unit has exactly one disposition (D8, SC-001)
│   │   ├── check-op-obligations.ts  # per-op mechanical obligation (verbatim/represented/merged/cut)
│   │   ├── check-payload.ts         # quotes/citations/numerics/lexicon survival (D11–D13)
│   │   ├── report.ts                # assembles the structured coverage report (D15)
│   │   └── run.ts                   # orchestrates the ordered check sequence; ValidateResponse
│   ├── revise/
│   │   ├── request.ts               # BuildRequest parsing; resolves source + voice inputs
│   │   ├── model.ts                 # spawns the model CLI (mirrors quote-miner's claude adapter)
│   │   └── emit.ts                  # writes the edition + frontmatter ledger; BuildResponse, impure
│   └── contract.ts                  # re-exports the wire types this package speaks (no pc import)
└── test/
    ├── fixtures/
    │   ├── sources/                 # fixture source drafts (incl. golden-unit-derivation fixtures)
    │   ├── voices/                  # fixture voice documents
    │   └── editions/                # clean + adversarial fixture editions (per design Testing strategy)
    ├── units-derive.test.ts         # golden unit derivation (LF/CRLF, fenced code, frontmatter, etc.)
    ├── ledger-schema.test.ts
    ├── voice-schema.test.ts         # incl. the no-author-imitation refusal
    ├── fidelity-*.test.ts           # one file per check module, plus adversarial end-to-end cases
    └── revise.test.ts               # stubbed-model producer test: declares impure, no self-verdict
```

Each `src/` file is scoped to one concern (schema, unit derivation, payload
extraction, one fidelity check, or the producer) specifically so no file
approaches the 300–500-line ceiling — the ordered-check design in `fidelity/`
exists as much for this as for readability: a single `validate.ts` doing source-
hash, structure, accounting, per-op obligations, and payload matching in one file
would not fit the guideline by the time adversarial-case handling is included.

**Structure Decision**: new sibling package `voice-tooling/` (name to be
confirmed at implementation time; `voice-tooling` avoids colliding with the
`editorial-tooling` naming pattern while staying descriptive) at the repository
root, alongside `editorial-tooling/`. production-control's own `src/`, `tests/`,
and `profiles/` are extended only with a `voice-revise`/`voice-fidelity`
`TargetDecl` wiring in profile YAML and fixture episode manifests under
`tests/integration/` — no change to `src/manifest/schema.ts`,
`src/providers/contract.ts`, `src/zoning/*`, or `src/ledger/schema.ts` (D1, D3,
Constitution VI).

## Complexity Tracking

*No entries.* The Constitution Check above passed all seven principles without a
justified violation; the tension on Principle I is resolved architecturally
(package placement, D3), not by an accepted exception to the principle itself.

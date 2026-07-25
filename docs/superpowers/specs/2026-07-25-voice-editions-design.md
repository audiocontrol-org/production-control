# Voice editions — design record

**Roadmap item:** `design:feature/voice-editions`
**Date:** 2026-07-25
**Status:** awaiting operator approval (`design-approved:` marker)

## Problem domain

### What surfaced this

The `nouvelle-france` repo ran a spike on branch `spike/codex-authorship` (one
commit, `a8aa7d5`, 39 files, +1495) that treats narrative voice as an explicit,
testable set of editorial controls rather than an opaque request to imitate an
author. It decomposes a voice into observable dimensions — narrator distance,
evidence posture, sentence and paragraph movement, transitions, emotional
temperature, quote handling, hard avoids — and holds a revision against a locked
source draft whose facts, chronology, citations, quotations, documented conflicts
and uncertainty wording may not change.

The method works. Verified directly against the one substantive deliverable
(`content/ebook-voice-editions/archival-restraint/prologue.md` vs
`content/ebook/prologue.md`):

- all 10 blockquotes byte-identical;
- all 11 citation markers and all 3 source ids preserved;
- `npm run validate:script` passes;
- 1493 → 1021 words (−32% compression).

That is one chapter of a promised 32 (4 editions × 8 narrative units). The
spike's own process log is explicit and honest that the batch is "**in progress**,
not complete" and that the earlier comparison fragments "must not be represented
as" full-edition chapters.

### Why it cannot stay as it is

1. **The invariants are enforced by prose, not code.** Only citation resolution
   and the frontmatter allow-list are automated. Byte-for-byte quote survival,
   "no source-backed claim silently cut" across a 32% compression, ledger
   completeness, and profile distinctiveness are asserted in a hand-written
   ledger. Quote fidelity was confirmed here with a ~20-line script — the
   highest-value check is trivially automatable and is not automated.
2. **The stated gates overstate their coverage.** `PRODUCTION-PLAN.md` lists
   `validate:ebook` / `validate:ebook:citations` as acceptance gates, but both
   scripts are hardcoded to a single `EBOOK_DIR`. The voice editions are
   structurally invisible to them.
3. **The capability is machine-local.** The driving skills (`voice-profile-lab`,
   `source-faithful-revision`, `spoken-documentary-voice`,
   `narrative-forward-drive`) live in `/Users/orion/.codex/skills/` — unversioned,
   outside the repo, one vendor. The committed docs reference them by absolute
   path, so a clone gets the documentation of a workflow it cannot run.
4. **No schema, loader, or types** for the new YAML. `edition.yml` carries an
   undocumented discriminated union (`profile:` singular vs `profiles:` map) with
   nothing to parse or validate it.

### What production-control already provides

The core turns out to have been built for this. `TargetDecl` binds `inputs` to an
`impure` provider and an **independent** `validator`, and `src/providers/contract.ts`
states the principle in as many words:

> an impure tool (a language model) can build the artifact, and a separate
> deterministic validator decides whether it passes — the generator never gets to
> certify itself.

`specs/002-quote-bank` is the working precedent for that pairing: an impure miner
plus a deterministic fidelity validator, in a separate reusable package, with no
core change (FR-022).

### The one structural difference from quote-bank

A quote is **literal source text**, so quote-bank's gate can be *fully*
deterministic. A voice edition is **derived prose**, so its invariants are only
*partly* mechanizable. That asymmetry is this design's center of gravity, and
everything below follows from it.

## Solution space

### Chosen — voice as a declared input, plus a coverage ledger the validator corroborates

A voice is a first-class declared input governing how **any** prose-producing
target narrates. An "edition" is not a special entity — it is the same source
bound to a different voice input. Fidelity is proven by a deterministic core plus
a per-unit ledger whose entries the validator mechanically corroborates.

Chosen because it is the only option that makes a silent claim-drop *impossible to
perform quietly* while keeping every check exact — no model, no similarity
threshold — and because it needs no change to production-control's core.

### Rejected — voice editions of an existing locked draft only

Narrower and closer to the spike: the capability re-narrates an already-approved
draft, source-locked, and nothing else.

Rejected: it excludes originals (a chapter built from a spine and a quote bank),
which is where voice governance is arguably most valuable. Voice would become a
property of one workflow instead of a property of the production graph.

### Rejected — a voice lab (comparison and selection apparatus)

The deliverable would be the experiment harness: locked passage, N variants, blind
comparison, rubric scoring, promotion of winning rules back into a voice.

Rejected as the *primary* unit: it produces a chosen house voice, not governed
output. The lab is a mode of use that falls out of the chosen design (bind one
source to several voices) rather than the capability itself.

### Rejected — deterministic core only, claim survival left to human review

Gate strictly on what code can prove (quote survival, citations, structure), with
claim survival and invented inference explicitly outside the gate.

Rejected: honest about its limits, but it reproduces the spike's actual weakness at
scale — 32 units × N voices with no mechanical backstop for the one invariant that
matters most.

### Rejected — an independent model auditor as part of the gate

A second model, independent of the producer, audits the edition for dropped claims,
invented causality, and overstated certainty.

Rejected (operator decision): it makes the gate itself impure — the same artifact
could pass and then fail. A nondeterministic gate can false-clean, which is the
specific failure the ledger exists to prevent. Retained as a possible *advisory,
never-blocking* signal in a later feature.

### Rejected — profile-conformance scoring in the gate

Check that an edition measurably exhibits its declared voice and is distinguishable
from its siblings.

Rejected (operator decision) for this feature. The `avoid` list is partially
mechanizable (scan for banned constructions) and is a natural later addition;
distinctiveness itself is not mechanizable and would import a threshold.

### Rejected — deriving the ledger instead of declaring it

Have a deterministic aligner diff source units against the edition and compute the
mapping itself, removing the producer's opportunity to misreport.

Rejected on principle: aligning heavily-rewritten prose to its source requires a
similarity threshold, and quote-bank's FR-009 requires a verdict reached with "no
language model, no similarity threshold, and no network." The gate's correctness
would rest on a tuning constant. Declared-then-corroborated keeps every check exact.

### Rejected — build it into production-control's core

A voice schema, a `pc voice` verb, coverage logic in `src/`.

Rejected: the core is deliberately subject-agnostic — "a profile is a generic,
reusable recipe… it is subject-agnostic and describes roles and transformations,
not content or specific stories." Narrative voice is editorial content. This would
put domain judgment in the graph engine and every future asset type would claim the
same privilege.

### Rejected — block on `design:feature/directory-outputs`

Sequence directory outputs first so an edition can be a directory (prose + ledger)
from day one.

Rejected as a *coupling*, not on merit — see Decisions D7. Directory outputs should
be implemented, but on their own merits and not inside this feature.

## Decisions

**D1 — Voice is a first-class declared input to any prose target.**
A voice is an ordinary **authored node** (`authored` is
`record<Identity, {path, follows?}>`) referenced by identity in a target's `inputs`
(`Identity[]`). Both mechanisms already exist, so **no core change is required** for
voices to become graph citizens. An "edition" is the same source bound to a
different voice.

**D2 — It is called a `voice`, never a `profile`.**
`profile` already means *build recipe* in this system (`ProfileNameSchema`,
`EpisodeManifest.profile`, `profiles/editorial-audio.yaml`). Two concepts sharing one
word in the same manifest is a permanent tax.

**D3 — A separate reusable package with two entry points; validator first.**
`voice revise` (impure provider, declares `impure: {reason}`, reports **no** validation
verdict of its own) and `voice fidelity` (deterministic validator). Mirrors quote-bank
FR-022. The validator ships first: it is the trust anchor and delivers value alone —
an edition produced by *any* means (the existing Codex skills, another model, a human
editor) becomes checkable the moment it exists.

**D4 — The gate is a deterministic core plus a coverage ledger.**
The validator proves the mechanizable set AND that the ledger accounts for every
source claim-bearing unit exactly once. Whether a given cut was *wise* stays human;
whether a unit was *silently dropped* becomes mechanical.

**D5 — Claim-bearing units are derived from the source and content-hashed.**
Strip frontmatter, split at blank lines into block-level units, normalize by stripping
per-line trailing whitespace and nothing else, `id = "u:" + sha256(utf8 bytes)`
truncated to 12 hex. Two byte-identical units in one source are legal and disambiguated
by occurrence index. A reworded source paragraph yields a new id, forcing the edition to
re-account for it — correct behavior, not a defect. Derivation must be specified to the
byte so an independent implementation reproduces identical ids (quote-bank FR-024
discipline).

**D6 — Ledger operations are a closed set, each carrying a mechanical obligation.**

| `op` | What the validator proves, deterministically |
| --- | --- |
| `kept-verbatim` | the unit's text appears exactly in the edition |
| `kept` / `compressed` / `moved` | the unit's payload survives somewhere in the edition |
| `merged-into` | payload survives; the named target unit exists in the ledger |
| `cut` | the text does **not** appear, and `reason` is non-empty after trimming |

A producer that misreports now has to misreport something the validator can catch.

**D7 — The ledger's schema is carrier-independent; today's carrier is frontmatter.**
`src/providers/invoke.ts:101` hard-refuses more than one output per target ("A record
names exactly one output… Declare one target per output") — a deliberate rule tied to
FR-014 that directory support would *not* relax. So the ledger is embedded in the
edition's YAML frontmatter, consistent with the frontmatter those files already carry.
The schema is defined as a self-contained YAML document with one loader, so a later move
to a sidecar in a directory output is a **carrier swap in the provider and validator,
not a redesign**.

**D8 — Payload is the unambiguous set, plus an optional declared lexicon.**
Always enforced with no heuristics: numeric literals, citation markers, and verbatim
quoted spans. Named entities are checked only against a project-declared lexicon. When
no lexicon is declared the validator **passes and reports that entity survival was not
checked** — it never claims a coverage it did not perform. A capitalized-token heuristic
was rejected: false alarms on sentence-initial capitals and non-English sources would
train operators to ignore the gate.

**D9 — Spelled-out numerals go through the lexicon, not a second mechanism.**
The sources spell numbers out ("Two hundred and sixty Italians and thirty French",
"twenty-four have died"), so a digit-only extractor would miss exactly the claims that
matter. Those instances sit inside blockquotes and are caught byte-for-byte, but
narration around them ("roughly two dozen graves") is not. "twenty-four" and "Nouméa"
are the same kind of must-survive term, so one mechanism covers both and the check stays
fully deterministic.

**D10 — Three checks beyond coverage.**
(a) `ledger.source.hash` must equal the hash of the source input the validator was
handed, catching a ledger written against a different draft; (b) every source unit id
appears exactly once — unknown ids and duplicates are refusals; (c) the edition's
citation set must equal the source's and stay inside the frontmatter allow-list.

**D11 — Freshness: voice edits restale; model-version changes drift.**
A voice is authored content that materially determines the output, so an edition built
from an older voice genuinely *is* out of date. Restaling only *reports* out-of-date —
rebuilding stays the operator's call, so it does not stampede N editions. A model
version change is producer **drift**, never an auto-restale (quote-bank FR-020);
regeneration is a deliberate human act.

**D12 — Failure levels, mirroring quote-bank FR-015.**
A unit the producer cannot account for fails the run with **no partial edition emitted**;
an unreadable or non-UTF-8 source fails before any unit is processed; a structurally
invalid ledger (unknown id, duplicate, dangling `merged-into`, empty `cut` reason) is
refused **before** fidelity is evaluated; an interruption leaves the previously accepted
edition untouched via the existing stage-then-rename; a validator that cannot decide
exits non-zero and produces **no verdict** — distinct from `failed`, never a false clean.

**D13 — Blended voices are deferred to a later feature (operator decision).**
See Deferred scope. The per-unit ledger MUST remain additively extensible so
`function:` and `voice:` fields can land later without a breaking change.

## Deferred scope (captured, not built)

Per the `capture-over-yagni` house rule these are recorded rather than discarded. They
were explicitly scoped out by the operator, not dropped by YAGNI.

### Blended voices — voice varying by narrative function

The spike's fourth edition, `function-blend`, assigns voices by editorial job rather than
averaging them: archival restraint for exposition, investigative momentum for turns and
causal explanation, intimate witness for documented consequence and reflection. Its
production plan required that the ledger "identify the function at each major turn so that
it remains reproducible."

The per-unit ledger is already the right substrate — voice attribution is a field on an
entry that exists. The design explored and settled before deferral:

- **Representation:** a composite voice file mapping `function -> voice`.
- **Assignment:** the producer classifies each unit's narrative function and records both
  the function and resolved voice in that unit's ledger entry; an optional authored
  function map lets the operator **pin** any unit, overriding the producer. The ledger
  records which source the assignment came from, so a blend is reproducible and auditable.
- **Deterministic checks available:** every recorded function resolves in the blend map;
  every unit names a voice.
- **Unresolved — the freshness edge.** A blend names constituent voices, so if a target
  declares only the blend as an input, editing a constituent will **not** restale the
  blended editions. Silent staleness, the exact class this system exists to prevent.
  Three candidate mechanisms, none chosen:
  1. *A blend is a built target* — a derived voice compiled from its constituents by a
     pure deterministic merge, so the graph handles transitive freshness natively and the
     edge cannot be forgotten. The edition then consumes one hash-identified resolved
     voice, so provenance records exactly what governed it. (Was the standing
     recommendation at deferral.)
  2. *The target declares every constituent explicitly* — no new machinery, but forgetting
     one fails silently.
  3. *The blend content-pins constituent hashes* — tamper-evident, but every voice edit
     requires re-pinning by hand across every blend referencing it.

**This must be resolved before blends ship.** Recommend a follow-on roadmap item.

### Other deferred items

- **Model-auditor advisory** — an independent model auditing for dropped claims, invented
  causality, and overstated certainty, as a **non-blocking** advisory alongside the
  deterministic gate.
- **`avoid`-list conformance** — mechanically scanning for a voice's declared banned
  constructions. Partially deterministic and a natural extension of D8.
- **Fan-out ergonomics** — N voices × M units means N×M hand-authored target declarations
  (4 × 8 = 32 in the spike). This is precisely what `design:feature/episode-scaffolding`
  exists to solve; it is a consumer relationship, not work for this feature.
- **Per-edition HTML and PDF bundles** — promised by the spike's production plan. A natural
  consumer of directory outputs.

## Open questions

1. **Hand-edited editions vs. the machine-artifact lifecycle. (Most likely to bite.)**
   `src/providers/validate.ts:146` refuses to validate when the on-disk artifact does not
   match its recorded hash, directing the operator to rebuild. Correct for machine
   artifacts — but an edition is a document a human editor will want to polish, and the
   editorial workflow this came from assumes exactly that. Rebuilding destroys the edit;
   the escape hatch is a waiver, which discards the fidelity proof rather than
   re-establishing it. An attractive property is available — the fidelity gate does not
   care *who* wrote the prose, so a human edit could be proven by the same check as machine
   output — but realizing it needs a way to re-record an artifact's hash without
   regenerating it. That is core lifecycle semantics and should not be invented here.

2. **Coverage does not apply to originals.** D5 derives units from a source draft. A target
   with no source draft (a chapter built from a spine and a quote bank) has nothing to
   derive from, so the gate degrades to the deterministic core. Whether originals should
   instead cover a declared claim/asset set — the `design:feature/asset-bank` direction —
   is unresolved. Deciding it early would avoid a second ledger dialect later.

3. **Unit granularity.** Block-level split at blank lines is the proposal. Whether a long
   multi-claim paragraph should decompose further (sentence level) is untested; too coarse
   weakens the guarantee, too fine makes the ledger unusable for humans.

4. **Lexicon provenance.** D8's declared lexicon has no defined origin. Hand-authored per
   project, or derived from the quote bank / spine? Deriving it is attractive but couples to
   asset-bank.

5. **Does the ledger belong in the reading copy?** A 30-entry ledger is a substantial
   frontmatter block in a file humans open to read prose. D7 keeps the schema
   carrier-independent so this can change, but the reading experience is untested.

## Dependencies and consumer relationships

Recorded so the relationships are visible on the roadmap rather than folklore. None of
these are duplicated by this feature.

- **`design:feature/directory-outputs` (TASK-1) — not a blocker, deliberately.** Two distinct
  rules were confirmed: `onlyOutput` (exactly one output per target, `invoke.ts:101`) is
  deliberate and directory support would *not* relax it; `isFile` (`run.ts:245`) is the
  actual constraint. The expensive part already exists — `hash/tree.ts` (147 lines, tested)
  and the file-vs-dir dispatch at `hash/path.ts:28`, which is why directory *inputs* already
  work. Remaining mechanical work: `hashFile` → `hashPath` in `invoke.ts:78` and
  `validate.ts:135`; relax `isFile` to an existence check; teach `stage()` a directory copy
  (the rename stays atomic within `dist/`); teach the undeclared-file walk that a declared
  directory covers everything beneath it. What is *not* free is the semantics: `modified`
  detection against a tree, whether declaring `edition/` claims everything under it (which
  interacts with TASK-5), empty-directory-as-success, and symlinks in a produced tree. It has
  at least three independent consumers (the website provider it currently blocks, this
  feature, and per-edition HTML/PDF bundles), so it should be built on its own merits rather
  than smuggled in as one caller's implementation detail. D7 makes the eventual adoption a
  carrier swap.
- **TASK-14 (`gap/real-model-identity-for-drift`)** — D11's drift reporting is only meaningful
  if the real model identity is recorded in the producer tool/version provenance. This feature
  is a consumer.
- **TASK-13 (`bug/model-output-parse-kills-long-build`)** — a multi-unit edition build is
  exactly the long-running shape where a single parse failure kills the whole run. N units × M
  voices will hit it.
- **`design:feature/episode-scaffolding`** — fan-out ergonomics, see Deferred scope.
- **`design:feature/asset-bank`** — bears on open questions 2 and 4.
- **TASK-5 (`gap/cross-target-output-collision`)** — interacts with directory-output semantics.

## Testing strategy

The validator carries the weight, so its tests are adversarial by construction. Against a
fixture source, hand-written editions: one clean, plus one each for a dropped figure, an
uncovered unit, a **lying `kept`** (entry claims kept, payload absent), a `cut` with no
reason, a stale `source.hash`, a dangling `merged-into`, and a fabricated citation. Every bad
one must fail *naming the defect*. **Zero false-cleans** is the success criterion.

Alongside those:

- **Determinism** — the same edition and inputs yield an identical verdict on every run, with
  no model and no network.
- **Golden unit derivation** — a fixture source pinned to exact expected unit ids, which is
  what makes D5 independently reimplementable.
- **Producer** — with a stubbed model, assert the provider declares itself impure and reports
  no validation verdict of its own.
- **Integration** — end-to-end `pc build` / `pc validate` over a fixture episode, including the
  restale-on-voice-edit and drift-on-model-version behaviors from D11.

## Provenance

- **Design backend:** `superpowers:brainstorming`, driven in-session by `/stack-control:design`
  under house-rules block `stack-control-design-v1`.
- **Roadmap item:** `design:feature/voice-editions`, added 2026-07-25.
- **Originating spike:** `nouvelle-france` repo, branch `spike/codex-authorship`, commit
  `a8aa7d5` "docs: add editorial voice experiment framework" (39 files, +1495). Worktree at
  `/Users/orion/work/nouvelle-france-codex-authorship`.
- **Spike artifacts reviewed:** `PROCESS-CODEX-EDITORIAL.md`;
  `docs/editorial/AI-OUTPUT-IMPROVEMENT.md`; `content/editorial-voices/` (3 voice YAMLs);
  `content/ebook-voice-editions/PRODUCTION-PLAN.md` and its 4 `edition.yml` manifests;
  `content/ebook-voice-editions/archival-restraint/{prologue.md,revision-ledger.md}`;
  `content/ebook-editorial-experiments/` (2 comparison dirs);
  `content/podcast-editorial-experiments/2026-07-24-ep07-forward-drive/`;
  `/Users/orion/.codex/skills/voice-profile-lab/SKILL.md`.
- **Fidelity verification performed during design** (not asserted from the spike's ledger):
  blockquote and citation extraction over
  `content/ebook-voice-editions/archival-restraint/prologue.md` against
  `content/ebook/prologue.md` — 10/10 blockquotes byte-identical, 11/11 citation markers and
  3/3 source ids preserved, 1493 → 1021 words.
- **production-control sources consulted:** `src/manifest/schema.ts`,
  `src/providers/contract.ts`, `src/providers/invoke.ts`, `src/providers/run.ts`,
  `src/providers/build.ts`, `src/providers/validate.ts`, `src/providers/validate-run.ts`,
  `src/ledger/schema.ts`, `src/hash/tree.ts`, `src/hash/path.ts`,
  `profiles/editorial-audio.yaml`, `specs/002-quote-bank/spec.md`, `ROADMAP.md`, backlog
  TASK-1 / TASK-5 / TASK-13 / TASK-14.
- **Operator decisions recorded during the session:** primary unit = voice as a governed input
  to any prose target; gate = deterministic core + coverage ledger (model auditor and
  profile-conformance scoring declined); unit identity = derived and content-hashed;
  corroboration = checkable operations; payload = unambiguous set + optional lexicon; blended
  voices = deferred to a later feature; directory outputs = not blocked on, ledger schema kept
  carrier-independent.

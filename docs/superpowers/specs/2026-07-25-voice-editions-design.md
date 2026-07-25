# Voice editions — design record

**Roadmap item:** `design:feature/voice-editions`
**Date:** 2026-07-25 (revised same day after third-party review)
**Status:** awaiting operator approval (`design-approved:` marker)
**Blocked by:** `design:feature/artifact-adoption`

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
not complete."

### Why it cannot stay as it is

1. **The invariants are enforced by prose, not code.** Only citation resolution
   and the frontmatter allow-list are automated. Quote survival, claim survival
   across a 32% compression, and ledger completeness are asserted in a
   hand-written ledger. Quote fidelity was confirmed here with a ~20-line script —
   the highest-value check is trivially automatable and is not automated.
2. **The stated gates overstate their coverage.** `PRODUCTION-PLAN.md` lists
   `validate:ebook` / `validate:ebook:citations` as acceptance gates, but both
   scripts are hardcoded to a single `EBOOK_DIR`. The voice editions are
   structurally invisible to them.
3. **The capability is machine-local.** The driving skills live in
   `/Users/orion/.codex/skills/` — unversioned, outside the repo, one vendor. The
   committed docs reference them by absolute path, so a clone gets the
   documentation of a workflow it cannot run.
4. **No schema, loader, or types** for the new YAML.

### What production-control already provides

`TargetDecl` binds `inputs` to an `impure` provider and an **independent**
`validator`, and `src/providers/contract.ts` states the principle directly:

> an impure tool (a language model) can build the artifact, and a separate
> deterministic validator decides whether it passes — the generator never gets to
> certify itself.

`specs/002-quote-bank` is the working precedent: an impure miner plus a
deterministic fidelity validator, in a separate reusable package, with no core
change (FR-022).

### The structural difference from quote-bank, and the honest guarantee

A quote is **literal source text**, so quote-bank's gate can be *fully*
deterministic. A voice edition is **derived prose**, so its invariants are only
*partly* mechanizable. Three properties must be kept distinct, and conflating them
was the central defect of this record's first draft:

| Property | Provable? |
| --- | --- |
| **Accounting completeness** — every source unit carries exactly one declared disposition | **Yes**, fully deterministic |
| **Literal-payload preservation** — configured literal payload survives where an operation requires it | **Yes**, fully deterministic |
| **Claim fidelity** — factual meaning, relationships, qualifications, uncertainty and causality are preserved | **No**, not under these constraints |

No deterministic token-presence check establishes semantic entailment, causal
fidelity, negation survival, or uncertainty preservation. A source unit reading
*"The expedition departed in January despite warnings that the food stores were
already spoiled"* can be reduced to *"The expedition departed in January."*,
marked `represented`, and satisfy every mechanical obligation while losing the
central claim. Equally, an edition can retain every required literal while
inverting the relationship among them.

**The guarantee this feature provides, stated honestly:**

> The gate makes unaccounted source-unit omission impossible and mechanically
> verifies preservation of declared literal payload. It does **not** prove
> semantic claim equivalence for rewritten prose, and it does **not** validate
> that an edition conforms to its declared voice.

That is a narrower promise than the first draft made, and it is defensible.

## Solution space

### Chosen — v1: governed source-locked revision, voice as a declared input, coverage ledger with edition-side destinations

A voice is a first-class declared input. v1 governs **revision of an existing
source draft**, where every source unit can be derived and accounted for. Fidelity
is proven by a deterministic literal core plus a per-unit disposition ledger that
names, for each source unit, the **edition units** that carry it.

Chosen because it is the only option whose stated guarantee matches what the
validator can actually establish, and because it needs no change to
production-control's core.

### Rejected for v1 — voice governing any prose target, including originals

The first draft chose this, on the reasoning that voice governance matters most
for original composition (a chapter built from a spine and a quote bank).

Rejected: it is **incoherent as specified**. Coverage derives source units from a
source draft; an original has none, so the central mechanism vanishes and the gate
silently degrades to citation and structural checks. The first draft rejected the
narrower option *because* it excluded originals, then conceded in its own open
questions that coverage does not apply to them — rejecting an alternative for a
reason the chosen design did not deliver. Original composition returns as the
immediate follow-on once claim/asset-set coverage exists (see Deferred scope).

### Rejected — two explicit fidelity modes now (revision + composition)

Define `revision` mode (coverage over source units) and `composition` mode
(coverage over declared evidence assets) in this feature.

Rejected: composition mode needs a real design now, not degradation to an
unspecified core. That is most of a second feature, and it depends on
`design:feature/asset-bank`.

### Rejected — voice governance with optional source validation

Voice governs any prose target; source-coverage validation applies only when a
source draft exists.

Rejected: honest, but it makes the headline guarantee conditional in a way that is
hard to communicate — two classes of "validated" edition with materially different
contracts under one verb.

### Rejected — a voice lab (comparison and selection apparatus)

The deliverable would be the experiment harness: locked passage, N variants, blind
comparison, rubric scoring, promotion of winning rules into a voice.

Rejected as the primary unit: it produces a chosen house voice, not governed
output. The lab falls out of the chosen design (bind one source to several voices).

### Rejected — deterministic core only, claim survival left to human review

Gate on quote survival, citations, and structure; leave everything else to humans.

Rejected: it reproduces the spike's actual weakness at scale — hundreds of units
with no mechanical backstop and no record of what was dropped.

### Rejected — an independent model auditor as part of the gate

A second model audits for dropped claims, invented causality, overstated certainty.

Rejected (operator decision): it makes the gate itself impure — the same artifact
could pass then fail. Retained as a possible **non-blocking advisory** later. This
is the only mechanism that addresses claim fidelity at all, which is precisely why
it must not be confused with the deterministic verdict.

### Rejected — profile-conformance scoring in the gate

Check that an edition measurably exhibits its declared voice.

Rejected (operator decision) for v1. The `avoid` list is partially mechanizable and
is a natural later addition; distinctiveness is not, and would import a threshold.

### Rejected — deriving the ledger instead of declaring it

Have a deterministic aligner diff source units against the edition and compute the
mapping, removing the producer's opportunity to misreport.

Rejected on principle: aligning rewritten prose requires a similarity threshold,
and quote-bank FR-009 requires a verdict reached with "no language model, no
similarity threshold, and no network." Declared-then-corroborated keeps every check
exact.

### Rejected — build it into production-control's core

Rejected: the core is deliberately subject-agnostic — "a profile is a generic,
reusable recipe… it is subject-agnostic and describes roles and transformations,
not content or specific stories." Narrative voice is editorial content.

### Rejected — block on `design:feature/directory-outputs`

Rejected as a coupling, not on merit — see D9 and Dependencies.

## Decisions

**D1 — Voice is a first-class declared input.**
A voice is an ordinary **authored node** (`authored` is
`record<Identity, {path, follows?}>`) referenced by identity in a target's `inputs`
(`Identity[]`). Both mechanisms already exist, so **no core change is required**.

**D2 — It is called a `voice`, never a `profile`.**
`profile` already means *build recipe* here (`ProfileNameSchema`,
`EpisodeManifest.profile`, `profiles/editorial-audio.yaml`).

**D3 — Separate reusable package, two entry points, validator first.**
`voice revise` (impure provider; declares `impure: {reason}`; reports **no**
validation verdict of its own) and `voice fidelity` (deterministic validator).
Mirrors quote-bank FR-022. The validator ships first: an edition produced by any
means — the existing Codex skills, another model, a human editor — becomes
checkable the moment it exists.

**D4 — The gate is a deterministic literal-fidelity core plus a complete
source-unit disposition ledger.**
The validator proves that every source unit has exactly one declared disposition,
that the ledger was written against the supplied source version, and that each
disposition satisfies its applicable deterministic obligations — exact quotation
survival, citation preservation, configured literal-payload survival, and recorded
reasons for cuts. **It does not prove semantic equivalence of rewritten prose, nor
the wisdom of an editorial disposition, nor conformance to the declared voice.**

**D5 — v1 scope is source-locked revision only.**
A governed target MUST declare exactly one source draft. Targets without one are
out of scope for v1 (see Deferred scope). This removes the first draft's
incoherence and gives v1 a single fully-specified fidelity contract.

**D6 — Normative source-unit derivation.**
Specified to the byte so an independent implementation reproduces identical ids
(quote-bank FR-024 discipline):

1. Read as UTF-8; invalid input is refused before any unit is processed.
2. Strip frontmatter **only** when the first line is exactly `---`, removing
   through the next line that is exactly `---` and its terminator. Only the first
   such block; no other delimiters are recognized.
3. Line endings are **not** normalized, consistent with quote-bank FR-001. A
   line-ending-only change therefore yields different unit ids and forces
   re-accounting. Intended.
4. A **separator line** is a line whose content, after an optional trailing CR,
   consists solely of spaces and tabs (including empty).
5. Units are the maximal runs of consecutive non-separator lines, in document
   order. A run of several separator lines separates exactly as one does.
6. **Exception:** a separator line inside a fenced code block (a line beginning
   with ``` or `~~~`, until its matching closing fence) does not separate.
7. Unit content is the **exact bytes** of its lines with their original
   terminators — no trailing-whitespace stripping, no normalization of any kind.
   (This revises the first draft, which stripped per-line trailing whitespace;
   removing that keeps unit identity consistent with quote-bank's no-normalization
   stance, at the cost that whitespace-only source edits force re-accounting.)
8. `content_hash = sha256(content)`, recorded in **full 64 hex** — not truncated.
   The first draft's 12-hex prefix offered 48 bits for no benefit; storage is free
   and this is a durable ledger format.
9. **Durable unit identity is the triple `(source identity, content_hash,
   occurrence_index)`** — a content hash alone does not bind a unit to a
   particular declared source. `occurrence_index` is the 0-based index among units
   of that source sharing a content hash, in document order.
10. Reordering byte-identical blocks changes their occurrence indexes though their
    content does not. Named as intended behavior.

**D7 — Edition units use the same algorithm; circularity is excluded by construction.**
Edition units are derived by D6 applied to the edition file. Because step 2 strips
frontmatter — where the ledger lives (D9) — **the ledger's own bytes cannot
perturb any edition unit hash.** This must be stated normatively or the format is
unimplementable. Edition unit ids are stable only relative to the exact edition
bytes they are embedded in, which is self-consistent because the ledger travels
inside that artifact.

**D8 — Closed operation set, each with a mechanically distinct obligation.**
The first draft's `kept` / `compressed` / `moved` all reduced to "payload survives
somewhere" and were therefore indistinguishable to the validator — they encoded
editorial description, not mechanical obligation. Replaced by:

| `op` | Deterministic obligation |
| --- | --- |
| `verbatim` | exactly one destination unit, whose content bytes equal the source unit's |
| `represented` | ≥1 destination units; the source unit's payload survives across their union; no destination shared with another source unit |
| `merged` | ≥1 destination units; payload survives across their union; **at least one destination is also named by another source unit's entry** |
| `cut` | **no** destination units; a non-empty `reason` |

The shared-destination condition is what makes `merged` mechanically distinct from
`represented` rather than a naming convention. Editorial description is preserved
as optional, explicitly non-normative metadata: `treatment: compressed`.

`cut` no longer asserts that the unit's text is absent. Rewritten prose seldom
reproduces exact source blocks even when the material is retained, so that check
added nearly nothing while implying the substance was omitted — which it cannot
show. `cut` now means only: accounted for, no destination, reason recorded.

**D9 — Destinations are a list: the mapping is N:M.**
`edition_units` is a **list**, not a single reference. One source unit legitimately
splits across several edition units, and a singular destination would force the
producer to mislabel an ordinary split. Combined with `merged`'s shared-destination
rule, the ledger expresses 1:1, 1:M, M:1 and M:N without a separate `split`
operation.

**D10 — The ledger's schema is carrier-independent; today's carrier is frontmatter.**
`src/providers/invoke.ts:101` hard-refuses more than one output per target ("A
record names exactly one output… Declare one target per output") — deliberate,
tied to FR-014, and **not** relaxed by directory support. So the ledger is embedded
in the edition's YAML frontmatter. The schema is a self-contained YAML document
with one loader, so a later move to a sidecar is a **carrier swap in the provider
and validator, not a redesign**.

```yaml
ledger:
  version: 1
  source: { identity: ebook-ch01, hash: sha256:… }
  voice:  { identity: voice-archival-restraint, hash: sha256:… }
  coverage:
    - source_unit: { hash: sha256:…, occurrence: 0 }
      op: represented
      treatment: compressed          # optional, non-normative
      edition_units: [ { hash: sha256:…, occurrence: 0 } ]
    - source_unit: { hash: sha256:…, occurrence: 0 }
      op: cut
      reason: "restates the death count carried by the preceding unit"
```

**D11 — Payload is extracted and checked per source unit, not globally.**
A global presence check creates false assurance: a term occurring in ten source
units and once in the edition would corroborate all ten. Payload obligations are
therefore **unit-local**, matched within the union of that entry's declared
destinations.

Always extracted, with no heuristics:

- numeric literals;
- citation markers;
- verbatim quoted spans (blockquote lines within the unit).

Plus declared-lexicon terms occurring in that unit, when a lexicon input exists.
When none is declared the validator **passes and reports that entity survival was
not checked**. A capitalized-token heuristic was rejected: false alarms on
sentence-initial capitals and non-English sources would train operators to ignore
the gate.

Matching is **byte-exact and case-sensitive**, with **multiset semantics** — each
payload occurrence in the source unit must be discharged by a distinct occurrence
in the destinations, so one edition occurrence cannot satisfy several obligations.

**D12 — Empty payload is reported, not silently passed.**
A `represented` or `merged` entry whose source unit yields no extractable payload
(ordinary connective prose) would otherwise pass **vacuously**. Refusing it would
block legitimate prose, so the validator passes it and records it as
`uncorroborated` with a count in the coverage report. The count being first-class
is the point: a ledger where most entries are uncorroborated is visibly weak
evidence rather than a clean verdict.

**D13 — Citation semantics are unit-local with multiset multiplicity.**
Set equality was underspecified: a source citing the same marker twice in support
of different statements, and an edition citing it once, has an identical citation
*set*. Instead:

1. every citation marker occurrence in a non-`cut` source unit must appear in that
   entry's destinations, with multiplicity;
2. the edition MUST contain no citation marker absent from the source (no
   fabrication);
3. every marker must resolve within the frontmatter allow-list;
4. a **source** whose own citations fall outside its allow-list is invalid, and
   that is refused before edition validation begins.

Document-level multiset equality is deliberately *not* required, because a `cut`
unit's citations legitimately disappear.

**D14 — Quote handling reuses quote-bank semantics only where a quote bank is a declared input.**
The ebook's blockquotes carry `[PB-P076]`-style markers originating from the
spine, not from a validated quote bank. So checking against quote-bank identities
and disclosed transformations applies **only** when a quote bank is an actual
declared input of the target. For source-locked revision without one, the
obligation is the simpler exact-block preservation of D11. Stated as an explicit
conditional to avoid creating a second quote-fidelity dialect by accident.

**D15 — The validator emits a structured coverage report.**
The principle that the gate must never claim a check it did not perform is
generalized into a first-class output rather than left to documentation:

```yaml
verdict: passed
checks:
  source_hash:            { state: passed }
  unit_accounting:        { state: passed, total: 57 }
  verbatim_quotes:        { state: passed, checked: 10 }
  citations:              { state: passed, mode: multiset, checked: 11 }
  numeric_literals:       { state: passed, checked: 8 }
  lexicon:                { state: not-run, reason: no lexicon declared }
  uncorroborated_units:   { state: reported, count: 6 }
  semantic_claim_fidelity:{ state: not-checkable }
  voice_conformance:      { state: not-checkable }
```

A top-level `passed` means every **applicable deterministic obligation** passed —
never that the edition is semantically equivalent to its source.

**D16 — Voice conformance is not validated in v1, and this is stated in the feature's own documentation.**
A voice input governs generation and freshness. The validator establishes source
fidelity, not that the prose exhibits the declared voice. Without saying so
plainly, the feature's name implies a guarantee it does not provide.

**D17 — Voice document schema.**
Versioned (`version: 1` literal, unknown versions refused), with a required core —
`id`, `label`, `purpose`, `narrator_distance`, `evidence_posture`,
`sentence_movement`, `paragraph_movement`, `transitions`,
`emotional_temperature`, `quote_handling`, `avoid` — and permitted additional
keys, since voices evolve. production-control never interprets these fields; they
are directives passed to the producer. The package owns the schema, loader, and
the mapping from voice document to provider request. **No author imitation:** a
voice must be expressed as independently useful traits, never a named living
author's identity — documented as a refusal, not a fake mechanical check.

**D18 — Freshness: voice edits restale; model-version changes drift.**
A voice materially determines the output, so an edition built from an older voice
genuinely *is* out of date. Restaling only *reports*; rebuilding stays the
operator's call. A model version change is producer **drift**, never an
auto-restale (quote-bank FR-020); regeneration is a deliberate human act.

**D19 — Human-edited editions depend on core artifact adoption.**
An edition is prose, and an editorial polish pass is a normal part of its
lifecycle, not an edge case. `src/providers/validate.ts:146` refuses to validate
when the on-disk artifact does not match its recorded hash: rebuilding destroys
the edit, waiving discards the fidelity proof. The fidelity validator does not care
who wrote the prose, so a human edit *could* be proven by the same check — but
that requires re-recording an artifact's hash without regenerating it, which is
generic core lifecycle behavior and must not be smuggled into a domain package.
Recorded as `design:feature/artifact-adoption` and declared as a **`depends-on`
edge**; the roadmap now correctly reports voice-editions as blocked by it.

**D20 — Failure levels, mirroring quote-bank FR-015.**
A source unit the producer cannot account for fails the run with **no partial
edition emitted**; an unreadable or non-UTF-8 source fails before any unit is
processed; a structurally invalid ledger (unknown unit, duplicate disposition,
`cut` with a destination, `merged` with no shared destination, empty `reason`) is
refused **before** fidelity is evaluated; an interruption leaves the previously
accepted edition untouched via the existing stage-then-rename; a validator that
cannot decide exits non-zero and produces **no verdict** — distinct from `failed`,
never a false clean.

**D21 — Blended voices are deferred (operator decision).**
The ledger MUST remain additively extensible so `function:` and `voice:` fields can
land later without a breaking change.

## Deferred scope (captured, not built)

Recorded per the `capture-over-yagni` house rule; these were scoped out by explicit
operator decision, not dropped by YAGNI.

### Original composition (targets with no source draft)

The immediate follow-on. A chapter built from a spine, a quote bank, and research
assets has no source draft, so D6 derivation and the coverage ledger do not apply.
It needs coverage over a **declared claim or asset set** instead — the
`design:feature/asset-bank` direction. Designing it demands answering what a claim
is, how claims acquire durable identity, and who declares the set. Recommend a
follow-on roadmap item once asset-bank has settled.

### Blended voices — voice varying by narrative function

The spike's fourth edition assigns voices by editorial job: archival restraint for
exposition, investigative momentum for turns, intimate witness for documented
consequence. Its plan required the ledger "identify the function at each major turn
so that it remains reproducible" — and the per-unit ledger is already the right
substrate.

Settled before deferral: a composite voice file mapping `function -> voice`; the
producer classifies each unit's function and records both function and resolved
voice in that unit's entry; an optional authored function map lets the operator
**pin** any unit; the ledger records which source the assignment came from.
Deterministic checks available: every recorded function resolves in the blend map,
every unit names a voice.

**Unresolved and load-bearing — the freshness edge.** A blend names constituent
voices, so a target declaring only the blend will **not** restale when a
constituent is edited. Silent staleness. Three candidates, none chosen:

1. *A blend is a built target* — a derived voice compiled from its constituents by
   a pure deterministic merge, so the graph handles transitive freshness natively
   and the edge cannot be forgotten. (Standing recommendation at deferral.)
2. *The target declares every constituent explicitly* — no new machinery, but
   forgetting one fails silently.
3. *The blend content-pins constituent hashes* — tamper-evident, but every voice
   edit requires re-pinning by hand.

**Must be resolved before blends ship.**

### Other deferred items

- **Model-auditor advisory** — an independent model auditing for dropped claims,
  invented causality and overstated certainty, as a **non-blocking** signal. This is
  the only mechanism that addresses claim fidelity at all; it must never be
  conflated with the deterministic verdict.
- **`avoid`-list conformance** — mechanically scanning for a voice's declared banned
  constructions. Partially deterministic; a natural extension of D11.
- **Fan-out ergonomics** — N voices × M units means N×M hand-authored target
  declarations. `design:feature/episode-scaffolding` exists for this.
- **Per-edition HTML and PDF bundles** — promised by the spike's production plan; a
  natural consumer of directory outputs.

## Open questions

1. **Unit granularity is untested.** D6 splits at separator lines. Whether a long
   multi-claim paragraph should decompose further (sentence level) is unknown: too
   coarse weakens the guarantee — a 200-word source unit reduced to one clause can
   satisfy `represented` — while too fine makes the ledger unusable. Measured
   evidence: `content/ebook/` chapters yield **57–84 units each**.

2. **Ledger size in the reading copy.** At ~57–84 entries per chapter, a full
   edition ledger is roughly **480 entries**. As frontmatter in a file humans open
   to read prose, that is likely untenable. D10 keeps the schema carrier-independent
   precisely so this can move, and this measurement strengthens the case for
   directory outputs as the eventual carrier.

3. **Lexicon provenance and schema.** D11's lexicon has no defined origin or
   matching policy beyond byte-exactness: hand-authored per project, or derived from
   the quote bank / spine? Also unsettled — aliases and variants, whether entries are
   patterns or literals, and Unicode normalization (none is proposed, consistent with
   D6, but it should be stated). Deriving it couples to asset-bank.

4. **Whether `represented` should require a minimum corroboration.** D12 reports
   uncorroborated units rather than refusing them. Whether a project should be able
   to set a policy — for example refusing when uncorroborated entries exceed a
   share of the ledger — is unresolved. It would be deterministic, but it is a
   threshold, and this design has otherwise avoided thresholds on principle.

5. **Markdown constructs beyond the current corpus.** D6 handles fenced code blocks
   and separator lines. The corpus contains no fenced code and no lazy-continuation
   blockquotes today, so setext headings, MDX constructs, HTML blocks, and list
   items containing blank lines are unexercised. Golden fixtures should cover them
   before the algorithm is called stable.

## Dependencies and consumer relationships

Recorded so relationships are visible on the roadmap rather than folklore.

- **`design:feature/artifact-adoption` — a declared `depends-on` blocker (D19).**
  Human editorial polish is normal for this artifact type, and production-control
  cannot currently adopt hand-edited bytes without regeneration.
- **`design:feature/directory-outputs` (TASK-1) — deliberately not a blocker.** Two
  distinct rules confirmed: `onlyOutput` (exactly one output per target,
  `invoke.ts:101`) is deliberate and directory support would *not* relax it;
  `isFile` (`run.ts:245`) is the actual constraint. The expensive part exists —
  `hash/tree.ts` (147 lines, tested) and the file-vs-dir dispatch at
  `hash/path.ts:28`, which is why directory *inputs* already work. Remaining
  mechanical work: `hashFile` → `hashPath` in `invoke.ts:78` and `validate.ts:135`;
  relax `isFile` to an existence check; teach `stage()` a directory copy (the rename
  stays atomic within `dist/`); teach the undeclared-file walk that a declared
  directory covers everything beneath it. Not free: `modified` detection against a
  tree, whether declaring `edition/` claims everything under it (interacts with
  TASK-5), empty-directory-as-success, symlinks in a produced tree. At least three
  independent consumers, so it should be built on its own merits. D10 makes eventual
  adoption a carrier swap. Open question 2 raises its priority.
- **TASK-14 (`gap/real-model-identity-for-drift`)** — D18's drift reporting is only
  meaningful if the real model identity is recorded in producer provenance.
- **TASK-13 (`bug/model-output-parse-kills-long-build`)** — a 57–84-unit edition build
  is exactly the long-running shape where one parse failure kills the run.
- **`design:feature/episode-scaffolding`** — fan-out ergonomics.
- **`design:feature/asset-bank`** — bears on deferred original composition and on
  open question 3.
- **TASK-5 (`gap/cross-target-output-collision`)** — interacts with directory-output
  semantics.

## Testing strategy

The validator carries the weight, so its tests are adversarial by construction.
Against a fixture source: one clean edition, plus one each for a dropped figure, an
uncovered unit, a **lying entry** (claims `represented`, payload absent), a `cut`
with no reason, a `cut` carrying a destination, a `merged` with no shared
destination, a stale `source.hash`, and a fabricated citation. Every bad one must
fail *naming the defect*. **Zero false-cleans** is the criterion.

Cases that probe the boundary of the guarantee — these must **pass** the
deterministic gate while the coverage report shows `semantic_claim_fidelity:
not-checkable`, documenting the limit rather than hiding it:

- a `represented` entry preserving every literal while **reversing the causal
  relationship**;
- an entry preserving payload while **introducing a negation**;
- a `cut` unit whose substance is in fact paraphrased elsewhere.

Cases that must **fail**:

- one payload occurrence attempting to discharge several source units' obligations
  (multiset semantics, D11);
- two byte-identical source blocks assigned to the wrong occurrence indexes;
- a `represented` entry whose destination contains the right names and numbers but
  belongs to an unrelated passage (destination-scoped matching, D9);
- a duplicate citation removed while the citation *set* is unchanged (multiset, D13);
- a source whose own citations fall outside its allow-list (D13.4).

Plus:

- **Empty-payload vacuity** — a unit with no numerals, citations, quotes or lexicon
  terms marked `represented` passes but is counted `uncorroborated` (D12).
- **Determinism** — identical verdict on every run, no model, no network.
- **Golden unit derivation** — fixture sources pinned to exact expected ids,
  including LF vs CRLF (D6.3), whitespace-only separator lines, fenced code blocks
  containing blank lines, multiple consecutive separators, a missing trailing
  newline, and frontmatter-delimiter edge cases.
- **Circularity** — editing the ledger in an edition's frontmatter must not change
  any edition unit hash (D7).
- **Two different sources containing byte-identical units** — durable identity must
  keep them distinct (D6.9).
- **Producer** — with a stubbed model, assert the provider declares itself impure
  and reports no validation verdict of its own.
- **Integration** — end-to-end `pc build` / `pc validate` over a fixture episode,
  including restale-on-voice-edit and drift-on-model-version (D18).
- **Lifecycle** — a hand-edited artifact passes `voice fidelity` directly yet cannot
  be adopted, demonstrating the D19 dependency.

## Provenance

- **Design backend:** `superpowers:brainstorming`, driven in-session by
  `/stack-control:design` under house-rules block `stack-control-design-v1`.
- **Roadmap:** `design:feature/voice-editions`, added 2026-07-25;
  `design:feature/artifact-adoption` added the same day and recorded as a
  `depends-on` blocker.
- **Originating spike:** `nouvelle-france`, branch `spike/codex-authorship`, commit
  `a8aa7d5` (39 files, +1495). Worktree
  `/Users/orion/work/nouvelle-france-codex-authorship`.
- **Spike artifacts reviewed:** `PROCESS-CODEX-EDITORIAL.md`;
  `docs/editorial/AI-OUTPUT-IMPROVEMENT.md`; `content/editorial-voices/`;
  `content/ebook-voice-editions/PRODUCTION-PLAN.md` and its 4 `edition.yml`;
  `content/ebook-voice-editions/archival-restraint/{prologue.md,revision-ledger.md}`;
  `content/ebook-editorial-experiments/`;
  `content/podcast-editorial-experiments/2026-07-24-ep07-forward-drive/`;
  `/Users/orion/.codex/skills/voice-profile-lab/SKILL.md`.
- **Fidelity verification performed during design** (not asserted from the spike's
  ledger): blockquote and citation extraction over the archival-restraint prologue
  against `content/ebook/prologue.md` — 10/10 blockquotes byte-identical, 11/11
  citation markers and 3/3 source ids preserved, 1493 → 1021 words.
- **Corpus measurements taken during revision:** `content/ebook/` chapters yield
  57–84 separator-split blocks each (informing open questions 1 and 2); the corpus
  contains no fenced code blocks; `ch04.md` contains two adjacent blockquote pairs
  separated by blank lines, which are **correctly** two units under CommonMark — an
  earlier claim in this record that they fractured a single quotation was wrong and
  has been removed.
- **production-control sources consulted:** `src/manifest/schema.ts`,
  `src/providers/contract.ts`, `src/providers/invoke.ts`, `src/providers/run.ts`,
  `src/providers/build.ts`, `src/providers/validate.ts`,
  `src/providers/validate-run.ts`, `src/ledger/schema.ts`, `src/hash/tree.ts`,
  `src/hash/path.ts`, `profiles/editorial-audio.yaml`, `specs/002-quote-bank/spec.md`,
  `ROADMAP.md`, backlog TASK-1 / TASK-5 / TASK-13 / TASK-14.
- **Operator decisions:** primary unit = voice as a governed input; gate =
  deterministic core + coverage ledger (model auditor and profile-conformance
  scoring declined); unit identity = derived and content-hashed; corroboration =
  checkable operations; payload = unambiguous set + optional lexicon; blended voices
  = deferred; directory outputs = not blocked on; **v1 narrowed to source-locked
  revision**; **human-edited editions = declare a dependency on core artifact
  adoption**.

### Third-party review disposition (2026-07-25)

A third-party review recommended revision before approval. Its central finding — that
the first draft **overstated what the coverage ledger can prove**, conflating
accounting completeness and literal-payload preservation with claim fidelity — was
verified against this record's own definitions and accepted. The guarantee is now
stated narrowly (see Problem domain) and D4 rewritten.

Accepted and incorporated: the three-property distinction; the operation-set collapse
to `verbatim`/`represented`/`merged`/`cut` with descriptive `treatment` metadata (D8);
edition-side destinations replacing "survives somewhere" (D8, D9); `cut` losing its
near-vacuous text-absence check (D8); "source unit" replacing "claim-bearing unit"
throughout; full SHA-256 instead of a 12-hex prefix (D6.8); durable identity as
source + hash + occurrence (D6.9); multiset, unit-local citation semantics (D13);
unit-local rather than global lexicon obligations (D11); the structured coverage
report with `not-run` / `not-checkable` states (D15); explicit statement that voice
conformance is unvalidated (D16); the scope resolution (D5); the artifact-adoption
dependency (D19); and the adversarial test cases, including empty-payload vacuity.

Extended beyond the review, where its proposed fix was incomplete:

- **Mapping cardinality (D9).** The review's schema used a singular `edition_unit`,
  which cannot express one source unit splitting across several edition units — a
  routine editorial move that would otherwise force mislabeling. Destinations are a
  list, giving 1:1, 1:M, M:1 and M:N without a separate `split` op.
- **`merged` given a distinct mechanical obligation (D8).** Under the review's
  formulation `merged` still reduced to payload survival plus a reference. Requiring
  a *shared* destination makes it checkably different from `represented`.
- **Circularity of edition-unit ids (D7).** The review introduced edition-side ids
  without addressing that the ledger lives inside the edition. Frontmatter stripping
  resolves it, but only if stated normatively.
- **Quote-bank reuse made conditional (D14).** The corpus's blockquotes originate
  from the spine, not a validated quote bank, so quote-bank identity checks apply
  only where a quote bank is a declared input.

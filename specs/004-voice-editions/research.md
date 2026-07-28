# Phase 0 Research: Voice editions

The architecture was settled in the approved design record
(`docs/superpowers/specs/2026-07-25-voice-editions-design.md`, D1–D22) and
sharpened by the spec's clarification session. This consolidates the decisions
with rationale and the alternatives rejected, so the plan carries no unresolved
unknowns. Each entry cites the design decision(s) it operationalizes.

## R1 — Package location & shape: a new top-level craft package, sibling to `editorial-tooling`

- **Decision**: A new standalone package at the repository root (`voice-tooling/`
  in this plan), not a subdirectory of `editorial-tooling/`, mirroring the
  quote-bank precedent's own placement.
- **Rationale**: `editorial-tooling` is named for *its* craft (a quote bank).
  Voice-editions is a materially different craft — derived-prose revision against
  a source-locked draft, not verbatim-quote mining — with its own schema (voice
  document, coverage ledger), its own unit-derivation algorithm (D6), and its own
  fidelity model (literal-payload survival, not span/edit reconstruction). Nesting
  it inside `editorial-tooling` would either (a) share nothing but a `package.json`
  and README, gaining no reuse, or (b) invite accidental coupling between two
  fidelity models that the design record went out of its way to keep conceptually
  distinct (Problem domain: "a quote is literal source text… a voice edition is
  derived prose"). A sibling package keeps each craft's blast radius to itself —
  exactly Constitution IV's "crafts remain specialized," applied to package
  boundaries as much as to production-control core.
- **Alternatives considered**:
  - *Subdirectory of `editorial-tooling`* — rejected: no shared code today (no
    module in `editorial-tooling/src/` is subject-agnostic infrastructure the new
    package would reuse; `sources.mjs`'s "one shared source-id loader" concern
    doesn't apply here because voice-editions has exactly one source draft per
    target, D5, not a corpus), and it would make `editorial-tooling`'s own
    `package.json`/`bin`/tests carry two unrelated crafts' surface area.
  - *Fold into production-control core* — rejected outright by D1/Constitution IV;
    not reconsidered here.
- **Language deviation, stated plainly**: the task brief that scoped this plan
  described the language as "TypeScript (Bun runtime, matching the repo)."
  Repository inspection (`package.json` `engines.node`, `tsc`/`tsx`/`vitest`
  scripts, no `bun.lockb`/`bunfig.toml`, no Bun reference anywhere except two
  false-positive substring matches on "bundle(r)") shows this repo runs on
  **Node**, not Bun. This plan targets Node. `editorial-tooling` itself uses
  plain `.mjs` with zero build step and `node --test`; this package instead uses
  TypeScript under `src/` per this repo's own architecture guideline ("Always use
  the `@/` import pattern for typescript"), run directly via `node --import tsx
  --test` (the user's standing directive: use `tsx`, never `ts-node`) rather than
  requiring a `tsc` build step before tests run. `bin/*.mjs` entry points stay
  plain JS shims (matching `editorial-tooling`'s own `bin/` — a thin stdin/stdout
  wrapper needs no typing) that `import()` the compiled or `tsx`-run TypeScript
  core, keeping "runnable entirely by hand" true for both packages alike.

## R2 — Source-unit derivation determinism (D6)

- **Decision**: Implement D6 verbatim, as a pure function `deriveUnits(bytes:
  Buffer) -> SourceUnit[]`, with every numbered rule in D6 as a discrete, tested
  step:
  1. Read as UTF-8; refuse (throw, name the byte offset if determinable) before
     any unit is produced on invalid input.
  2. Strip frontmatter **only** when byte 0 begins the literal line `---` through
     the next line that is exactly `---` plus its terminator — first block only,
     no other delimiter recognized.
  3. **No line-ending normalization.** A line's terminator (`\n` or `\r\n`) is
     part of its bytes and therefore part of unit content and its hash.
  4. A separator line is spaces/tabs only, after stripping one optional trailing
     `\r`.
  5. Units are maximal runs of consecutive non-separator lines, document order.
  6. **Exception**: a separator line inside a fenced code block (opened by a line
     starting with ` ``` ` or `~~~`, until its matching closing fence) does not
     separate.
  7. Unit content is the exact bytes of its lines with original terminators — no
     trailing-whitespace stripping, no normalization of any kind.
  8. `content_hash = sha256(content)`, recorded in full 64 lowercase hex — never
     truncated.
  9. Durable identity is the triple `(source identity, content_hash,
     occurrence_index)`; `occurrence_index` is the 0-based index among units of
     *that source* sharing that hash, in document order.
  10. Reordering byte-identical blocks changes their occurrence indexes though
      content is unchanged — this is intended, not a bug to paper over.
- **Rationale — why full sha256, not a prefix**: the first draft this design
  record superseded used a 12-hex prefix (48 bits) "for no benefit" once storage
  cost is considered against a durable ledger format that gets diffed and audited
  by humans; full hex removes any collision-probability argument from the picture
  entirely rather than trading a small storage saving for a a non-zero, if tiny,
  ambiguity risk in a trust-bearing format.
- **Rationale — why no line-ending normalization**: consistent with quote-bank
  FR-001's no-normalization stance (raw source bytes are the trust anchor there
  too); a line-ending-only source edit is a real, if boring, source change, and
  forcing re-accounting on it is the same "byte-exact means byte-exact" discipline
  that makes the whole ledger auditable rather than approximately auditable.
- **Rationale — frontmatter-strip rule**: the ledger lives in the *edition's*
  frontmatter (D10), and edition units are derived by the same D6 algorithm
  applied to the edition file (D7). If frontmatter were not stripped before
  derivation, editing the ledger itself (adding an entry, fixing a `reason`)
  would perturb edition-unit hashes — a self-referential instability that would
  make the format unimplementable. Stripping is therefore normative, not
  cosmetic (D7): "the ledger's own bytes cannot perturb any edition unit hash."
- **Rationale — fenced-code exception**: without it, a separator line that
  happens to fall inside a code fence (blank line inside a fenced block) would
  fracture the block into units that do not correspond to any meaningful
  editorial boundary, and — worse — a source containing fenced code could produce
  units whose boundaries depend on formatting accidents inside the fence rather
  than the prose structure D6 exists to capture.
- **Alternatives considered**:
  - *Sentence-level splitting* — the spec's clarification session resolved this:
    separator-line units only, no sentence split in v1 (FR-008). Sentence
    splitting would require a sentence boundary detector, which is itself an
    approximate, locale-sensitive heuristic — exactly the kind of non-determinism
    D6 was written to exclude by fixing on a purely lexical (separator-line) rule.
  - *Per-line trailing-whitespace stripping* — the design record's own first
    draft did this; explicitly reversed (D6.7) to keep unit identity consistent
    with the no-normalization stance, accepting that a whitespace-only source
    edit forces re-accounting as the honest cost of a byte-exact guarantee.

## R3 — Ledger carrier: frontmatter for v1, carrier-independent schema (D10)

- **Decision**: The coverage ledger is a self-contained YAML document (its own
  `version`, `source`, `voice`, `coverage` fields — see data-model.md) with
  exactly **one loader function**, `loadLedger(yaml: string) -> CoverageLedger`,
  that has no knowledge of *where* its input string came from. v1's caller
  extracts that string from the edition's YAML frontmatter block; a later sidecar
  carrier would extract the same string from a different location and call the
  identical loader.
- **Rationale**: `src/providers/invoke.ts`'s `onlyOutput()` hard-refuses more than
  one declared output per target ("A record names exactly one output… Declare one
  target per output" — FR-014, deliberate, not relaxed by directory-output
  support per the design record's Dependencies section). With exactly one output
  per target and no directory-output support today, the ledger has nowhere else
  to live *in v1* except inside the edition file itself — hence frontmatter.
  Keeping the schema carrier-independent from day one means the eventual move to
  a sidecar (once `design:feature/directory-outputs` lands) is a carrier swap in
  the provider and validator's I/O layer, never a schema or fidelity-logic
  redesign.
- **Why not blocked on directory-outputs**: `design:feature/directory-outputs` is
  a declared non-blocker (design record Dependencies section): the mechanical
  remainder of that feature (`hashFile` → `hashPath`, relaxing `isFile` to an
  existence check, a directory `stage()` copy) is real but independent work with
  its own consumers, and gating voice-editions on it would trade a known,
  bounded cost (frontmatter ledger weight in the reading copy — Open Question 2,
  ~480 entries at 57–84 units × several editions) for an unbounded schedule
  dependency on a feature that hasn't shipped. The measured corpus numbers
  (57–84 units/chapter) inform this trade but do not change the decision — they
  are recorded so a future sidecar-migration decision has real numbers to weigh
  rather than a guess.
- **Alternatives considered**:
  - *Block on directory-outputs, ship a directory-carried ledger from day one* —
    rejected as an unnecessary coupling (see above); this is D10's explicit
    position, restated here for the plan.
  - *A separate file next to the edition, outside the manifest's one-output
    model* — rejected: it would be an undeclared output invisible to
    production-control's provenance and hashing, reintroducing exactly the "files
    with no record of their origin" failure `onlyOutput()` exists to prevent
    (FR-014).

## R4 — Payload/citation matching: unit-local, byte-exact, no Unicode normalization (D11/D13, clarified)

- **Decision**: All payload obligations (verbatim quoted spans, citation markers,
  numeric literals, optional declared-lexicon terms) are matched:
  - **unit-local** — within the union of one ledger entry's declared destination
    units, never against the edition or source as a whole;
  - **byte-exact and case-sensitive** — no Unicode normalization (NFC/NFD/etc.),
    consistent with D6's no-normalization stance for source bytes generally;
  - **multiset** — each source-side occurrence must be discharged by a distinct
    destination-side occurrence; one destination occurrence cannot satisfy two
    source obligations.
- **Rationale**: a global (document-level) presence check creates false
  assurance — a term occurring ten times in the source and once in the edition
  would corroborate all ten source occurrences under set semantics (D11). Making
  every obligation unit-local and multiset-counted is what makes "corroborated"
  mean something specific rather than "present somewhere." The clarification
  session's confirmation of no-Unicode-normalization for the optional lexicon
  extends the same byte-exact discipline D6 already applies to source bytes to
  the payload-matching layer, so the whole fidelity model uses one notion of
  "exact" throughout rather than two.
- **Why global checks were rejected**: beyond the false-assurance case above, a
  global check cannot express D13's "no fabrication" rule precisely (a citation
  marker absent from the source but present anywhere in the edition should fail,
  even if some other source unit happens to cite the same marker) nor D8's
  destination-scoping requirement that distinguishes `represented` from `merged`
  (a destination "belonging to" a source unit is meaningless without unit-local
  scoping).
- **Citation set-vs-multiset resolution (D13)**: document-level set equality was
  explicitly rejected because a `cut` unit's citations legitimately disappear
  from the edition — multiset-per-non-cut-unit is the rule that survives both
  "no fabrication" and "cuts are allowed to drop citations."

## R5 — Coverage report as first-class output (D15)

- **Decision**: The validator's structured coverage report (`verdict` +
  `checks{}` with a `state` per check, plus counts) is a **first-class emitted
  artifact** — the machine-readable object the validator's `errors`/stdout
  carries — not documentation prose or an afterthought log line.
- **Rationale**: Constitution V ("Fail Loud, Never False-Clean… a state without a
  cause makes an agent guess") and FR-025 both require that a `passed` verdict
  never coexist with an unrun applicable check. The only way to make that
  mechanically true — checkable by a caller, not just assertable in prose — is
  for every check's state to be a structured field the validator itself emits and
  a test can assert against. Treating it as documentation-only would let the
  invariant silently rot the first time a new check is added and its `not-run`
  state is forgotten in a comment but never in code.
- **Alternatives considered**: *documentation-only* ("the validator's docs say
  what it checks") — rejected for the reason above; a passing test suite could
  not distinguish "this check ran and passed" from "this check was silently
  skipped" without a structured, per-run artifact.

## R6 — Freshness model (D18)

- **Decision**: A voice edit restales every edition built from that voice
  (report-only — restaling never triggers an automatic rebuild); a change to only
  the recorded producer model version is reported as **drift**, a distinct state
  from `stale`, and never auto-restales.
- **Rationale**: a voice is a declared input that materially determines the
  output (FR-027) — production-control's existing freshness computation
  (`src/state/freshness.ts`: "if current != recorded -> stale") already handles
  this correctly the moment a voice is an ordinary `authored` node in `inputs`;
  no new mechanism is needed (D1). Model-version drift is conceptually different:
  the *inputs* haven't changed, only the tool that would produce a *new* edition
  if rebuilt has. Quote-bank already establishes this exact split (FR-020: "a
  change to only the producing model's version MUST be reported as producer
  drift"), and reusing it here keeps one drift semantics across both packages
  rather than inventing a second.
- **Alternatives considered**: *auto-restale on model-version change* — rejected
  per D18 and the quote-bank precedent: regeneration is a deliberate human act,
  and auto-restaling on a tool-version bump (which happens far more often than a
  voice edit) would make editions flap stale on every model release regardless of
  whether output would actually differ.

## R-FIXTURES — Markdown constructs beyond the current corpus (deferred to test-design, tracked here)

- **Status**: explicitly left open by the spec's clarification session, not
  resolved by this plan (Clarifications: "Not resolved here… golden fixtures
  should cover the others as they arise"). Recorded here so it is not lost.
- **What D6 already covers**: fenced code blocks (the separator-inside-fence
  exception) and separator lines.
- **What is unexercised by the current corpus** (per the design record's
  Provenance section: "the corpus contains no fenced code and no lazy-
  continuation blockquotes today"): setext headings (`Title\n=====`), MDX
  constructs, HTML blocks, and list items containing blank lines.
- **Plan-level disposition**: `test/fixtures/sources/` (see plan.md Project
  Structure) is where these land as golden fixtures once real corpus material
  exercises them — each fixture pins an exact expected unit-id set, per the
  design record's Testing strategy ("Golden unit derivation… fixture sources
  pinned to exact expected ids"). No algorithm change is anticipated; D6 is
  written to be construct-agnostic (it operates on separator lines and fence
  delimiters only), so new fixtures are expected to validate the existing rule
  rather than motivate a new one — but that is a hypothesis to be confirmed by
  the fixtures, not asserted here as settled.

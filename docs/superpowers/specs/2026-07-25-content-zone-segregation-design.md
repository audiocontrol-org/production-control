# Content zone segregation — design record

**Roadmap item:** `design:feature/content-zone-segregation`
**Date:** 2026-07-25
**Status:** awaiting operator approval (`design-approved:` marker)
**Blocks:** `design:feature/voice-editions`

> This item was reclassified from `design:feature/artifact-adoption` during its own
> design session. The original framing — a verb to bless a human's edit of an AI
> artifact after the fact — was rejected by the operator in favor of *preventing the
> collision*. That reframing is recorded in the solution space below, because it is
> the load-bearing decision of this feature.

## Problem domain

### The trap already latent in the codebase

production-control builds derived files from inputs and keeps a ledger of what it
built, from what, and whether it passed. When a human edits a built file by hand,
the system detects that the bytes no longer match the record and marks the node
`modified` — a first-class state, deliberately distinct from `stale`:

- `state/frontier.ts:30` maps `modified` to `resolve-edit`, and is emphatic it is
  "never `rebuild`: rebuilding would destroy the human edit… which is the entire
  reason `modified` is a state distinct from `stale`";
- `state/release.ts` (FR-017b) blocks release on any `modified` node — "a
  hand-edited output blocks release until a human resolves it; the system must not
  decide on their behalf";
- `cli/review.ts:136` refuses `review --waive` on a derived node outright — "It is
  a derived node: what resolves its state is a rebuild, not a human decision."

But **there is no verb that performs `resolve-edit`.** The CLI surface is `status,
next, explain, release-check, readme, build, validate, asset, add, review`. So a
hand-edited derived artifact is a permanent release blocker whose only listed exit
(`resolve-edit`) cannot be carried out, and whose available exits both lose the
work: `build` overwrites it, and `review --waive` is refused. `pc next` prints an
instruction the operator has no way to follow.

Two corrections to the record that opened this item:

1. The `design:feature/voice-editions` record (D19) stated the escape hatch is "a
   waiver, which discards the fidelity proof." That is wrong: waiving is not
   available for derived nodes at all. Voice-editions D19 is superseded by this
   design and must be revised.
2. A companion gap was found and captured as **TASK-15**: `pc build` has no state
   guard whatsoever (`cli/build.ts` checks nothing about current state before
   rebuilding), so nothing actually *prevents* the destructive rebuild. Worse, the
   freshness precedence reports `stale` over `modified` (`state/resolve.ts:136`), so
   editing a derived output and then changing any of its inputs makes the node
   report `stale`, the edit becomes invisible to `status`, and an ordinary rebuild
   destroys it with nothing ever mentioning an edit existed. That gap is separable
   from this design and tracked on its own.

### Why voice-editions forced the question

A voice edition is **prose**, and editorial polish — fixing a clumsy sentence, an
awkward transition — is the normal workflow, not an edge case. The first time
anyone hand-polishes one sentence of a generated chapter, that chapter becomes a
permanent release blocker with no non-destructive exit. The feature does not
survive contact with how editors actually work.

### The reframing: prevent the collision, don't clean it up

The original item proposed an *adoption* verb: let a human edit the AI artifact,
then re-attest it. The operator rejected that and set a stricter rule:

> Strict segregation between (a) mechanically-edited files, (b) AI-generated files,
> and (c) human-editable files — enforced by multiple mechanisms: directory,
> file type, and mechanical validation. **An AI draft cannot be taken over by a
> human.** If a human wants to work on a draft, they create the document in a
> human-safe area. **AI content must never be written to a human-safe area.**
> Mechanically-generated items MAY be written to human-safe areas (a README, a
> YAML).

This dissolves the trap for AI artifacts rather than resolving it after the fact:
if a human never edits an AI file in place, no AI file is ever `modified`, and the
missing `resolve-edit` verb is not needed for the AI class. The trap that remains
(a human edits a *mechanical* output) is a different, smaller matter — see open
questions.

### The three classes are already half-present

The distinction the operator wants is latent in the data model:

| Operator's class | production-control node |
| --- | --- |
| (c) human-editable | an **authored** node (a human supplies the file; the file is the truth) |
| (a) mechanically-edited | a **derived** node with a **pure** provider (`impure` absent) — deterministic, reproducible |
| (b) AI-generated | a **derived** node with an **impure** provider (`impure: {reason}`) |

What is missing is *enforcement*: `impure` is only a flag on a provider; nothing
segregates where these files are written, and nothing forbids AI bytes from landing
in a human's working area. This feature hardens the latent three-way distinction
into a guarded structural boundary.

## Invariants (the principle, above any mechanism)

Stated independently of enforcement so the philosophy is not read as an
implementation detail:

- **INV-1 — Structural segregation (bidirectional for the two hard classes).**
  Human-authored content MUST reside in a human-safe path; impure-derived (AI)
  content MUST reside in an AI-permitted path. Pure-derived content MAY reside in
  either, according to workflow need (a generated README in a human area is
  explicitly allowed). This is stronger than "keep AI out of human areas" — it also
  keeps authored content out of AI zones, so all three classes stay apart (see D2b
  for why the authored direction is enforced).
- **INV-2 — Human legibility at a glance.** A person MUST be able to tell from a
  path **alone** — in a file tree, a `git status`, a diff, with no tooling, no
  manifest lookup, no graph query — **whether a location is human-safe or
  AI-permitted.** This is a first-class requirement, not a convenience: the naming
  convention is the *human's* channel, co-equal with the machine's. Note the
  deliberate asymmetry (see D5b): a dot-zone means *AI-permitted / not human-safe*,
  **not** "definitely AI" — pure or operational files may live there too. A non-dot
  path, however, does prove the location holds no impure content.
- **INV-3 — The two channels may never diverge.** The path (human channel) and the
  graph's `impure` flag (machine channel) are two projections of one truth and MUST
  agree, in both directions for the hard classes: an **impure** node may not resolve
  into a human-safe path, and an **authored** node may not resolve into an
  AI-permitted path. The path communicates *human-safe vs AI-permitted*; the graph
  communicates *exact provenance*; the build refusal keeps them from contradicting
  each other, so a location can never mislead a human about whether it is safe to
  author in.
- **INV-4 — No in-place editing of impure artifacts.** No supported workflow may
  require or legitimize a human editing an AI-generated artifact in place; human
  work creates a *separate authored node* (D6). This is a workflow guarantee, not a
  claim that such an edit is mechanically impossible — a human can still open the
  file (see D7 and TASK-15).

Directory zoning (below) is how v1 realizes these — but INV-2 constrains any future
mechanism: a replacement that made a file's zone unreadable from its name (a
manifest-declared zone list, a database of paths) would violate the principle even
if it enforced INV-1 perfectly. Legibility-by-name is not swappable.

## Solution space

### Chosen — directory-name zoning, any-dot-wins, impure output confined to dot-zoned paths

The naming convention is the design, because it is what makes the segregation
**human-legible** (INV-2). Zoning is read directly from the path, inherited down the
tree:

- A path is **AI-permitted iff at least one of its directory segments is
  dot-prefixed** (begins with `.`).
- A path with **no dot-prefixed segment is human-safe** and MUST NOT receive
  impure-provider output.

Provenance and the name are **two authorities for two audiences** of the same fact:
the graph's `impure` flag is how the machine knows a node is AI; the dot-name is how
a human knows, at a glance. Neither is subordinate — INV-3 requires them to agree,
and the build refusal is what guarantees it.

`dist/` remains the pure-output root. Impure artifacts are routed into a dot-zoned
root — a top-level **`.ai/`** sibling of `dist/` (the rename of the existing
`ai-generated/` root; see D3); pure artifacts may sit anywhere, including human-safe
areas. Enforcement is defense-in-depth: production-control routes impure
output to a dot-zoned location AND refuses at build if an impure output resolves to
a dot-free path, plus a standalone audit verb over the manifest.

Chosen because it is fully decidable from the path alone, needs no configuration or
declared list of "blessed" human names (non-dot *is* human, the fail-safe default),
and — the load-bearing reason — a human reads a file's zone straight from its name
with no tooling (INV-2). It also matches the codebase's existing taste for simple
mechanical path invariants (`RelativePathSchema`, the `run.ts` traversal refusal).

### Rejected — adopt-the-edit (the original `artifact-adoption` framing)

A verb that confirms a human edit is intentional, re-runs the target's validators
against the edited bytes, and re-records the hash and verdict, keeping producer
provenance distinct from adoption provenance.

Rejected by the operator: it lets AI and human authorship blur in the same file and
the same location, which is the condition this feature exists to prevent. It also
carried unresolved sub-problems that vanish once the collision is prevented — what
the `producer` field means after a human writes the bytes, whether a target with no
declared validator can be adopted at all, and whether drift semantics still apply to
a human-written artifact. Prevention removes the question rather than answering it.

### Rejected — zoning by a declared list of human-safe directory names

Configuration names the human-safe roots (e.g. `content`, `manuscript`); everything
under one is inviolable, and AI lives elsewhere.

Rejected: it makes "safe" depend on someone having correctly maintained a list, and
an unlisted area silently permits AI — the opposite of fail-safe. The any-dot-wins
rule achieves the same segregation with no list to keep current and no
default-open hole.

### Rejected — neutral-permitted default (protect only when named)

A directory is protected only when it (or an ancestor) carries a human-safe name;
an unmarked directory still accepts AI output.

Rejected (operator decision): "fail-safe." Under any-dot-wins the default is
protection — an unmarked path is human-safe — so an area is never silently open to
AI merely because no one thought to protect it.

### Rejected — human-dominance (a nested dot cannot carve an AI pocket)

An intermediate proposal in this session: a human-safe subtree is absolutely
inviolable, so `content/.ai/` would still be forbidden despite the dot.

Rejected (operator decision): the operator specified that impure artifacts land in
a dot-prefixed directory *under* `dist/` — i.e. a dot segment nested beneath the
non-dot `dist/` DOES establish an AI zone. Human-dominance would have forbidden
exactly that. The rule is uniform any-dot-wins: a dot segment anywhere on the path
permits AI. Keeping `dist/` free of a human-safe *name* is what makes this coherent
— `dist/` is a build root, not a human working area.

### Rejected — rename the build root to `.dist/`

Make the whole build output tree a dot-zone.

Rejected (operator decision): "you can still have `./dist`." `dist/` may hold pure
mechanical output at non-dot paths; only impure output must be dot-zoned within it.
Renaming the root would force pure output into a dot-zone unnecessarily and churn
every fixture and the quickstart for no gain.

## Decisions

**D1 — Zoning is read from the directory name, any-dot-wins — and the name is a human authority, not just a rule.**
A path is AI-permitted iff at least one of its directory segments begins with `.`.
A path with no dot-prefixed segment is human-safe. The rule is evaluated on the
production-root-relative path (see D1a), is total (every path resolves to exactly
one zone), and requires no configuration. The name is chosen as the carrier because
a human reads it at a glance (INV-2); provenance (the `impure` flag) is the
machine's authority for the same fact, and INV-3 binds the two to agree. "Directory
name as authority" means the *human's* authority — it is not subordinate to
provenance, it is the other projection of it.

**D1a — Normative zoning root and basename exclusion.**
Zoning is evaluated **only over path segments relative to the production root**
supplied to production-control (the episode/output root). Segments of the absolute
filesystem path *above* that root — a repository's `.git/`, `.github/`, a
dot-prefixed home directory — do NOT participate; a dotted ancestor outside the
production root never classifies content inside it. Within that scope, **only
directory segments establish the zone; the basename does not.** A dot-prefixed
*file* in a non-dot directory (`dist/.draft.md`) is human-safe, not AI-zoned — the
basename and extension may signal artifact *type* to a human, but they do not change
the *zone*. Normative rule: *a path is AI-permitted iff at least one of its parent
directory segments, relative to the production root, begins with `.`.*

**D2 — Impure output may never be written to a human-safe path.**
An impure-provider artifact MUST resolve to an AI-permitted (dot-zoned) path. Pure
output has no such restriction and MAY be written to human-safe paths (a generated
README, a YAML) — the (a)-may, (b)-must-not asymmetry the operator specified.

**D2a — A pure declaration may not return impure (fail-loud on contradictory metadata).**
**Correction (2026-07-25, during /speckit-plan):** an earlier version of this decision
claimed a *false-safe path* — that routing picks the output location from the static
`ProviderDecl.impure` before the provider runs, so a pure-declared/impure-returned output
lands in a human area. A fuller reading of the build path shows that is **wrong**.
`src/providers/build.ts:112` chooses the output root **after** the response:
`outputRoot = impurityOf(decl, response) !== undefined ? 'ai-generated' : 'dist'`, and
`impurityOf` is `response.impure ?? decl.impure` (build.ts:285). So an impure *response*
already routes to the AI directory — impure bytes do **not** reach a human-safe path. The
false-safe path does not exist; the earlier "verified" claim verified the wrong half of the
code (it read `impurityOf` but not the post-response routing at line 112).

The rule **survives on different grounds**: a provider **declared pure** that returns an
impure `BuildResponse` is *contradictory provenance metadata*, and today `impurityOf`
silently coalesces it (`response.impure ?? decl.impure`) and reclassifies. That is a
silent reclassification, which sits badly with Principle V (fail loud, never false-clean).
So: **a pure declaration returning impure MUST be refused, naming the target** — as an
integrity/fail-loud rule, not a false-safe closure. `BuildResponse.impure` may corroborate
a *statically-declared* impure provider; it may not introduce impurity a pure declaration
lacked. (Operator-ratified 2026-07-25.)

**D2b — Authored content must reside in a human-safe path (the authored direction of INV-1/INV-3).**
The impure→dot rule alone is one-way: it keeps AI out of human areas but does not
stop an *authored* node from pointing into a dot-zone, which would be the reverse
divergence INV-3 exists to prevent — a human reads the location as not-human-safe
while the graph calls it authored. So an **authored node MUST resolve to a human-safe
path**; a dot-zone is reserved for generated and operational artifacts and is not a
supported authored workspace. This is the one place this revision *extends* the
operator's stated rule (which named only "AI must never be in human areas"); it is
adopted because "strict segregation between the three classes" and INV-3's
two-direction agreement both require it. Flagged for operator veto. Pure-derived
nodes remain deliberately free to live in either zone. **Ratified by the operator
2026-07-25** — D2b stands; segregation is bidirectional for the two hard classes.

**D3 — The impure output root becomes a dot-zoned `.ai/` sibling of `dist/`.**
**Correction (2026-07-25, during /speckit-plan):** impurity-based routing already
exists. `build.ts:112` sends impure output to a top-level **`ai-generated/`** directory
(a sibling of `dist/`, per `stage()`), pure output to `dist/`. `ai-generated/` is *not*
dot-prefixed, so under this feature's own rule it classifies as human-safe — a violation.
The change is therefore a **rename of the existing impure root** `ai-generated/` →
**`.ai/`** (kept as a top-level sibling of `dist/`; operator decision 2026-07-25), which
makes it AI-permitted with a one-token routing change plus a fixture/quickstart migration.
`dist/` stays the pure-output root, unchanged. (The earlier wording "a dot-prefixed
subdirectory under `dist/`" was written before the existing sibling routing was found; the
operator chose the sibling rename over moving impure output into `dist/.ai/`.)

**D4 — Fail-safe by default.**
Because non-dot is human-safe, an area is protected unless it is explicitly dotted.
There is no configuration whose absence opens a hole; forgetting to mark something
leaves it protected, never exposed.

**D5 — Enforcement keeps the human name and the machine provenance in agreement (INV-3).**
The name is the human's authority (D1); this is the machinery that guarantees it
never diverges from the `impure` flag. Defense-in-depth, in a **fixed order** so
zoning is never the only defense against a provider escape:

1. **Routing** — production-control assigns an impure target's output location
   inside a dot-zone (and an authored node's under a human-safe path, D2b), so the
   common path is correct — and human-legible — by construction.
2. **Path resolution and containment first, then zoning.** For each declared output
   the build MUST, in this order: (a) resolve the path; (b) reject traversal/escape;
   (c) **confirm the resolved real path is contained within the assigned
   `output_dir`** — evaluated on the *symlink-resolved* destination, not the lexical
   path (D5c); (d) evaluate zoning; (e) stage. A provider returning `../../x.md` is a
   general contract violation caught at (b)/(c) *regardless of impurity* — it is not
   a zoning failure. `run.ts:229` today does (a)/(b) lexically; the containment and
   real-path steps are additions this feature depends on.
3. **Zoning refusal** — once contained, an impure output resolving to a dot-free
   (human-safe) path is refused, naming the path (FR-036 shape). This is where INV-3
   is enforced: it stops a name from lying about provenance.
4. **Routing audit verb** — a read-only check that audits **routing policy**, not
   output artifacts (it cannot know a runtime filename or a runtime escape). It
   establishes that every impure target *would be assigned* a dot-zoned `output_dir`,
   every authored node a human-safe one (D2b), and no configured target routing
   violates zoning — and it reports plainly that provider filenames and escapes are
   checked only at build time. See open question 3.

**D5b — A dot-zone means "AI-permitted / not human-safe," not "definitely AI."**
Under any-dot-wins, `dist/.cache/`, `dist/.tmp/`, and `dist/.ai/` are all
AI-permitted and treated identically; `.ai` is *conventional, not special*. So the
human semantics are asymmetric and must be documented and taught as such:
`dot-zoned → possibly AI-generated, not human-safe`; `non-dot → not impure,
human-safe`. A dot path does not *prove* a file is AI-generated (a pure or temporary
file may sit there); a non-dot path *does* prove the location holds no impure
content. INV-2 is about *safety legibility* (is it safe to author here?), which the
name answers exactly; exact provenance remains the graph's to state.

**D5c — Zoning is evaluated on the resolved destination, not the lexical path.**
A symlink whose lexical path is dot-zoned but whose real target is human-safe
(`dist/.ai/out -> ../../manuscript/ch01.md`) would satisfy a name-only check while
writing into a human area. Zoning (and the containment check, D5.2c) MUST therefore
run against the `realpath`-resolved destination. `run.ts` is lexical today; resolving
the real path before classification is a required property, with a dedicated test.

**D5a — File naming is part of the human-legibility layer, not a separate undefined mechanism.**
An earlier draft named a vague "file-type / role" check as a redundant secondary
enforcement layer. A third-party reviewer rightly flagged that an undefined second
mechanism invites confusion about which one is authoritative. It is neither removed
nor left vague: file and directory **names** are one human-legibility surface
(INV-2) — an extension a human reads (`.md`, `.wav`) is the same kind of at-a-glance
signal as a dot-directory. So naming (directory *and* file) is the single
human-facing authority, provenance is the machine authority, and INV-3 binds them.
Any *further* type/role check (e.g. per-zone extension expectations) is **reserved
as a future layer, deliberately unspecified in v1** — v1 rests on naming +
provenance + the refusal/audit. It returns as its own feature only when a concrete
need names it.

**D6 — AI is never taken over by a human; the human authors a companion, and neither node auto-demotes the other.**
An AI (impure) artifact is never hand-edited in place (INV-4). A human who wants to
work on the content authors a *separate* document in a human-safe area. The manifest
already models the relationship: `AuthoredDecl.follows` is the advisory "is a
response to" edge, distinct from a build dependency (`follows` never rebuilds and
never blocks alone, FR-019). The AI artifact may be the thing the human companion
follows. No new edge type is required.

**On whether the companion "becomes the authoritative production input"** — a
reviewer asked that this be stated. It is deliberately *not* asserted as a general
rule, because it is not one. The AI artifact and the human companion are **distinct
nodes with distinct provenance**; which of them is a release target is a manifest
declaration (`manifest.targets`), not something this feature imposes. In some
domains the AI artifact is itself the deliverable (a voice edition, gated by its
validator); in others a human companion is the thing shipped. Segregation guarantees
the two never blur in one file; it does not rank them. What *is* true generally: a
human edit never mutates the AI artifact, so the AI artifact's provenance stays
honest whether or not a companion exists.

**D6a — The AI artifact's post-companion lifecycle.**
Because a companion never supersedes it in the graph, an AI artifact remains a valid,
reproducible build product for its whole life — retained for provenance, comparison,
and (where it is the declared target) as the deliverable. It is not demoted by the
existence of a companion; it is simply never the thing a human hand-edits.

**D7 — Mechanical (pure) output retains the `modified` protection; AI output does not need it.**
The `modified` state and its release block are correct for a pure output a human
edited by mistake (the bytes are reproducible; the system should not silently
rebuild over an edit without the human's say-so). For AI output, a `modified` state
represents an **unsupported out-of-band edit**, not a normal editorial transition —
zoning prevents any *supported workflow* from depending on such an edit (INV-4), but
it does not make the edit mechanically impossible: a human can still open
`dist/.ai/…/ch01.md` in an editor, and the node will still become `modified`.
**Zoning does not supersede TASK-15 for impure artifacts.** TASK-15's
stale-over-modified precedence — which silently erases a hand edit when an input
also changes — affects *all* derived nodes, impure ones included. So this feature
makes in-place editing unsupported and conspicuous; it does not by itself protect
those bytes from silent loss. See the safety-dependency note under Dependencies.

**D8 — This feature adds enforcement, not a new node kind.**
The three classes are the existing authored / pure-derived / impure-derived
distinction (see problem domain). This feature does not introduce a fourth node
kind or reclassify nodes; it adds the zoning invariant and its enforcement over the
provider outputs that already carry impurity provenance.

## Open questions

1. **Does the `modified` trap still need a resolution verb for pure mechanical
   output?** D7 removes AI output from the trap by prevention, but a human can still
   edit a pure output and hit the same dead end (`modified`, no `resolve-edit`
   verb, `build` overwrites, `waive` refused). For a *reproducible* output the
   honest answer may simply be "rebuild, your edit had no standing" — but the system
   should probably say so rather than silently overwrite (this overlaps TASK-15).
   Whether that warrants a verb, or just a clear refusal-with-guidance on `build`,
   is unresolved and separable from the segregation invariant. A third-party
   reviewer's instinct here matches TASK-15's candidate fix: no new lifecycle state —
   `build` on a `modified` pure output refuses with an explicit "this output is
   reproducible; rebuilding discards your edits; proceed?" acknowledgment. Recorded
   as the leaning; the decision stays with TASK-15.

2. **Impure output layout — SETTLED (2026-07-25).** production-control already routes
   impure output to a top-level `ai-generated/` root (`build.ts:112`, `stage()`); the
   operator chose to **rename that root to `.ai/`** (a top-level sibling of `dist/`)
   rather than move impure output into `dist/.ai/`. The per-target subpath within `.ai/`
   is unchanged from today's `ai-generated/<…>` layout. See the corrected D3.

3. **The audit verb audits routing policy, not output artifacts.** Output paths are
   reported by the provider in `BuildResponse`, not declared in the manifest, so the
   audit can establish that every impure target *would be assigned* a dot-zoned
   `output_dir` and every authored node a human-safe one, and that no configured
   routing violates zoning — but it *cannot* know the runtime filename, whether the
   provider will escape, or (given D2a) whether a declaration is honest. Those are
   the build's job (D5.2/D5.3/D2a). The audit must report this scope honestly rather
   than implying it verified the artifacts themselves. Naming it a *routing audit*
   is the accurate contract.

   *(The former open question 4 — "what is the file-type secondary signal?" — is
   removed: D5a settles it. v1 has no separate file-type/role enforcement; naming
   plus provenance are the two channels; extension/role validation is deferred until
   a concrete need names it.)*

4. **The `dist/` migration surface.** Routing impure outputs under a dot-zone
   changes paths that fixtures, the quickstart (TASK-2), and existing tests assume.
   This is mechanical but real, and it interacts with `design:feature/directory-
   outputs` (a directory-valued impure output would be a dot-zoned *tree*). Scope of
   the migration is a plan concern; flagged here so it is not discovered late.

5. **Does the invariant apply to non-`dist/` derived outputs?** If a future pure
   provider is *permitted* to write a README into a human-safe area (as the operator
   allowed), the zoning check must let pure output through anywhere while still
   refusing impure output outside a dot-zone. The rule as stated (D2) already does
   this — the check keys on impurity, not on being under `dist/` — but it should be
   verified against any provider that writes outside `dist/`.

## Testing strategy (for the spec/plan)

The zoning decision and its refusals are small and adversarial by nature; the
following cases are normative and belong in the plan:

- impure → `dist/.ai/target/output.md` **passes**; impure → `dist/target/.ai/out.md`
  **passes** (any-dot-wins); impure → `dist/target/output.md` **fails**.
- pure → a human-safe path **passes**; pure → a dot-zone **passes**.
- authored node in a human-safe path **passes**; authored node in a dot-zone
  **fails** (D2b).
- an absolute path with a dotted ancestor *above* the production root does **not**
  affect zoning (D1a).
- a dot-prefixed **filename** in a non-dot directory (`dist/.draft.md`) does **not**
  establish a zone (D1a).
- `.cache`, `.tmp`, `.preview`, `.ai` are all treated **identically** (D5b).
- a provider **declared pure that returns `impure`** is **refused** (D2a).
- provider output **escaping** the assigned directory is rejected **before** zoning
  (D5.2), regardless of impurity.
- a **symlink** whose lexical path is dot-zoned but whose real target is human-safe
  is refused — zoning runs on the resolved destination (D5c).
- a **directory-valued** impure output is classified from its root and all contained
  files inherit the zone (interacts with `design:feature/directory-outputs`).
- an accidental edit to an impure artifact still produces `modified`; the feature
  neither erases nor reinterprets that state (D7), and the stale-over-modified case
  still loses bytes until TASK-15 is fixed.

## Provenance

- **Design backend:** `superpowers:brainstorming`, driven in-session by
  `/stack-control:design` under house-rules block `stack-control-design-v1`.
- **Roadmap:** reclassified from `design:feature/artifact-adoption` to
  `design:feature/content-zone-segregation` mid-session; the `design:` pointer and
  the `design:feature/voice-editions` `depends-on` edge were repointed in the same
  move; `stackctl roadmap order` re-validated the graph (no cycle; segregation
  orders before voice-editions).
- **Backlog captured during exploration:** **TASK-15**
  (`build-destroys-hand-edits-without-refusing`) — `pc build` has no state guard and
  the stale-over-modified precedence makes one data-loss path silent.
- **Feature dependency vs safety dependency on TASK-15.** Zoning does not *require*
  TASK-15 to function — the two are architecturally separable. But the repository
  MUST NOT claim that derived edits are protected until TASK-15 is fixed: an
  accidental in-place edit of a dot-zoned impure artifact still becomes `modified`
  and can still be silently erased by a rebuild when an input also changes (D7).
  Zoning makes such editing unsupported and conspicuous; it does not protect the
  bytes. State this distinction wherever the feature's safety story is described.
- **production-control sources consulted:** `src/state/frontier.ts`,
  `src/state/resolve.ts`, `src/state/release.ts`, `src/cli/review.ts`,
  `src/cli/build.ts`, `src/cli/index.ts`, `src/providers/contract.ts`,
  `src/providers/run.ts`, `src/manifest/schema.ts`, `src/ledger/schema.ts`,
  `profiles/editorial-audio.yaml`.
- **Related records:** `docs/superpowers/specs/2026-07-25-voice-editions-design.md`
  (the blocked consumer; its D19 is superseded by this design and must be revised —
  a voice edition is a machine artifact that is never hand-edited, and human polish
  is a `follows` companion in a human-safe area).
- **Operator decisions recorded during the session:** reframe from adopt-the-edit to
  prevent-the-collision; three enforced classes (human / mechanical / AI) segregated
  by directory, file type, and mechanical validation; **AI content must never be
  written to a human-safe area, mechanical content may**; zoning by directory-name
  convention inherited downward; **fail-safe default**; **any-dot-wins** (a nested
  dot under a non-dot dir DOES establish an AI zone — human-dominance rejected);
  **keep `dist/`**, but impure artifacts must be written to a dot-prefixed directory
  somewhere under it; and — the operator's emphatic correction during review — **the
  naming convention is CRITICAL and for HUMANS**: humans read names at a glance, so
  the name is a first-class human-facing authority, not a swappable enforcement
  detail subordinate to provenance (this drove INV-2/INV-3 and the D1/D5 reframing).
  The operator's phrase "file type" as one of the three mechanisms is realized as the
  naming-legibility surface (extensions a human reads) plus a reserved future
  type/role check (D5a); v1 does **not** define a standalone file-type enforcement
  layer.

### Third-party review disposition (2026-07-25)

A third-party review recommended revision before approval, praising the reframe
(prevent the collision rather than clean it up) and the fail-safe default. Its
central architectural ask — separate the invariant from the mechanism, because the
mechanism might evolve — was **partially rejected after operator input**: legibility
of the zone *from the name* (INV-2) is itself part of the invariant, so the naming
convention is not a swappable implementation detail. A future mechanism that made a
file's zone unreadable from its name would violate the principle even while
enforcing segregation. The reviewer's related move — promote node provenance to "the
conceptual authority" and demote the directory to "enforcement" — is corrected to
**two authorities for two audiences** bound by INV-3.

Incorporated in full: the explicit invariants section (INV-1..4); the named
in-place-editing invariant (INV-4); the correction that a companion does **not**
generally become the authoritative input, only that the AI artifact is never
mutated (D6); the AI artifact's retained-but-not-demoted lifecycle (D6a); and the
resolution of the vague file-type layer into the naming-legibility surface plus a
reserved-and-unspecified future type check (D5a). The reviewer's open-question-1
instinct (refuse-with-acknowledgment over a new state) is recorded against TASK-15.
Pushed back on: the swappable-mechanism premise (above), and the companion-supersedes
claim (D6/D6a).

**Second review round (2026-07-25), "approve after two small corrections."**
Both required corrections and both strongly-recommended decisions are incorporated,
plus several clarifications — and two of the reviewer's catches were verified against
the code as real holes before acceptance:

- **D2a (CORRECTED 2026-07-25 during /speckit-plan):** the "false-safe path" claim here
  was **wrong** — it read `impurityOf` (build.ts:285) but not the post-response routing at
  `build.ts:112`, which chooses the output root *after* the response and sends any impure
  result to the AI directory. So impure bytes never reach a human-safe path; there is no
  false-safe. The rule survives only as a **fail-loud** rule: a pure declaration returning
  impure is contradictory metadata that `impurityOf` silently coalesces, so the build must
  refuse rather than reclassify. See the corrected D2a and D3.
- **D5c (verified):** `src/providers/run.ts:229` resolves output paths *lexically*, so
  a symlink whose lexical path is dot-zoned but whose real target is human-safe would
  pass a name-only check. Zoning must run on the `realpath`-resolved destination.
- **D1a:** normative zoning root (segments relative to the production root only;
  dotted ancestors above it don't classify) and basename exclusion (a dotted *file*
  in a non-dot dir is human-safe).
- **D2b (extends the operator's rule — flagged for veto):** authored content must
  resolve to a human-safe path, making INV-1/INV-3 bidirectional for the two hard
  classes. Adopted as the faithful reading of "strict segregation between the three
  classes"; the operator can veto.
- **D5b:** a dot-zone means *AI-permitted / not human-safe*, not "definitely AI"
  (`.cache`/`.tmp`/`.ai` are identical; `.ai` is conventional). INV-2 is safety
  legibility, not exact-provenance legibility.
- **D5.2 ordering:** resolve → reject escape → confirm containment → zone → stage,
  so zoning is never the sole defense against a provider escape (a general contract
  violation, impure or not).
- **D5.4 / OQ3:** the audit is a *routing* audit and must report its scope honestly.
- **D7 tightened + TASK-15 safety-dependency** recorded (zoning does not protect the
  bytes of an out-of-band edit; TASK-15 must still be fixed).
- Stale **open question 4 removed** (D5a settles it); provenance wording corrected so
  v1 claims no standalone file-type layer; a **normative test list** added.

**Third review round (2026-07-25) — approved, no required changes.** The reviewer
assessed the design as architecturally complete and recommended approval. One
forward-looking observation — a possible future *fourth storage category* for
machine-operational state (`.production/`, `.cache/`, `.work/`), a storage zone not a
node kind, explicitly "not now" — was captured to the design inbox
(`machine-operational-storage-zone`) rather than added here, per the reviewer's own
guidance. **D2b remains flagged for operator veto** (it extends the operator's stated
rule to the authored direction); the reviewer endorses it, but the operator's
explicit position is still the deciding one and has not yet been recorded. The
`design-approved:` marker remains the operator's to set (house rule: the operator
judges, the gate checks the recorded fact).

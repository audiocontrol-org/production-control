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

## Solution space

### Chosen — directory-name zoning, any-dot-wins, impure output confined to dot-zoned paths

Zoning authority is the **directory name**, inherited down the tree:

- A path is **AI-permitted iff at least one of its directory segments is
  dot-prefixed** (begins with `.`).
- A path with **no dot-prefixed segment is human-safe** and MUST NOT receive
  impure-provider output.

`dist/` remains the build root. Impure artifacts are routed into a dot-prefixed
subdirectory under it (`dist/.ai/…`); pure artifacts may sit anywhere, including
human-safe areas. Enforcement is defense-in-depth: production-control routes impure
output to a dot-zoned location AND refuses at build if an impure output resolves to
a dot-free path, plus a standalone audit verb over the manifest.

Chosen because it is fully decidable from the path alone, needs no configuration or
declared list of "blessed" human names (non-dot *is* human, the fail-safe default),
is visually obvious (a leading dot is a deliberate, conspicuous mark), and matches
the codebase's existing taste for simple mechanical path invariants
(`RelativePathSchema`, the `run.ts` traversal refusal).

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

**D1 — Zoning is decided by directory name, any-dot-wins.**
A path is AI-permitted iff at least one of its directory segments begins with `.`.
A path with no dot-prefixed segment is human-safe. The rule is evaluated on the
episode-relative path, is total (every path resolves to exactly one zone), and
requires no configuration.

**D2 — The invariant: impure output may never be written to a human-safe path.**
An impure-provider (`ProviderDecl.impure` present, or `BuildResponse.impure`
present) artifact MUST resolve to an AI-permitted (dot-zoned) path. Pure output has
no such restriction and MAY be written to human-safe paths (a generated README, a
YAML) — this is the (a)-may, (b)-must-not asymmetry the operator specified.

**D3 — `dist/` stays the build root; impure output is dot-zoned within it.**
The build root is unchanged. Impure targets are routed to a dot-prefixed
subdirectory under `dist/` (conventionally `dist/.ai/<target>/`, exact layout
settled in the plan). Pure targets keep their current non-dot locations. No rename
of `dist/`.

**D4 — Fail-safe by default.**
Because non-dot is human-safe, an area is protected unless it is explicitly dotted.
There is no configuration whose absence opens a hole; forgetting to mark something
leaves it protected, never exposed.

**D5 — Enforcement is defense-in-depth, directory name as the authority.**
Three layers, the directory-name rule (D1) being the authority the others check
against:
1. **Routing** — production-control assigns an impure target's output location
   inside a dot-zone, so the common path is correct by construction.
2. **Build-time refusal** — if an impure provider declares an output that resolves
   to a dot-free (human-safe) path, the build refuses, naming the path, in the same
   layer where `run.ts` already refuses traversal (FR-036 shape). This catches a
   provider that tries to escape its routed `output_dir`.
3. **Standalone audit verb** — a read-only check over the whole manifest/graph that
   reports any impure target whose intended output is not dot-zoned, so a violation
   is caught before a build rather than at build time.
The file-type / role signal is a redundant secondary check, not the authority.

**D6 — AI is never taken over by a human; the human authors a companion.**
An AI (impure) artifact is never hand-edited in place. A human who wants to work on
the prose authors a *separate* document in a human-safe area. The manifest already
models the relationship: `AuthoredDecl.follows` is the advisory "is a response to"
edge, distinct from a build dependency (`follows` never rebuilds and never blocks
alone, FR-019). The AI draft may be the thing the human companion follows. No new
edge type is required.

**D7 — Mechanical (pure) output retains the `modified` protection; AI output does not need it.**
The `modified` state and its release block are correct for a pure output a human
edited by mistake (the bytes are reproducible; the system should not silently
rebuild over an edit without the human's say-so). For AI output the situation
should not arise under D6 — an impure artifact lives in a dot-zone a human does not
treat as their working area — so the missing `resolve-edit` verb is not on this
feature's critical path. Whether pure outputs still need a `resolve-edit` resolution
is deferred (open question 1); it is a smaller, separable matter now that the AI
class is handled by prevention.

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
   is unresolved and separable from the segregation invariant.

2. **Where exactly do impure outputs land under `dist/`, and who decides the
   subpath?** D3 fixes the dot-zone requirement but not the layout
   (`dist/.ai/<target>/` vs `dist/<target>/.ai/` vs a single `dist/.ai/` tree). The
   provider currently chooses its output filename within a production-control-
   assigned `output_dir`; the cleanest enforcement is for production-control to
   assign a dot-zoned `output_dir` for impure targets, but the precise scheme is a
   plan-level decision.

3. **Can the audit verb know an impure target's output path statically?** Output
   paths are reported by the provider in `BuildResponse`, not declared in the
   manifest, so a pre-build audit can only check the *routing rule* (the assigned
   `output_dir` is dot-zoned), not the provider's eventual filename. The build-time
   refusal (D5.2) is what covers a provider that escapes its `output_dir`. Whether
   the audit should also assert something stronger is open.

4. **File-type / role as the secondary signal — what is it, concretely?** D5 names
   it as a redundant check but does not define it. Is it an extension allow-list per
   zone, a role attribute on the node, or something else? Left open because the
   directory-name authority stands on its own; the secondary layer can be specified
   in the plan or a follow-on.

5. **The `dist/` migration surface.** Routing impure outputs under a dot-zone
   changes paths that fixtures, the quickstart (TASK-2), and existing tests assume.
   This is mechanical but real, and it interacts with `design:feature/directory-
   outputs` (a directory-valued impure output would be a dot-zoned *tree*). Scope of
   the migration is a plan concern; flagged here so it is not discovered late.

6. **Does the invariant apply to non-`dist/` derived outputs?** If a future pure
   provider is *permitted* to write a README into a human-safe area (as the operator
   allowed), the zoning check must let pure output through anywhere while still
   refusing impure output outside a dot-zone. The rule as stated (D2) already does
   this — the check keys on impurity, not on being under `dist/` — but it should be
   verified against any provider that writes outside `dist/`.

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
  the stale-over-modified precedence makes one data-loss path silent. Separable from
  this design.
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
  somewhere under it.

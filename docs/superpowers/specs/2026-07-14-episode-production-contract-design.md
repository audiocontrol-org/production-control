# Episode Production Contract v0.1 — Design

**Roadmap item**: `design:feature/episode-production-contract`

**Status**: Approved (design); implementation plan pending

## Purpose

Define what an episode directory *is*, what artifacts a production yields, and the
contract between production-control and the specialized craft tools that do the
actual media work.

This is the tactical successor to the vision document. The vision states the
philosophy; this states the shape of the bytes on disk.

## Problem domain

production-control coordinates the production of multimedia publications from
human-authored source materials. It is an orchestration layer. It does not write,
edit, render, or master anything.

The problem is not *building* the outputs — craft tools already do that well. The
problem is knowing, at any moment and after any edit, which outputs still faithfully
represent the authored work and which have silently drifted from it. No general tool
answers that, because none of them know what an episode is.

Three boundaries fix the scope:

**Subject-agnostic.** Port Breton is the first subject, not the domain. Nothing in
the contract, schemas, or profiles may encode anything about it. Reuse across
subjects lives in *profiles*; subject-specific content lives in content repos.

**Distinct from colony-cults.** `colony-cults` publishes facsimiles of primary
research sources and owns its own provenance and publishing machinery
(`008-edition-publishing`). production-control publishes *authored narrative*.
The mechanical resemblance between the two provenance layers is convergent
evolution, not shared substrate. We do not orchestrate colony-cults, refactor it,
or lift its machinery upward.

**A library, not a monorepo.** production-control ships as an installable
TypeScript package. Each subject gets its own content repo that depends on it, the
way a site depends on Astro. The tool never contains anyone's prose. `examples/`
holds fixtures only.

## Solution space

Three approaches were considered. The distinguishing question is how much execution
the orchestration layer owns.

### Rejected — A: state oracle only

production-control validates and reports, and never executes anything. It reads
manifests, builds the graph, and answers what is missing, stale, unvalidated, and
releasable. Humans and CI run the craft tools.

The smallest thing that delivers the vision's stated primary interface, and useful on
day one against content that is only half-authored. Rejected as an *endpoint*, not as
a step: it can tell you the EPUB is stale and then do nothing about it. It survives
inside B as milestone 1.

### Chosen — B: oracle plus declared providers

The graph is the core, and each artifact declares the command that produces it.
`pc build epub` shells out to the craft tool, then records provenance and freshness
from the result — make-with-provenance, where the provenance is the point and the
execution is deliberately dumb.

Chosen because it stays honest to *delegate to specialized systems*, keeps
videocontrol and audio tooling independently useful, and is a strict superset of A —
so A becomes a milestone inside B rather than a competing bet.

The agent-driven constraint decides it independently: if an agent could run a craft
tool directly and record provenance as a separate step, the ledger would be wrong
within a week. Execution must live inside production-control so that building and
recording are one indivisible act.

### Rejected — C: full orchestrator

Scheduling, caching, parallelism, remote execution.

Rejected: this is rebuilding Bazel while the actual problem is that nobody has
written the article yet. It also violates the constitution's *grow by supporting
targets, never by expanding intelligence*.

### Why the graph and not the engine

Executing a DAG of commands is solved (make, turbo, nx). Modeling an artifact graph
with provenance and freshness — answering *"the podcast is stale because the script
moved after the narration was cut"* — is not.

So: **the graph is the core; execution is a deliberately dumb layer on top.**

- **Milestone 1 — oracle.** Manifests, the artifact graph, content-hash freshness,
  validation state, release readiness. Reports; executes nothing. Useful against
  half-authored content on day one.
- **Milestone 2 — providers.** `pc build <target>` shells out to craft tools and
  records provenance from the result. Strictly additive.

The sequence de-risks the novel part before spending anything on the commodity part.
If execution is never built, the oracle still earns its keep.

### The oracle is authoritative; providers are disposable

This is the invariant the rest of the design serves.

videocontrol can be replaced. The EPUB tool can be replaced. Astro can be swapped for
a different generator. The execution layer itself can be replaced. Through all of it
the graph, the contracts, the manifests, and the ledger stay valid — because none of
them encode how any particular tool behaves.

The center of gravity stays put while the tools around it evolve. Any proposal that
would invert this — making the graph depend on a provider's behavior, or teaching the
oracle a craft so a provider can stay simple — is a design error regardless of what
it buys in the moment.

## Decisions

Each decision is elaborated in the section named beside it.

| Decision | Why | Detail |
|---|---|---|
| Oracle first, providers second (approach B) | The graph is novel; execution is commodity | *Solution space* |
| The oracle is authoritative; providers are disposable | Any tool can be replaced without invalidating the graph | *The oracle is authoritative* |
| Two node kinds only: authored and derived | Lets narration sit on either side without the system knowing where a voice comes from | *The episode directory* |
| Identity is the key; hashes are its realization | Identity survives rebuilds, so the graph stays durable while hashes churn | *Identity is the key* |
| Freshness from content hashes, never mtime | mtime lies after a clone; determinism is a stated principle | *The ledger and freshness* |
| Ledger committed; `dist/` not | Provenance is the product; a fresh clone can answer staleness with no rebuild | *The ledger and freshness* |
| Advisory edges (`follows`) + `needs-review` | Authored nodes have no producer, so script/performance drift would otherwise report green | *Advisory edges* |
| Private store is content-addressed | Key == hash, so `pc status` needs zero network access | *Asset storage* |
| S3-compatible endpoint; git-lfs rejected | Backend becomes config; LFS covers only authored inputs and would leave two mechanisms | *Backend agnosticism* |
| Providers are stdio subprocesses, not plugins | A Node plugin API would force ffmpeg-shaped tools to become Node modules | *The provider contract* |
| Purity is a norm, not an invariant | TTS and font-fetching builds are real; the ledger contains the damage | *The provider contract* |
| Build and record are one indivisible act | An agent drives this; any skippable step eventually gets skipped | *Agent-native* |
| v0.1 stops at "releasable" | Publishing deserves its own spec, as colony-cults `008` concluded | *Scope* |
| Editorial + audio; video deferred | Forces the timed-transcript keystone without coupling to videocontrol's maturity | *Scope* |

## Agent-native as a design constraint

An agent drives production-control; a human authors the inputs and drives the agent.
Two consequences, and they are structural rather than cosmetic.

**Provenance must be non-discretionary.** Agents skip steps. If an agent could run a
craft tool directly and record provenance as a separate step, the ledger would be
wrong within a week. Therefore `pc build` builds *and* records as one indivisible
act — the same welding principle as `stackctl ship`, which fuses merge to
recording `shipped` so there is no skippable second step.

**Structured output is the primary interface.** `--json` on every read verb. Errors
fail loud and name what is missing. A `next` verb reports the frontier rather than
making the agent infer it from prose.

## The episode directory

Nothing about the input set is hardcoded. The vision says *"for the initial Port
Breton workflow, the authoritative inputs are outline, article, script"* — the
qualifier is load-bearing. Another subject may have no outline, two scripts, or a
photo essay. Inputs are **declared**, not assumed.

Every node in the graph is one of exactly two kinds:

- **authored** — a leaf. No producer. A human made it.
- **derived** — has a producer and upstream inputs.

This single distinction is what lets narration sit on either side without
production-control knowing or caring where a voice comes from. A recorded take is
authored; a synthesized one is derived. The manifest says which; freshness follows.

### Identity is the key; hashes are only its current realization

`longform`, `spoken`, `narration`, `voiceover`, `podcast` are **identities** — stable
names for roles in the production. A hash describes what an identity is realized as
*right now*.

Identity survives rebuilds. Hashes do not. Paths are an attribute of a node, not its
identity: moving `article.mdx` to `content/article.mdx` changes the manifest and
nothing else. Profiles bind targets to inputs by identity, and the ledger keys
artifacts by identity — which is why the graph's edges stay stable while every hash
beneath them churns.

This is what makes the graph durable rather than incidental. A production's shape is
its identities and their edges; everything else is a realization that can change
without the shape changing.

```
port-breton-01/
  episode.yaml          identity, authored inputs, profile, targets
  outline.md            authored
  article.mdx           authored
  script.md             authored
  assets/               authored (images, narration takes, ...)
  .production/
    ledger.yaml         what was built, from what, by whom -- COMMITTED
    cache/              local mirror of store objects -- gitignored
  dist/                 generated outputs -- gitignored
```

```yaml
version: 1
id: port-breton-01
title: The Free Colony of Port Breton
profile: editorial-audio

authored:
  outline:   { path: outline.md }
  longform:  { path: article.mdx }
  spoken:    { path: script.md }
  narration:
    path: assets/narration/take-03.wav
    follows: spoken          # advisory edge; see below

targets: [website, epub, voiceover, podcast]
```

**Profiles are where reuse lives.** A profile is the generic recipe: which roles
produce which targets, through which providers, along which edges. Episodes name a
profile. This is what keeps subject specifics out of the tool.

```yaml
# profiles/editorial-audio.yaml
version: 1
targets:
  epub:      { inputs: [longform, assets], provider: { cmd: [npx, epub-tooling, build] } }
  website:   { inputs: [longform, assets], provider: { cmd: [npx, astro, build] } }
  voiceover: { inputs: [narration],        provider: { cmd: [npx, audio-tooling, master] } }
  podcast:   { inputs: [voiceover],        provider: { cmd: [npx, audio-tooling, podcast] } }
```

`podcast` takes `voiceover`, not `narration` — the chain that makes cascade
staleness real. `website`'s output is a directory; the tree hash handles it.

## The ledger and freshness

The ledger is the canonical record of production state — the thing the oracle reads
to know what is true. It records, per derived artifact, what it was built from, as
content hashes captured at build time. It is **committed**; `dist/` is not.
Provenance *is* the product, so a fresh clone can answer "what is stale?" without
rebuilding anything, while the heavy bytes stay out of git.

**The file holds current state; git holds the history** — one commit per recorded
state. That split is deliberate: it keeps the ledger small and readable while leaving
it fully auditable, and it means the append-only guarantee lives in the tool built to
provide it rather than in a YAML file pretending to be a journal.

```yaml
version: 1
artifacts:
  epub:
    producer: { tool: epub-tooling, version: 1.2.0 }
    inputs:
      longform: sha256:abc1...
      assets:   sha256:def4...     # tree hash: sorted file hashes
    output:  { path: dist/port-breton-01.epub, hash: sha256:9f2... }
    built_at: 2026-07-14T22:30:00Z
    validation: { state: passed, at: 2026-07-14T22:31:00Z }
```

**Freshness is a declarative consistency check, not a computation.** Rehash each
declared input and compare against what the ledger recorded. The question is never
"how fresh is this?" — it is "is reality still consistent with what we recorded?"
Inconsistent means stale.

Content hashing (not mtime) because mtime lies after a clone, and determinism is a
stated principle.

**Transitive staleness is emergent, not implemented.** Edit `script.md`; every
artifact declaring it mismatches. Rebuild one; its output hash changes; everything
downstream mismatches in turn. The cascade falls out of content addressing. There is
no propagation logic to get wrong.

States: `fresh`, `stale`, `missing`, `blocked` (an input is absent), `invalid`
(validation failed), `needs-review` (see below).

**Producer version drift is reported, not auto-staling.** Otherwise bumping Astro
restales every episode ever published. Forcing a rebuild is a decision, not a
default.

## Advisory edges and `needs-review`

The authored/derived split opens a hole, and closing it is the most consequential
detail in this design.

An authored narration take has **no upstream edge** — production-control does not
know where a voice comes from, by design. So: record the take, then revise
`script.md`. The script's derived artifacts restale correctly. The narration does
not, because nothing produces it. The podcast is then built from a performance of a
script that no longer exists, and the system reports green. Silent drift between the
words and the voice, in a system whose purpose is catching exactly that.

You cannot rebuild a human, so a producer edge is the wrong instrument. The vision
already names the right one: it lists *"what requires human review?"* among the
questions production-control must answer. This is that question's first citizen.

An authored node may declare an **advisory edge**:

```yaml
narration:
  path: assets/narration/take-03.wav
  follows: spoken          # never rebuilds; only flags
```

`follows` never triggers a build and never blocks on its own. It adds one state,
`needs-review`: *the thing this tracks has moved since you made this; a human should
decide.* The human re-records, or waives with a recorded reason, and the ledger pins
the new hash. Same shape as `stackctl` clone dispositions: the machine detects
drift, the human dispositions it, the decision is durable rather than re-litigated
on every run.

This makes release readiness honest:

> **Releasable** = all targets fresh + all validations passed + no outstanding
> `needs-review` that is not explicitly waived.

Without the advisory edge, "releasable" would quietly mean "the machine-checkable
parts are fine" — the false-clean that the ledger exists to refuse.

## Asset storage

Expensive derived assets (video, images) and large authored inputs (narration takes,
raw video) live in object storage, not git. Rehashing 40GB of raw video on every
`pc status` is not viable, so the design content-addresses the private store.

**If an asset's key is its hash, the reference and the integrity claim are the same
string.** The freshness algorithm survives untouched — comparison stays a string
diff. `pc status` therefore answers "what is stale?" with **zero network access**:
the common read path cannot be slow, rate-limited, or offline-broken. For an
agent-driven system that is worth a great deal.

Assets get committed pointer files; the bytes live in the bucket:

```yaml
# assets/narration/take-03.wav.asset  -- committed
asset: sha256:abc123...
media: audio/wav
bytes: 402653184
```

`pc asset add <file>` hashes, uploads-if-absent, writes the pointer.
Content-addressing makes re-adding an identical take a no-op and a re-recorded take
a new address: immutability for free, which is what makes provenance trustworthy.

### Two stores, two addressing schemes

| | Private working store | Public distribution store |
|---|---|---|
| Holds | narration takes, raw video, expensive renders | published podcast, video, EPUB |
| Keys | content-addressed (`sha256:abc...`) | semantic + immutable (`port-breton-01/podcast__9f2ab1c.mp3`) |
| Fronted by | direct B2 | Cloudflare CDN |
| Precedent | colony-cults-archive | colony-cults `008-edition-publishing` |

Content addresses are ideal for integrity and dedupe and useless as citable URLs —
nobody puts `sha256:9f2...` in an RSS feed. Published artifacts therefore get
semantic immutable keys with a version token, following the `<issue>__3b8b1fd6.pdf`
scheme `008-edition-publishing` landed on.

**Only the private store is in v0.1.** The public store, CDN keys, rights gating,
and feed semantics are deferred — they deserve their own spec with their own
decisions, exactly as `008` concluded when it deferred the site's export.

### Backend agnosticism

The store is a plain S3 client with a configurable endpoint. S3, R2, B2, and MinIO
all speak the S3 API, so the backend is a config value, not an architectural
commitment. B2 first, per existing precedent; changing later is configuration.

**git-lfs is deliberately not used.** It is backend-agnostic only in principle: with
GitHub-hosted LFS the blobs live on GitHub's storage at GitHub's pricing, and
reaching a private bucket requires either a self-hosted LFS server (`lfs.url`) or a
custom transfer agent (`lfs.standalonetransferagent`). Both are client-side config
that every clone, CI runner, and agent sandbox must install correctly before
`git clone` works — failing before our tooling can produce a decent error.

The structural objection is stronger than the operational one: LFS versions files at
paths in the working tree, so it fits authored inputs only. It has no concept of
derived artifacts (which should not be committed) or of a public distribution store.
It would solve roughly a third of the problem and still require the S3 client for
the rest, leaving two mechanisms, two credential paths, and two mental models for
one job.

**The footgun LFS would have covered.** With `pc asset add` as an explicit step,
someone can drop a take in `assets/` and commit 400MB of raw bytes into git. Per
`enforcement-lives-in-skills`, the guard belongs in the CLI, not a pre-commit hook:
`pc status` fails loud when an authored node points at raw binary with no pointer
beside it.

## The agent surface

Verbs split by exit-code semantics: read-only reporting always exits 0; gates exit
non-zero.

| Verb | Purpose | Exit |
|---|---|---|
| `pc status --json` | every node, its state, and *why* | always 0 |
| `pc next --json` | the actionable frontier | always 0 |
| `pc build <target>` | build **and** record provenance, indivisibly | 1 on failure |
| `pc validate [<target>]` | run validators, record result | 1 on invalid |
| `pc release-check --json` | releasable? what blocks? | 1 if not |
| `pc asset add <file>` | hash, upload-if-absent, write pointer | 2 on usage |
| `pc review <node> --waive --reason "..."` | disposition an advisory drift | 2 on usage |

`pc next` is expected to be the verb in daily use — it reports the frontier rather
than inferring intent:

```
$ pc next
1. narration  needs-review  spoken changed since take-03 was recorded
2. podcast    stale         voiceover rebuilt
3. epub       unvalidated
```

Every line states the node, its state, and why. The "why" is not a convenience: a
state without a cause makes an agent guess, and guessing is what the ledger exists to
eliminate.

Per the no-fallbacks rule: a missing provider or unresolvable asset throws, naming
what is absent. It never silently skips a target — a skipped target reporting green
is precisely the false-clean the ledger exists to prevent.

## The provider contract

**Providers are subprocesses speaking JSON over stdio, not in-process plugins.**

videocontrol is TypeScript, but audio tooling is realistically ffmpeg and sox. A
Node plugin API would quietly require every craft tool to become a Node module,
breaking *"specialized systems remain independently useful"* on contact with the
first ffmpeg invocation.

The sequence:

1. production-control **resolves inputs to local paths** (from cache or store).
2. It invokes the provider with a JSON request on stdin: resolved input paths, their
   hashes, an output directory.
3. The provider writes files and returns JSON on stdout: outputs, plus an optional
   validation report. Non-zero exit means failure; stderr is diagnostics.
4. production-control hashes the outputs, ingests them, and writes the ledger — in
   one act.

Step 1 is the point: **providers never touch object storage and never hold
credentials.** They take local files and emit local files. Every provider stays
trivially runnable by hand, testable without a bucket, and useful outside
production-control entirely. All store complexity stays on one side of the boundary.

**A provider should be a pure function: inputs in, outputs out.** No hidden state, no
global config, no cache, no storage. production-control provides the world; the
provider transforms it. That is what makes a provider runnable by hand, testable
without infrastructure, and replaceable without argument.

**Purity is a norm, not an invariant — and the exception must be declared.** Some
providers cannot be pure. A synthesized narration calls a model; an Astro build may
fetch a remote font. Such a provider cannot promise the same bytes twice, and
pretending otherwise would make "deterministic production" a claim nobody checks.

The ledger is what contains the damage. It records the output hash that was actually
produced, so everything downstream of an impure provider remains deterministic even
though the provider is not: the podcast is built from *these* narration bytes, whose
hash is recorded, whoever or whatever made them. An impure provider must declare
itself, so the boundary of what is reproducible is visible rather than assumed.

## Testing

Fixture episodes with tiny synthetic assets. A fake provider that echoes
deterministic bytes, so the graph and staleness logic are testable with no ffmpeg
and no bucket. The freshness algorithm is exercised entirely in-memory. The store
adapter is tested against a local S3-compatible server.

## Scope

**In v0.1**: episode manifest, profiles, artifact graph, content-hash freshness,
advisory edges + `needs-review`, validation state, release-check, private
content-addressed store, provider contract, the agent CLI surface.

**Targets**: website, EPUB, voiceover, podcast. Editorial + audio — two genuinely
different crafts, which forces the timed-transcript contract that video will later
need, without coupling v0.1 to videocontrol's maturity.

**Deferred, deliberately**:

- **Video / vlog.** Slots in against contracts already proven by audio.
- **Public distribution store, CDN, rights gating, RSS.** Own spec.
- **Provider sandboxing.** Not enforcing that providers touch only declared inputs.
  An undeclared input surfaces as a build that will not reproduce — a bug findable
  later, not a foundation that must be laid now.
- **PDF, hardcover, print.** Additional targets, not architecture.

## Open questions

**The timed transcript schema is not settled.** It is named in the vision as a
first-class artifact and is the keystone coupling audio to video. v0.1 forces its
existence by including both crafts, but its shape should be pinned during
implementation, when contact with real audio tooling can inform it rather than
guesswork.

**How an impure provider declares itself is not specified.** The provider contract
requires the declaration (see *The provider contract*); the mechanism — a field in
the provider's JSON response, a profile attribute, or both — is left to the spec.

**Validation severity is undefined.** `validation: { state: passed }` records a
binary. Whether a validator can report a warning that does not block release, and how
that interacts with `release-check`, is unresolved.

## Provenance

**Originating document**: the operator's vision and architectural direction proposal
for Production Control ("A Proposal for an Agent-Native Multimedia Production
System"), which established the philosophy, the orchestration boundary, the canonical
inputs, and the initial vertical slice. That document explicitly deferred the tactical
layer to a successor — *"Episode Production Contract v0.1"* — which is this record.

**Governing document**: [MANIFESTO.md](../../../MANIFESTO.md) and the constitution
derived from it at `.specify/memory/constitution.md`. Where this design and the
manifesto disagree, the manifesto wins.

**Prior art consulted**: `colony-cults` (`specs/008-edition-publishing`) for the
immutable-versioned-artifact and pinned-snapshot publishing precedent, and
`colony-cults-archive` for the Cloudflare-fronted B2 store precedent. Both informed
the two-store split; neither is a dependency — the domains are distinct.

**Operator decisions recorded in session**: production-control is a separate domain
from colony-cults, not an orchestrator above it; the first slice is editorial + audio,
not all five outputs; content lives in per-subject repos that depend on this package,
never in this repository; v0.1 stops at releasable rather than published.

**Corrections applied in session**: the orchestration layer must not know where
narration comes from (it needs an audio file, not a provenance story) — this produced
the authored/derived split. Port Breton is the first of many subjects, not the domain
— this produced the subject-agnostic boundary.

**Review**: revised against third-party review, which contributed the identity
section, the oracle-authoritative/providers-disposable invariant, the pure-function
framing for providers (adopted as a norm, not an invariant), and the
declarative-consistency-check reframing of freshness. Approved by the operator.

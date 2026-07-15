# Episode Production Contract v0.1 — Design

**Roadmap item**: `design:feature/episode-production-contract`

**Status**: Approved (design); implementation plan pending

## Purpose

Define what an episode directory *is*, what artifacts a production yields, and the
contract between production-control and the specialized craft tools that do the
actual media work.

This is the tactical successor to the vision document. The vision states the
philosophy; this states the shape of the bytes on disk.

## Context and boundaries

production-control coordinates the production of multimedia publications from
human-authored source materials. It is an orchestration layer. It does not write,
edit, render, or master anything.

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

## Approach: oracle first, providers second

The design separates the novel part from the commodity part.

Executing a DAG of commands is solved (make, turbo, nx). Modeling an artifact graph
with provenance and freshness — answering *"the podcast is stale because the script
moved after the narration was cut"* — is not, because no general tool knows what an
episode is. The vision's own constitution says grow by supporting targets, not by
expanding intelligence. Rebuilding a build engine would violate that.

So: **the graph is the core; execution is a deliberately dumb layer on top.**

- **Milestone 1 — oracle.** Manifests, the artifact graph, content-hash freshness,
  validation state, release readiness. Reports; executes nothing. Useful against
  half-authored content on day one.
- **Milestone 2 — providers.** `pc build <target>` shells out to craft tools and
  records provenance from the result. Strictly additive.

Milestone 2 is a superset of milestone 1, so the sequence de-risks the novel part
before spending anything on the commodity part. If execution is never built, the
oracle still earns its keep.

Rejected: a full orchestrator with scheduling, caching, parallelism, and remote
execution. That is rebuilding Bazel to solve a problem nobody has yet.

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

The ledger records, per derived artifact, what it was built from — as content hashes
captured at build time. It is **committed**; `dist/` is not. Provenance *is* the
product, so a fresh clone can answer "what is stale?" without rebuilding anything,
while the heavy bytes stay out of git.

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

**The algorithm is a comparison, not a computation.** Rehash each declared input,
diff against what the ledger recorded. Differ means stale.

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

## Open question

The **timed transcript** is named in the vision as a first-class artifact and is the
keystone coupling audio to video. v0.1 forces its existence by including both
crafts, but its schema is not settled here. It should be pinned during
implementation, when contact with real audio tooling can inform it.

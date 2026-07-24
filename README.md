# production-control

An agent-native orchestration system for multimedia production.

production-control coordinates the production of publications — website, ebook,
podcast, audiobook, video — from a common set of human-authored source materials.
It manages production state, artifact relationships, dependencies, provenance, and
release readiness, while remaining deliberately ignorant of the creative work
itself.

**It does not write, edit, render, or master anything.** It delegates that work to
specialized craft tools and reasons about the result. See [MANIFESTO.md](MANIFESTO.md)
for the intent and principles that govern the project — including what it refuses to
do, and why those refusals are load-bearing.

## Status

**Milestone 1 (the oracle) is implemented and tested. Most of Milestone 2 (the execution
layer) is too.**

Working today, offline, and covered by the test suite:

- `pc status`, `pc next`, `pc explain`, and `pc release-check` — the read verbs, exercised
  against fixture episodes with no craft tool installed and no network reachable.
- `pc build`, `pc validate`, and `pc review --waive` — building and recording provenance as
  one act, recording a validation verdict, and recording a human's waiver.
- `pc asset add` — content-addressed large-asset storage, with the S3-compatible adapter
  tested against a real MinIO server (via `testcontainers`), not a mock.

Not built, and out of scope for this version by design (see spec.md § Out of Scope):
video production, publishing and distribution, and scheduling. This is stated plainly
rather than as a roadmap promise — see [ROADMAP.md](ROADMAP.md) for the governed work
graph, and
[the Episode Production Contract design](docs/superpowers/specs/2026-07-14-episode-production-contract-design.md)
and [spec.md](specs/001-episode-production-contract/spec.md) for the design record and
current specification.

## The idea

Every output is an artifact derived from authored inputs. Every artifact records
what it was built from, by which tool, at which content hash. That turns a
production into a graph rather than a pile of files, and makes questions like these
answerable:

- What exists, and what is missing?
- What is stale, and *why* is it stale?
- What has been validated?
- What requires human review?
- What is blocking release?

Freshness is content-addressed, so the answers survive a fresh clone and require no
network access.

## How it fits together

```
                 production-control
                   state
                   dependencies
                   validation
                   provenance
                   release readiness
              |          |          |
              v          v          v
         Editorial     Audio      Video
            craft      craft      craft
```

production-control is the orchestration layer. Craft tools (videocontrol, editorial
tooling, audio tooling) are separate systems that satisfy documented contracts. Any
tool that satisfies a contract can participate; each stays independently useful on
its own.

## How it is used

production-control is an installable library, not a monorepo of content. Each
subject gets its own content repo that depends on it — the way a site depends on a
build tool. The tool never contains anyone's prose.

An episode directory declares its authored inputs, names a profile, and lists its
targets:

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
    follows: spoken

targets: [website, epub, voiceover, podcast]
```

A *profile* is the generic recipe binding targets to providers. Profiles are where
reuse across subjects lives; the episode holds only what is specific to it.

## Usage

The full contract for the command surface is
[specs/001-episode-production-contract/contracts/cli.md](specs/001-episode-production-contract/contracts/cli.md);
this is the short version an agent needs to branch correctly, not a restatement of it.

`--json` is the primary interface; human-readable text is the convenience layer over it.
Every verb takes `--episode <dir>` (defaults to the current directory). The exit code is
the contract:

| Class | Verbs | Exit |
|---|---|---|
| **Read** | `status`, `next`, `explain <node>` | Always **0** — even when reporting problems |
| **Gate** | `validate`, `release-check` | **0** if clean, **1** if not |
| **Act** | `build <target>`, `asset add <file>`, `review <node> --waive --reason` | **0** on success, **1** on failure |
| **Any** | — | **2** on a usage error (bad flag, missing argument) |

A read verb reporting "everything is broken" has *succeeded* — it answered the
question. Only a gate or an act ever reports failure via its exit code.

```
$ pc status --episode examples/minimal-podcast
outline    present       Authored node "outline" resolves, and it follows nothing.
spoken     present       Authored node "spoken" resolves, and it follows nothing.
narration  needs-review  Authored node "narration" follows "spoken", and no review …
voiceover  missing       "voiceover" has no record in the ledger: it has never been built.
podcast    blocked       Input "voiceover" of "podcast" is absent …
$ echo $?
0
```

(`examples/minimal-podcast` — see its own README — has never been built, so `voiceover`
and `podcast` have something to say; `narration`'s cause is truncated above for width.)

### How a provider participates

A provider is any external program that turns local input files into local output
files and reports what it produced — a subprocess speaking JSON over stdio, never an
in-process plugin. `pc build` resolves every declared input to a local path, spawns the
provider named in the profile, hashes what it produced itself (never trusting the
provider's own word for it), and records the result — inputs, tool, version, and
output hash — as part of the same action that ran the build. Any tool that satisfies
the contract can be bound to a target, swapped for another, or run by hand outside
production-control entirely with no credentials and no orchestrator present. The full
contract, including the exact request/response shapes and the failure rules a provider
must be held to, is
[specs/001-episode-production-contract/contracts/provider.md](specs/001-episode-production-contract/contracts/provider.md).

## Repository structure

```
docs/         design records and contract documentation
contracts/    the documented interfaces craft tools satisfy
profiles/     generic production recipes, reusable across subjects
schemas/      manifest and artifact schemas
examples/     fixture episodes (fixtures only -- never real content)
src/          implementation
```

This repository defines contracts, schemas, workflows, and orchestration logic. It
intentionally contains very little media-processing implementation, and should stay
that way.

## Governance

This project is governed by [stack-control](ROADMAP.md). Work is tracked as a
dependency graph of roadmap items; design records precede specs, which precede
implementation.

- `stackctl session-start` — orientation for a fresh session
- `stackctl roadmap next` — the ready frontier
- [DESIGN-INBOX.md](DESIGN-INBOX.md) — out-of-sequence ideas, captured for later triage

## Related projects

- **videocontrol** — video craft: narration alignment, cut lists, rendering, captions
- **colony-cults** — the research archive behind the first subject. A separate
  domain: it publishes facsimiles of primary sources, while production-control
  publishes authored narrative. Their provenance layers resemble each other by
  convergent evolution, not by shared substrate.

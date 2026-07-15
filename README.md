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

**Design phase. Nothing is implemented yet.**

The architecture is settled and recorded; the code does not exist. See
[ROADMAP.md](ROADMAP.md) for the governed work graph, and
[the Episode Production Contract design](docs/superpowers/specs/2026-07-14-episode-production-contract-design.md)
for the current design record.

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

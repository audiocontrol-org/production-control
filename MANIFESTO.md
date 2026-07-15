# Manifesto

## The goal is not to automate storytelling. The goal is to automate everything that comes after storytelling.

A story worth telling takes a human. Everything between a finished story and a
published one — the transcoding, the mastering, the packaging, the checking, the
remembering of what was built from what — takes only patience, and patience is
what machines are for.

production-control exists to do that second part, and to refuse the first.

## Human creativity is the source of truth

The author creates the work. The production system realizes it.

production-control does not write stories, edit prose, improve scripts, or decide
narrative structure. It has no opinion about whether a reveal lands. It cannot tell
you what should happen next, and it must never pretend to.

It answers a different class of question:

- Is every required artifact present?
- Which outputs are stale?
- Which assets are missing?
- Which production steps remain?
- What requires human review?
- Can this be released?

The distinction is not a limitation to be relaxed later. It is the design.

## The compiler analogy

A compiler does not improve your architecture. It faithfully transforms source into
something executable, and its value comes precisely from its refusal to be creative
about it. You would not use a compiler that occasionally rewrote your functions
because it thought of something better.

production-control compiles authored work into publishable media: source materials
in, publication formats out, faithfully, reproducibly, and without editorializing.

## Principles

**Human-authored narrative.** Creative work stays human. This is a boundary, not a
default setting.

**Deterministic production.** The same inputs yield the same outputs. Freshness is
computed from content, not timestamps, because timestamps lie.

**Explicit provenance.** Every generated artifact traces to the authored inputs it
came from, the tool that made it, and the version of each. Provenance is not
metadata about the product. Provenance *is* the product.

**Composable tools.** Specialized systems stay independently useful. If a craft tool
only works when driven by production-control, the boundary has been drawn wrong.

**Stable contracts.** Repositories communicate through documented contracts, never
implementation details. Any tool that satisfies a contract may participate.

**Production over implementation.** The orchestration layer reasons about
productions, not rendering engines.

**Subject-agnostic.** The first subject is not the domain. Nothing in the contracts
may encode anything about any particular story.

## Fail loud; never report false-clean

A system whose purpose is to tell you what is wrong must never tell you that
nothing is wrong by accident.

Missing tools, unresolvable assets, and unimplemented paths raise errors that name
what is absent. There are no fallbacks and no silent skips, because a skipped step
that reports success is worse than a failure — a failure gets fixed, and a false
green gets shipped.

Where the machine cannot decide, it says so and stops. Drift between a script and a
recorded performance of that script is not something to guess about; it is something
to surface to a human, who either fixes it or waives it on the record.

## Agent-driven, human-governed

A human authors the inputs and drives the agent. The agent drives the workflows.

This means recording must never depend on an agent's diligence. Building an artifact
and recording where it came from are one indivisible act, because any step that
*can* be skipped eventually will be, and a ledger that is wrong is worse than no
ledger at all.

## Crafts remain specialized

production-control is not the place where media expertise accumulates.

Editorial remains editorial. Audio remains audio. Video remains video. Publishing
remains publishing. production-control coordinates those crafts through stable
contracts and records the relationships between their outputs.

If a production concern can be solved by improving a specialized tool rather than
expanding the orchestration layer, the specialized tool should change.

## Boring by design

production-control intentionally remains boring.

It will not become an AI author. It will not become a video editor, a DAW, a
graphics application, or a replacement for writing tools.

It grows by supporting more publication targets and production workflows — never by
expanding its own intelligence. Every new medium is a new participant in the
ecosystem, not a change to the philosophy. When a decision could be resolved by
making the system smarter or by making the contract clearer, the contract wins.

## What success looks like

A single set of carefully authored source materials reliably produces many
publication formats — magazine, website, ebook, podcast, audiobook, video, and
whatever comes next — while preserving authorial intent and eliminating repetitive
production work.

The author writes it once. The system realizes it everywhere. Nobody has to remember
what still needs rebuilding.

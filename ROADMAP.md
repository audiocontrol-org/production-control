---
doc-grammar: roadmap
---

# Roadmap

The governed dependency graph of this project's features. Each item is a
heading-keyed unit identified by its `<phase>:<kind>/<slug>` id.

Mutate the graph with `stackctl roadmap` verbs (run `stackctl roadmap --help`
for the full surface): `add` a new item, `advance` its status, `decompose`,
`reclassify`, `defer`, and `cluster` / `group` to gather existing items under a
created-or-reused parent. Example — cluster items under a new epic with a
dependency chain:

    stackctl roadmap cluster multi:feature/epic --children design:feature/a,impl:feature/b --chain --apply

For an edit that has no verb yet (e.g. moving a `part-of` / `depends-on` edge):
edit this file directly, then run `stackctl roadmap order` to revalidate the
graph (it fails loud on a cycle / dangling ref / duplicate id).

## design:feature/episode-production-contract
- status: shipped
- analyze-clean: yes
- spec: specs/001-episode-production-contract
- design: docs/superpowers/specs/2026-07-14-episode-production-contract-design.md
- design-approved: yes
Episode Production Contract v0.1: episode dir, manifest, ledger, freshness, advisory edges, provider contract, S3-compatible asset store

## impl:feature/governing-documents
- status: planned
README.md + MANIFESTO.md: project intent, boundaries, and the principles that govern what production-control refuses to do

## design:feature/directory-outputs
- status: planned
Ingest directory-valued outputs, not just single files. Ingest currently requires a file output (run.ts asserts isFile), so a target whose provider produces a directory — a static-site generator, an unpacked bundle — cannot be built or hashed (a tree hash exists but the build/validate path is file-only). Blocks a website provider. Promoted from backlog TASK-1; surfaced by the nouvelle-france trial.

## design:feature/episode-scaffolding
- status: planned
An episode-scaffolding verb (`pc init` or equivalent): generate an episode's manifest and a profile skeleton so a consumer does not hand-author episode.yaml. Surfaced by having to hand-write every episode manifest in the nouvelle-france trial.

## design:feature/quote-bank
- status: shipped
- analyze-clean: yes
- spec: specs/002-quote-bank
- design-approved: yes
- design: docs/superpowers/specs/2026-07-22-quote-bank-design.md
A reproducible capability to build a quote bank — verbatim, source-cited, fabrication-checked passages — from a project's primary sources, for any subject. Shape: a quote-mining provider produces the bank as a derived target from the sources; a deterministic quote-fidelity validator gates it (verbatim match against the source, disclosed OCR/cleanup, marked non-adjacent joins, zero fabrication). Grounds downstream drafts (e.g. the script provider) in real period voice rather than paraphrase. Adapts the content team's "build the quote bank first" process; uses none of their outputs. Design must settle what is generic vs per-project (source reading varies by corpus; the mining/validation discipline does not).

## design:feature/asset-bank
- status: planned
- depends-on: design:feature/quote-bank
Generalize the quote bank into a metadata-rich, queryable store of production assets — quotes, images, maps, audio excerpts, timeline events — each carrying per-asset-type provenance that is deterministically checkable (a byte-exact text span, a content-hashed source file, a sample-exact time range, or citation-backing) PLUS editorial metadata (significance, themes) that is impure/LLM-annotated and exists for retrieval. A human or the system can then request assets suitable for a particular beat of an output (a video shot, an ebook chapter). Two layers with different trust models: per-type provenance (mostly deterministic) and an impure editorial-metadata + retrieval layer over it. The quote bank is asset-type #1 and the fully-deterministic corner; this depends on it so the general design is grounded in one working instance rather than guessed from zero. The reusable "impure discovery → deterministic grounding → independent validation" pattern is extracted here, with the second asset type, not in the quote-bank design.

## design:feature/voice-editions
- status: shipped
- analyze-clean: yes
- spec: specs/004-voice-editions
- design-approved: yes
- depends-on: design:feature/content-zone-segregation
- design: docs/superpowers/specs/2026-07-25-voice-editions-design.md
A capability to produce voice-varied editions of a source-locked draft: an explicit voice profile (narrator distance, evidence posture, sentence and paragraph movement, transitions, emotional temperature, quote handling, hard avoids) drives a revision provider that may change narration only, while a deterministic fidelity validator gates the result (verbatim survival of every quoted span, citation-set preservation, no silently dropped source-backed claim, ledger completeness). Same impure-generation plus deterministic-grounding shape as the quote bank, applied to derived prose rather than extracted spans. Design must settle what is generic (profile schema, fidelity gate, edition-as-derived-target build shape, per-unit revision ledgers as provenance, and whether a profile is a producer input or a target of its own) versus per-project (the profiles themselves and the source contract). Surfaced by the nouvelle-france spike/codex-authorship trial, where the method held at n=1 but every invariant was enforced by prose rather than code and the driving skills lived outside the repo.

## design:feature/content-zone-segregation
- status: shipped
- analyze-clean: yes
- spec: specs/003-content-zone-segregation
- design-approved: yes
- design: docs/superpowers/specs/2026-07-25-content-zone-segregation-design.md
Enforce strict segregation between human-authored, mechanically-generated, and AI-generated content by directory-naming convention, so the three never blur. The load-bearing invariant: impure-provider (AI) output may never be written to a human-safe path. Zoning is decided by directory name (any-dot-wins): a path is AI-permitted iff at least one of its directory segments is dot-prefixed; a path with no dot segment is human-safe and must never receive impure output. dist/ stays the build root, but impure artifacts must land in a dot-prefixed subdirectory under it (dist/.ai/...); pure/mechanical output may sit anywhere, including human-safe areas (a generated README, a YAML). Enforced defense-in-depth: production-control routes impure output to a dot-zoned location and refuses at build if an impure output resolves to a dot-free path (beside run.ts's existing path-safety refusal), plus a standalone audit verb that catches violations before a build. Supersedes the earlier "artifact-adoption" framing: rather than a verb to bless a human edit of an AI artifact after the fact, the collision is prevented — an AI draft is never hand-edited in place; a human who wants to work on prose authors a separate document in a human-safe area (the manifest's existing `follows` advisory edge models "is a response to"). Surfaced while designing design:feature/voice-editions; blocks it, because a voice edition is prose and the editorial workflow must not be able to land AI bytes in a human's working area.

## design:feature/voice-producer-protocol
- status: shipped
- analyze-clean: yes
- spec: specs/005-voice-producer-protocol
- design-approved: yes
- design: docs/superpowers/specs/2026-07-27-voice-producer-protocol-design.md
- depends-on: design:feature/voice-editions
Real voice-revise producer protocol (model declares index mapping, provider builds hash-keyed ledger; TASK-29) + [PB-###] citation extraction and sources-as-allowlist

## design:feature/voice-compose-from-spine
- status: planned
- design: docs/superpowers/specs/2026-07-28-voice-compose-from-spine-design.md
- depends-on: design:feature/voice-producer-protocol
- spawns: TASK-51
Formalize compose mode: expand a source-cited spine (structured beats) into a full narrative chapter, reusing the whole producer-protocol + fidelity machinery unchanged because the spine is itself a source-cited document. Make mode a first-class request/target field (not the prototype's VOICE_REVISE_MODE env var); have buildEdition defensively reject any unit declared verbatim in compose mode (expansion is never copying, which also eliminates the verbatim-drift failure class); spec the spine-fidelity discipline (no invention, every asserted fact carried, claims-as-assertions, open-questions preserved) with tests; fold in TASK-50 (voice-revise verbatim-drift). Prototyped env-gated on the spike branch and empirically fidelity-passed on Ep1 (10 numerals + 3 citations preserved, no verbatim-drift). Design must settle what is generic (mode field, compose fidelity contract, defensive verbatim rejection) vs per-project (the spine documents themselves).
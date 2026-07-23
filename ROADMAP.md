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
- status: in-flight
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
- status: planned
A reproducible capability to build a quote bank — verbatim, source-cited, fabrication-checked passages — from a project's primary sources, for any subject. Shape: a quote-mining provider produces the bank as a derived target from the sources; a deterministic quote-fidelity validator gates it (verbatim match against the source, disclosed OCR/cleanup, marked non-adjacent joins, zero fabrication). Grounds downstream drafts (e.g. the script provider) in real period voice rather than paraphrase. Adapts the content team's "build the quote bank first" process; uses none of their outputs. Design must settle what is generic vs per-project (source reading varies by corpus; the mining/validation discipline does not).
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
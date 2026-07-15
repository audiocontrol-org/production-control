# Implementation Plan: Episode Production Contract v0.1

**Branch**: `001-episode-production-contract` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-episode-production-contract/spec.md`

**Design record**: `docs/superpowers/specs/2026-07-14-episode-production-contract-design.md` (operator-approved; authoritative for mechanism)

## Summary

Build the orchestration core of production-control: an **oracle** that answers what is true
about a production — what exists, what is stale and why, what needs human review, what
blocks release — and a deliberately dumb **execution layer** that builds artifacts and
records their provenance as one indivisible act.

The approach is sequenced by risk. Modeling an artifact graph with provenance and freshness
is the novel part; executing a DAG of commands is commodity. So Milestone 1 delivers the
oracle alone — reports only, no execution, no network — and Milestone 2 adds providers as a
strictly additive layer. Milestone 2 is a superset of Milestone 1, so the sequence de-risks
the novel part before spending anything on the commodity part.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20+

**Primary Dependencies**: `commander` (CLI), `zod` (boundary validation), `yaml`,
`@aws-sdk/client-s3` (S3-compatible store) — all following house precedent, see [research.md](./research.md) R1

**Storage**: Local filesystem for the episode and ledger; an S3-compatible object store for
large assets, content-addressed, endpoint configurable (B2 first; R2/S3/MinIO by config)

**Testing**: `vitest`. In-memory store double for all graph/freshness/CLI tests; a real
MinIO via testcontainers for the S3 adapter contract test only

**Target Platform**: Node CLI + library, distributed as an installable package

**Project Type**: Single project — library with a CLI surface

**Performance Goals**: `pc status` performs zero network I/O and requires no craft tools;
its cost is bounded by hashing declared inputs. No throughput target — a production has
tens of nodes, not thousands, and inventing a number here would be false precision.

**Constraints**: Reporting state must work offline, in a fresh clone, with no craft tools
installed, and must never mutate the episode. Freshness must never read mtime. Files stay
under 500 lines.

**Scale/Scope**: One episode per directory; tens of nodes; two milestones; five targets
(website, epub, voiceover, podcast, transcript)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all seven principles of `.specify/memory/constitution.md` v1.0.0.

| Principle | Verdict | How this plan satisfies it |
|---|---|---|
| **I. Human-Authored Narrative** (NON-NEGOTIABLE) | PASS | Nothing in this plan generates or alters authored content. The system hashes authored inputs and never parses them. Artifact bytes are opaque to the oracle (research R4). |
| **II. Deterministic Production** | PASS | Freshness derives from content hashes only. `built_at` is recorded but is never an input to any decision (research R7). The tree hash is platform- and order-independent by construction (research R3). Impure providers must declare themselves; the ledger records actual output hashes so downstream stays deterministic regardless. |
| **III. Explicit Provenance** | PASS | `pc build` writes the ledger in the same invocation, after hashing outputs, before exiting 0. No `--no-record` flag, no separate `record` verb — the guarantee is the absence of an alternative path (research R8). production-control hashes outputs itself rather than trusting the provider's claim. |
| **IV. Crafts Remain Specialized** | PASS | No media processing anywhere in this plan. Providers are subprocesses; the system never branches on which tool it invokes. The oracle is schema-agnostic about artifact contents, so no craft knowledge leaks in (research R4). |
| **V. Fail Loud, Never False-Clean** | PASS | Every unresolvable tool/asset/path throws naming what is absent. No fallbacks. Mock data appears only in test code, which the principle explicitly scopes out. The skipped S3 integration test announces its skip rather than passing quietly (research R5). Provider silence is treated as failure. |
| **VI. Oracle Authoritative, Providers Disposable** | PASS | Milestone 1 imports no execution or network code — enforced structurally, not by discipline (research R6). The graph, ledger, and contracts encode no tool's behavior. Provider version drift is reported, never auto-staling. |
| **VII. Subject-Agnostic** | PASS | Profiles carry the reusable recipe; nothing subject-specific exists in code, schemas, or profiles. Fixtures are synthetic. No authored content in this repository. |

**Technology constraints**: `@/` imports, composition over inheritance, interface-first,
constructor DI, no `any`/`as`/`@ts-ignore`, files under 500 lines. `zod` at every boundary
is what makes the no-casts rule achievable rather than aspirational (research R2).

**Result: PASS — no violations, Complexity Tracking not required.**

**Post-Phase-1 re-check: PASS.** The Phase 1 artifacts introduced no new violation. The
`AssetStore` interface (R5) and the M1/M2 import boundary (R6) strengthen Principles VI and
V respectively rather than straining them.

## Project Structure

### Documentation (this feature)

```text
specs/001-episode-production-contract/
├── plan.md              # This file
├── spec.md              # Requirements
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── provider.md      # The stdio/JSON producing-tool contract
│   └── cli.md           # The agent-facing command surface
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── manifest/            # episode.yaml + profiles/*.yaml parsing (zod at the boundary)
│   ├── schema.ts
│   └── load.ts
├── graph/               # identities, nodes, edges, cycle + reference validation
│   ├── build.ts
│   └── validate.ts
├── hash/                # content hashing; deterministic tree hash
│   ├── content.ts
│   └── tree.ts
├── ledger/              # read/write .production/ledger.yaml; waivers
│   ├── schema.ts
│   └── store.ts
├── state/               # THE ORACLE: freshness, states, causes, frontier, release-check
│   ├── freshness.ts
│   ├── resolve.ts
│   └── release.ts
├── assets/              # AssetStore interface; pointer files; local cache
│   ├── store.ts         # interface + in-memory impl
│   ├── s3.ts            # @aws-sdk/client-s3 adapter (M2)
│   └── pointer.ts
├── providers/           # M2 ONLY: subprocess + JSON stdio runner
│   ├── contract.ts      # zod schemas for BuildRequest/BuildResponse
│   └── run.ts
├── cli/                 # commander wiring; --json rendering; exit codes
│   └── ...
└── index.ts             # public library surface

tests/
├── unit/                # hashing, schema parsing, graph validation
├── integration/         # fixture episodes end-to-end via the CLI
├── contract/            # provider contract conformance; S3 adapter vs MinIO
└── fixtures/            # synthetic episodes (see data-model.md)

profiles/
└── editorial-audio.yaml # the v0.1 recipe

examples/                # fixture episodes only — never real content
```

**Structure Decision**: Single project, library-with-CLI. `src/state/` is the oracle and is
the center of gravity; `src/providers/` is the disposable execution layer and does not exist
until Milestone 2. The directory split mirrors the milestone boundary so that Principle VI
holds by construction — `src/state/` importing `src/providers/` would be visible in review
as an architectural violation rather than hiding as a stray import.

## Milestones

Non-temporal. Milestone 2 is a strict superset of Milestone 1.

### Milestone 1 — The oracle (reports only, executes nothing)

Delivers **User Story 1** completely and is independently valuable against a half-authored
production that has never been built.

- Manifest + profile parsing, with refusals for every malformed case
- Graph construction; cycle, duplicate-identity, dangling-reference detection
- Content hashing + deterministic tree hash
- Ledger read
- Freshness as a consistency check; all six states; every state carries its cause
- `pc status`, `pc next`, `pc release-check` — zero network, no craft tools
- Advisory edges + `needs-review` (**User Story 3**'s detection half)
- Asset pointer *reading* (the hash is in the pointer, so status needs no store)

### Milestone 2 — Providers (execution, strictly additive)

Delivers **User Stories 2, 4, 5**.

- Provider runner: subprocess + JSON stdio, per [contracts/provider.md](./contracts/provider.md)
- `pc build` with indivisible ledger recording
- `pc validate`
- Input resolution: store → local cache → local path
- `AssetStore` S3 adapter + `pc asset add`
- `pc review --waive` (**User Story 3**'s resolution half)

## Complexity Tracking

> Not required — Constitution Check passed with no violations.

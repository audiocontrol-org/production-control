# Implementation Plan: Content zone segregation

**Branch**: `feature/voice` (long-lived; spec resolved via the CLAUDE.md SPECKIT marker) | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-content-zone-segregation/spec.md`

## Summary

Enforce strict, human-legible segregation between human-authored, mechanically-generated, and
AI-generated content by directory-naming convention (any-dot-wins), so a person reads a file's
zone from its path alone and impure (AI) output can never occupy a human-safe path. The primary
requirement is INV-1/INV-3: impure output MUST resolve to an AI-permitted (dot-zoned) path and
authored content MUST resolve to a human-safe path, with the path (human channel) and the graph's
impurity flag (machine channel) never diverging.

**Technical approach.** production-control already routes output by impurity — `build.ts` chooses
the output root *after* the response (`impurityOf(decl, response)`), sending impure output to a
top-level `ai-generated/` directory and pure output to `dist/`. This feature: (1) adds a **pure
path classifier** (`src/zoning/`) implementing the normative any-dot-wins rule; (2) **renames** the
impure root `ai-generated/` → a dot-zoned top-level **`.ai/`** sibling of `dist/`; (3) adds
**build-time enforcement** in the ordered path pipeline (`src/providers/run.ts` / `build.ts`) —
resolve → reject escape → confirm real-path containment → evaluate zoning → stage — including
real-path (symlink) resolution; (4) makes a **pure declaration returning impure** a named refusal
(`impurityOf`); (5) adds the **authored-direction** check (authored nodes must be human-safe); and
(6) adds a read-only **routing audit** CLI verb. No new node kind; no graph change.

## Technical Context

**Language/Version**: TypeScript (strict), run via `tsx`; ESM with the `@/` import alias.

**Primary Dependencies**: `zod` (schemas), Node `fs`/`path` (incl. `fs.realpath` for D5c); no new runtime dependency.

**Storage**: Local filesystem for build outputs (`dist/`, the new `.ai/`); the content-addressed object store is unaffected.

**Testing**: `vitest` (`npm test`), `tsc --noEmit` (`npm run typecheck`). In-memory graph/classifier tests with a fake provider emitting deterministic bytes — no bucket, no craft tools (Constitution: Test-Driven).

**Target Platform**: Node (library + CLI), cross-platform (posix path semantics normalized as the codebase already does).

**Project Type**: Single TypeScript package (library + `pc` CLI).

**Performance Goals**: Classification is O(path segments), negligible; no build-throughput regression. One extra `realpath` per declared output at build time (bounded, already touching the filesystem).

**Constraints**: Files < 500 lines; no `any`/`as`/`@ts-ignore`; composition over inheritance; every refusal names its cause; read verbs `--json` + exit 0, gates exit non-zero.

**Scale/Scope**: One new small module (`src/zoning/`), one new CLI verb, and edits to `run.ts`/`build.ts`/`invoke.ts` plus a graph-level authored-zone check. Fixture/quickstart migration for the `ai-generated/` → `.ai/` rename.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Assessment |
| --- | --- |
| I. Human-Authored Narrative | **Reinforces it.** The feature exists to keep AI output out of human authoring areas; it produces no authored content. |
| II. Deterministic Production | Zoning is a pure, deterministic function of the path. No timestamps. |
| III. Explicit Provenance | Uses the existing impurity provenance (no new field); keeps the human-readable name in agreement with it (INV-3). |
| IV. Crafts Remain Specialized | No craft logic added to the orchestrator; providers unchanged in contract. |
| V. Fail Loud, Never False-Clean | Every violation (zoning, escape, contradictory impurity) is a named refusal; the audit reports its own scope honestly; no fallback masks a violation. |
| VI. The Oracle Is Authoritative | **No new node kind, no graph change** (FR-018); enforcement sits in routing/build and a read-only verb. |
| VII. Subject-Agnostic | No subject named anywhere; the rule is purely structural. |

**Result: PASS.** No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-content-zone-segregation/
├── plan.md              # this file
├── research.md          # Phase 0 — decisions, incl. the real-routing correction
├── data-model.md        # Phase 1 — Zone, classifier contract, routing decision
├── quickstart.md        # Phase 1 — runnable validation scenarios
├── contracts/
│   ├── zone-classifier.md   # the pure classification function contract
│   └── audit-verb.md        # the `pc` routing-audit CLI contract
├── checklists/
│   └── requirements.md  # spec quality checklist (done)
└── tasks.md             # Phase 2 — /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
src/
├── zoning/                     # NEW — the pure classifier + routing helper
│   ├── classify.ts             #   classifyZone(relPath, productionRoot) → 'human-safe' | 'ai-permitted'
│   └── route.ts                #   impure→.ai/ , authored→human-safe root selection
├── providers/
│   ├── run.ts                  # EDIT — resolve→escape→realpath containment→zoning→stage (FR-009/010/011)
│   ├── build.ts                # EDIT — rename impure root 'ai-generated'→'.ai'; wire zoning refusal
│   └── invoke.ts               # EDIT — pure-declared-returns-impure → named refusal (FR-012)
├── graph/
│   └── validate.ts             # EDIT — authored node MUST resolve to a human-safe path (FR-006/D2b)
└── cli/
    ├── audit-zones.ts          # NEW — read-only routing audit verb (FR-013..015)
    └── index.ts                # EDIT — register the audit verb

tests/
├── unit/zoning/                # NEW — classifier golden cases (basename, above-root, .cache=.ai, symlink policy)
├── unit/…                      # build/invoke refusal unit tests
└── integration/                # NEW — end-to-end build refusals + audit, fake deterministic provider
```

**Structure Decision**: Single-package layout, matching the existing `src/<domain>/` split. Zoning
is its own small domain module (`src/zoning/`) because the classifier is pure and reused by both the
build path and the audit verb; keeping it separate keeps `run.ts`/`build.ts` edits minimal and the
rule independently testable (in-memory, no filesystem needed for classification).

## Complexity Tracking

None. The Constitution Check passes with no violations; no entry required.

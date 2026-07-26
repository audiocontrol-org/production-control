# Research: Content zone segregation (Phase 0)

All decisions trace to the approved design record
(`docs/superpowers/specs/2026-07-25-content-zone-segregation-design.md`) and its operator
ratifications. This file records the ones that touch implementation, including a correction
discovered by reading the build path.

## R1 — Existing impurity routing (the correction)

**Decision**: Build on the routing that already exists rather than introduce it.

**Finding**: `src/providers/build.ts:112` selects the output root **after** the provider responds —
`const outputRoot = impurityOf(decl, response) !== undefined ? 'ai-generated' : 'dist'` — and
`stage()` (build.ts:195+) writes impure output to `<episodeDir>/ai-generated/<relPath>`, pure to
`<episodeDir>/dist/<relPath>`. `impurityOf` is `response.impure ?? decl.impure` (build.ts:285).

**Consequences**:
- The **false-safe path** the design's earlier D2a described (impure bytes reaching a human area
  because routing used a static pure declaration) **does not exist** — routing is post-response.
- `ai-generated/` is **not** dot-prefixed, so under this feature's own any-dot-wins rule it would
  classify as *human-safe* — the current impure root would violate the invariant being added.

**Rationale**: Verified directly in code; corrected the design record (D2a, D3) and spec (FR-007,
FR-008, FR-012, SC-004) accordingly.

**Alternatives considered**: Treating routing as greenfield (rejected — duplicates existing logic and
would leave `ai-generated/` non-compliant).

## R2 — Impure root location: `.ai/` sibling of `dist/`

**Decision** (operator, 2026-07-25): Rename the existing impure root `ai-generated/` → a top-level
**`.ai/`** sibling of `dist/`. Pure output stays in `dist/`.

**Rationale**: Minimal, one-token routing change (`build.ts:112`, and the `stage()` comment/guard);
keeps the existing sibling structure and per-target subpath; any-dot-wins compliant; human-legible.

**Alternatives considered**: Move impure under `dist/.ai/` (rejected — larger migration, mixes both
zones in one tree for no gain); rename `dist/` itself to a dot-name (rejected earlier — churns pure
output and every fixture for no benefit).

## R3 — Zoning rule (pure classifier)

**Decision**: `classifyZone(relPathToProductionRoot)` → `'ai-permitted'` iff at least one **parent
directory** segment begins with `.`; else `'human-safe'`. Total, config-free, evaluated only on
segments at/below the production root; basename excluded.

**Rationale**: Directly the normative rule (design D1/D1a); pure and independently testable in-memory.

**Alternatives considered**: declared human-safe name list (rejected — not fail-safe, needs upkeep);
`.ai`-specific zoning (rejected — operator chose any-dot-wins; `.cache`/`.tmp`/`.ai` treated alike).

## R4 — Enforcement ordering and real-path resolution

**Decision**: In the output pipeline, per declared output: (a) resolve; (b) reject traversal/escape;
(c) confirm the **`fs.realpath`-resolved** destination is contained within the assigned output dir;
(d) evaluate zoning on that resolved destination; (e) stage. `src/providers/run.ts:229` is lexical
today (`path.resolve` only); real-path resolution is added so a symlink cannot satisfy a name-only
check (design D5c, FR-010).

**Rationale**: Zoning must never be the sole defense against escape (a general contract violation,
impure or not, caught at b/c); and a lexical check is defeated by a symlink whose real target is
human-safe.

**Alternatives considered**: zoning-only defense (rejected — leaves escape and symlink holes);
resolving only when a symlink is present (rejected — resolve unconditionally is simpler and correct).

## R5 — Pure-declared-returns-impure → refuse (fail-loud, not false-safe)

**Decision**: A provider **declared pure** that returns an impure `BuildResponse` MUST be refused,
naming the target. `impurityOf` currently coalesces (`response.impure ?? decl.impure`) and silently
reclassifies; this becomes a named refusal.

**Rationale**: The bytes already route safely to the AI zone (R1), so this is **not** a false-safe
closure; it is contradictory provenance metadata that Principle V says must fail loud rather than be
silently reconciled. Operator-ratified 2026-07-25.

**Alternatives considered**: keep the lenient reclassify (rejected by operator — silent
reclassification of contradictory metadata sits badly with fail-loud).

## R6 — Authored-direction check (D2b)

**Decision**: An authored node whose declared path resolves into an AI-permitted (dot-zoned) path MUST
be refused (INV-1/INV-3, authored direction). This is a graph/manifest-level validation
(`src/graph/validate.ts`), evaluated on authored declarations.

**Rationale**: Completes bidirectional agreement; operator-ratified (D2b). Pure-derived remains free
to sit in either zone.

**Alternatives considered**: one-way rule (impure-only) — rejected by operator as insufficient for
strict three-class segregation.

## R7 — Audit verb is a routing audit

**Decision**: A new read-only `pc` verb audits **routing policy** over the manifest/graph: every impure
target would route to a dot-zone, every authored node is human-safe. It exits 0 clean / non-zero on a
violation, offers `--json`, and states in every run that runtime filenames and provider escape are
verified only at build time.

**Rationale**: Output filenames are provider-reported at build time (not statically declarable), so a
pre-build audit can only check routing policy; honesty about scope is required (design D5.4/OQ3,
Principle V). The build-time refusal remains the integrity boundary.

**Alternatives considered**: a stronger static artifact audit (rejected — cannot know runtime paths).

## R8 — Directory-valued outputs

**Decision**: A directory-valued impure output is classified from its **root path**; all contained
files inherit the zone. Full directory-output mechanics are `design:feature/directory-outputs` and out
of scope here; the classifier is written to accept a root path so it composes when that lands.

## R9 — TASK-15 boundary

**Decision**: This feature does not protect the bytes of an in-place edit to an impure artifact; that
is TASK-15 (a separate safety dependency). Documented as FR-024; no code here addresses it.

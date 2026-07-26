# Tasks: Voice editions

**Input**: Design documents from `specs/004-voice-editions/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUESTED — the Constitution's Fail-Loud/Never-False-Clean gate (Principle V) and the quickstart scenarios are the acceptance surface. Test tasks are included and precede their implementation (RED before GREEN).

**Model-tier tags** (`stack-control-model-tier-v1`): every task carries `[tier:<label>]` beside `[P]`/`[US n]`, resolved by the installation's `tier_map` at `resolve-tiers` time. This installation binds cheapest→`fast` (haiku), mid→`balanced` (sonnet), most-capable→`powerful` (opus).

## Format: `[ID] [P?] [Story] [tier:<label>] Description`
- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: US1/US2/US3 for story-phase tasks only.

## Path conventions
- New craft package (plan decision, tentative name): `voice-tooling/` — a sibling of `editorial-tooling/`, Node runtime, its own `node --import tsx --test` suite (TypeScript sources run directly with no build step, matching the plan and the repo's `tsx` convention) plus repo `vitest` for the production-control integration tests. Package-internal source follows the plan's granular `voice-tooling/src/{schema,units,payload,fidelity,revise}/` layout, specifically so no file nears the 300–500-line ceiling (the `fidelity/` split is the plan's stated ceiling strategy — see plan.md Project Structure). Package tests are `.test.ts` under `voice-tooling/test/`. production-control integration tests: `tests/integration/`. Files ≤300–500 lines; interface-first; `@/` alias within production-control source; no `any`/`as`/`@ts-ignore`; no fallbacks (throw naming what is absent).

## Phase 1: Setup (Shared Infrastructure)
- [ ] T001 [tier:fast] Create the `voice-tooling/` package skeleton — `package.json` (scripts `test: node --import tsx --test`, `typecheck: tsc --noEmit`), `tsconfig.json`, `src/` and `test/` directories, a README stub — mirroring `editorial-tooling/`'s shape (Node, zero production-control imports; Constitution IV). The `tsx` loader is required so the package's TypeScript sources run under `node --test` without a build step.
- [ ] T002 [P] [tier:fast] Create `voice-tooling/test/fixtures/` and a shared test-support module (fixture loader / temp-dir helper) mirroring `editorial-tooling/test` conventions, and confirm the package's `node --import tsx --test` runs.

## Phase 2: Foundational (blocking prerequisites for all stories)
- [ ] T003 [P] [tier:balanced] Write RED unit tests for source-unit derivation covering every D6 rule (UTF-8 refuse-invalid before any unit; strip only a leading `---…---` frontmatter block; no line-ending normalization; separator-line = spaces/tabs after optional CR; units = maximal runs of non-separator lines; fenced-code separator exception; exact-byte content; full 64-hex `sha256`; triple identity with `occurrence_index`) in `voice-tooling/test/source-units.test.ts`. ALSO cover the edition-side FR-011 invariant: applying the SAME algorithm to an edition file strips its leading frontmatter (where the ledger lives) first, so the ledger's own bytes MUST NOT perturb any edition-unit hash — assert that mutating only the frontmatter ledger leaves every edition-unit id unchanged. (contracts + data-model.)
- [ ] T004 [tier:powerful] Implement byte-exact source-unit derivation `deriveUnits(bytes, identity)` in `voice-tooling/src/units/derive.ts` (identity triple assembly in `voice-tooling/src/units/identity.ts`) per D6 — total, deterministic, no I/O, triple identity `(source identity, content_hash, occurrence_index)`. The same function derives BOTH source units and edition units (FR-011); frontmatter is stripped before hashing so the ledger carrier is inert. Make T003 green. (powerful: this is the load-bearing reproducibility core — an independent implementation MUST reproduce identical ids, SC-007.)
- [ ] T005 [P] [tier:balanced] Write RED tests, then implement the carrier-independent coverage-ledger schema + single loader in `voice-tooling/src/schema/ledger.ts` per `contracts/coverage-ledger-schema.md` (version, `source`/`voice` `{identity,hash}`, `coverage[]` of the closed op set, additive extensibility for deferred `function:`/`voice:` fields — D10/D21). Structural validation REFUSES a malformed ledger (unknown unit, duplicate disposition, `cut` with a destination, `merged` with no shared destination, empty `reason`) before any fidelity check (D20).
- [ ] T006 [P] [tier:fast] Write RED tests, then implement the voice-document schema + loader in `voice-tooling/src/schema/voice.ts` per `contracts/voice-document-schema.md` (D17: `version:1` literal — unknown versions refused; required core fields; extra keys permitted; a named-living-author identity REFUSED as a documented refusal, never interpreted).
- [ ] T007 [P] [tier:fast] Define the coverage-report types in `voice-tooling/src/fidelity/report.ts` per data-model (D15: `CheckState` = `passed`/`not-run`/`reported`/`not-checkable`; top-level `verdict` = every APPLICABLE deterministic obligation passed).

**Checkpoint**: Foundation ready — the derivation core, ledger loader, voice schema, and report types exist; user stories can begin.

## Phase 3: User Story 1 — The deterministic `voice fidelity` validator (Priority: P1) 🎯 MVP
**Goal**: an edition produced by ANY means becomes checkable the moment it exists (design D3, validator-first). Independently shippable.
**Independent test**: run `voice fidelity` over fixture editions — a faithful one passes with a coverage report; a tampered one is refused naming the obligation; a thinly-corroborated one passes with a high uncorroborated count.

### Tests (RED first)
- [ ] T008 [P] [US1] [tier:balanced] RED integration test: a faithful fixture edition + ledger + source → `verdict: passed` and a coverage report enumerating each check's state and counts (quickstart S1) in `voice-tooling/test/fidelity-pass.test.ts`. INCLUDE the corroborate-not-infer regression guard: a `represented` entry whose destinations satisfy every payload obligation but sit at an editorially "wrong" location still PASSES — the validator corroborates the DECLARED mapping and never infers a better one (D22). This protects the trust boundary against a future maintainer "improving" the validator into an inferring one.
- [ ] T009 [P] [US1] [tier:balanced] RED integration test: each of a mutated `verbatim` span, a dropped citation, a missing unit disposition, and a `source.hash` mismatch → refused, naming the specific failing obligation, no `passed` verdict (quickstart S2, FR-017/023) in `voice-tooling/test/fidelity-refuse.test.ts`.
- [ ] T010 [P] [US1] [tier:balanced] RED integration test: a valid ledger whose `represented`/`merged` entries mostly yield no extractable payload → `passed` with `uncorroborated_units` reported at a high count, never silently clean (quickstart S3, D12/FR-022) in `voice-tooling/test/fidelity-uncorroborated.test.ts`.

### Implementation (make the above green)
- [ ] T011 [US1] [tier:balanced] Implement the ordered pre-checks in `voice-tooling/src/fidelity/check-source-hash.ts` (`source.hash` match FIRST) and `voice-tooling/src/fidelity/check-ledger-structure.ts` (structural ledger validity, then a source whose own citations fall outside its allow-list refused) — all BEFORE any unit obligation (D13.4/D20/FR-023).
- [ ] T012 [US1] [tier:balanced] Implement unit accounting in `voice-tooling/src/fidelity/check-unit-accounting.ts`: every source unit has EXACTLY one declared disposition; an unaccounted unit is refused naming it (FR-017, SC-001).
- [ ] T013 [US1] [tier:powerful] Implement the closed op obligations in `voice-tooling/src/fidelity/check-op-obligations.ts` — `verbatim` (one destination, byte-equal), `represented` (≥1 destinations, payload survives across their union, no shared destination), `merged` (≥1 destinations, payload survives, ≥1 destination shared with another source entry), `cut` (no destinations, non-empty reason) — with the shared-destination rule that makes `merged` mechanically distinct from `represented` (D8). (powerful: the mechanical-obligation core; adversarial-prone.)
- [ ] T014 [US1] [tier:powerful] Implement unit-local MULTISET payload extraction + matching in `voice-tooling/src/payload/extract.ts` (numeric literals, citation markers, verbatim quoted spans always; declared-lexicon terms when a lexicon input exists, else report `not-run`) and `voice-tooling/src/payload/match.ts` (byte-exact, case-sensitive, no Unicode normalization; each source occurrence discharged by a DISTINCT destination occurrence within that entry's destination union) (D11/D21/FR-019/020/021). (powerful: multiset correctness is the primary false-clean risk.)
- [ ] T015 [US1] [tier:balanced] Implement unit-local multiset citation semantics (in `voice-tooling/src/payload/match.ts`, reusing T014's matcher): every citation occurrence in a non-`cut` source unit appears in that entry's destinations with multiplicity; the edition contains NO citation absent from the source (no fabrication); markers resolve within the frontmatter allow-list; document-level set equality NOT required (D13/FR-023). Also implement the D14 CONDITIONAL (FR-024) in `voice-tooling/src/fidelity/check-payload.ts`: quote-bank identity/transformation semantics apply ONLY when a quote bank is an actual declared input of the target; otherwise the obligation is the exact-block preservation of T014 — a single dialect, never a second quote-fidelity path by accident.
- [ ] T016 [US1] [tier:balanced] Implement the structured coverage-report emission in `voice-tooling/src/fidelity/report.ts`, the ordered-check orchestrator in `voice-tooling/src/fidelity/run.ts`, and the `voice fidelity` CLI entry point `voice-tooling/bin/voice-fidelity.mjs`: report every check state (incl. `not-run`/`not-checkable`); `verdict: passed` only when every applicable obligation passed; a validator that cannot decide exits NON-ZERO with NO verdict — never a false clean (D15/FR-025/030, Principle V, SC-004/006). Emit the contract-conformant response on stdout and the richer coverage report on stderr (plan decision, mirroring quote-bank).
- [ ] T017 [P] [US1] [tier:fast] Document the validator's honest boundary in the package README (no semantic-equivalence, no voice-conformance claim — D4/D16/FR-026).

**Checkpoint**: US1 green — the fidelity validator holds independently of US2/US3; any edition is checkable.

## Phase 4: User Story 2 — The impure `voice revise` provider (Priority: P2)
**Goal**: produce an edition of a source-locked draft, routed to the shipped `.ai/` dot-zone and gated by the validator.
**Independent test**: build a fixture target (source + voice, stubbed model); the provider declares impure, emits a schema-valid frontmatter ledger, the edition lands under `.ai/`, and a validator-rejected edition is refused.

### Tests (RED first)
- [ ] T018 [P] [US2] [tier:balanced] RED integration test in `tests/integration/voice-revise.test.ts`: building a fixture target with a stubbed model produces an edition declaring `impure:{reason}`, carrying a schema-valid frontmatter ledger, routed under the dot-zoned `.ai/` root, and the build REFUSES an edition the fidelity validator rejects (quickstart S4, FR-005/028).

### Implementation
- [ ] T019 [US2] [tier:balanced] Implement the `voice revise` provider across `voice-tooling/src/revise/request.ts` (BuildRequest parsing; resolves source + voice inputs), `voice-tooling/src/revise/model.ts` (spawns the model CLI, mirroring quote-miner's adapter), and `voice-tooling/src/revise/emit.ts` (writes the edition + frontmatter ledger; BuildResponse, impure) + the CLI entry point `voice-tooling/bin/voice-revise.mjs`: declares `impure:{reason}`, consumes source draft + voice (+ optional lexicon / quote-bank inputs), emits the edition with its frontmatter ledger, reports NO validation verdict of its own (D3/FR-005).
- [ ] T020 [US2] [tier:balanced] Wire the provider into a production-control fixture manifest so a build routes the impure edition to the shipped `.ai/` root and the `voice fidelity` validator gates acceptance — reusing the existing provider contract, impurity declaration, and zoning enforcement with NO production-control core change (D1/D19/FR-029). Assert the v1 source-locked constraint (FR-007/D5): a governed target MUST declare EXACTLY ONE source draft — a target declaring zero or more than one source is refused, naming the target.
- [ ] T021 [P] [US2] [tier:fast] Regression test asserting the segregation path holds: an edition whose resolved output is a human-safe (dot-free) path is refused, and `pc audit-zones` reports it pre-build — referencing the SHIPPED content-zone-segregation enforcement (FR-028/029, SC-005).

**Checkpoint**: US2 green — editions are produced, gated, and confined to the dot-zone.

## Phase 5: User Story 3 — Voice as a declared input, with honest freshness (Priority: P3)
**Goal**: voice is a first-class declared input; a human companion lives in a human-safe area; freshness is honest.
**Independent test**: change a voice → dependent editions report stale; change only the model version → drift, not stale; neither auto-rebuilds.

### Tests (RED first) + Implementation
- [ ] T022 [P] [US3] [tier:balanced] RED test then wire: a voice is a first-class declared input (an `authored` node referenced in a target's `inputs`), and a human polish companion authored in a human-safe area `follows` the edition — reusing existing manifest mechanisms; a companion declared under a dot-zone is refused by the shipped authored-direction check (D1/D19/FR-001).
- [ ] T023 [US3] [tier:balanced] RED test then wire: a voice edit RESTALES dependent editions (report only — rebuild stays the operator's call); a producer model-version change is reported as DRIFT, never an auto-restale — reusing existing drift/restale (D18/FR-027).

**Checkpoint**: US3 green — voice-as-input and honest freshness enforced.

## Phase 6: Polish & cross-cutting
- [ ] T024 [P] [tier:fast] Author golden fixtures covering the deferred markdown constructs (setext headings, MDX constructs, HTML blocks, list items with blank lines) against `deriveUnits`, documenting unit-derivation coverage (research R-FIXTURES; the clarified deferral).
- [ ] T025 [tier:fast] Update docs: the `.ai/` machine-artifact lifecycle (edition never hand-edited; companion `follows` in a human-safe area), the two entry points (`voice revise` / `voice fidelity`), the coverage-report semantics, and the v1 honest boundary (no voice-conformance) (FR-016/026/028).
- [ ] T026 [tier:powerful] Full verification gate: repo `npm test` + `voice-tooling` `node --test` green; `npm run typecheck` + `npx eslint` clean; NO file exceeds 500 lines across `voice-tooling/src` and edited production-control files; no `any`/`as`/`@ts-ignore` introduced; every new refusal names its cause (spot-check FR-030 / Principle V). (powerful: whole-suite gate.)

## Dependencies & story completion order
- **Setup (Phase 1)** → **Foundational (Phase 2: derivation core T004 + ledger loader T005 + voice schema T006 + report types T007)** block everything.
- **US1 (P1)** depends only on Foundational. It is the MVP and independently shippable (the validator gates editions from any producer).
- **US2 (P2)** depends on Foundational + US1 (the validator must exist to gate the producer).
- **US3 (P3)** depends on Foundational; independent of US2's build wiring except shared manifest fixtures.
- **Polish (Phase 6)** after the stories.

## Parallel execution examples
- Foundational: T003 (RED derivation tests) ∥ T005 (ledger) ∥ T006 (voice schema) ∥ T007 (report types) — distinct files.
- US1 tests: T008–T010 are all `[P]` (distinct test files) and can be written together before implementation.
- Cross-story: once US1 is green, US2 (T018–T021) and US3 (T022–T023) touch mostly distinct files and can proceed in parallel.

## Implementation strategy
MVP = **US1** (Phases 1–3): the deterministic fidelity validator, so an edition from any producer is checkable — the load-bearing guarantee. US2 adds the governed producer + zoned routing; US3 adds voice-as-input and honest freshness. Deferred scope (blended voices D21, composition mode) is intentionally NOT tasked.

## Tier distribution (sanity)
- `fast`: T001, T002, T006, T007, T017, T021, T024, T025 (scaffolding / schema / docs / small).
- `balanced`: T003, T005, T008, T009, T010, T011, T012, T015, T016, T018, T019, T020, T022, T023 (standard impl/tests).
- `powerful`: T004 (byte-exact reproducibility core), T013 (mechanical op obligations), T014 (multiset false-clean risk), T026 (whole-suite gate).

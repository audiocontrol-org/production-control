## 2026-07-29: <!-- session title -->

**Goal:** <!-- compose: what we set out to do -->

**Accomplished:**
- <!-- compose -->

**Didn't Work:**
- <!-- compose -->

**Course Corrections:**
- <!-- compose -->

**Insights:**
- <!-- compose -->

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 8
  - analyze(voice-compose-from-spine): record analyze-clean marker (spec 006 consistent, 100% FR/SC coverage, no critical findings)
  - tasks(voice-compose-from-spine): author specs/006 tasks.md (30 tasks, tier-tagged, RED-first)
  - plan(voice-compose-from-spine): author specs/006 plan + research + data-model + contracts + quickstart
  - define(voice-compose-from-spine): author specs/006 spec.md + quality checklist
  - design(voice-compose-from-spine): operator approval recorded; advance to in-flight (design gate 7/7)
  - design(voice-compose-from-spine): revise per third-party review
  - design(voice-compose-from-spine): capture compose mode design (TASK-51 + TASK-50)
  - roadmap(voice-compose-from-spine): add design item for TASK-51
- Files changed: 15
- Backlog touched: TASK-50, TASK-51

## 2026-07-27: voice-editions execute → govern-blocked; then a working voice lab on the Nouvelle-France ebook

**Goal:** Take the runnable voice-editions spec through the stack-control front door (analyze → execute → govern), then — at the operator's direction — exercise the shipped capability for real: author a catalog of narration voices and produce fidelity-gated voice editions of the Nouvelle-France ebook, readable on a phone.

**Accomplished:**
- `/speckit-analyze` via the `extend` front door: reconciled plan↔tasks structural drift (the granular `fidelity/` module split that later kept every file under T026's 500-line ceiling).
- Executed all 26 voice-editions tasks via model-sized subagent dispatch (haiku/sonnet/opus per declared tier), fresh subagent per task, durable ledger, commit+push per phase boundary. Delivered US1 (deterministic `voice fidelity` validator), US2 (impure `voice revise` provider + `.ai/` routing + gate), US3 (voice-as-input + honest restale/drift). Package suite 158→200 green.
- Two whole-feature govern rounds (cross-model audit barrage, claude+codex). Round 1: 31 HIGH findings → fixed the correctness subset (9 false-cleans/contract-breaks) + cheap wins, backlogged 15. Round 2 (re-govern): 33 findings → caught 2 fix-INTRODUCED false-cleans, which I then closed invariant-first.
- Voice lab (operator-directed): authored an 8-voice catalog in nouvelle-france `content/voices/`; built the real producer protocol (model declares an index mapping, provider builds the hash-keyed ledger — TASK-29); extended citation extraction for `[PB-###]` markers + `sources:`-as-allowlist. Ran the full epilogue through all 8 voices on a live `claude` model → all 8 passed fidelity (8 quotes, 3 citations, 7 figures preserved byte-exact across 28 units).
- Built a subject-agnostic `voice reader` generator (discover + render + CLI, 247 tests green) and published a mobile artifact reader from it; relocated editions to `productions/ebook/voice-editions/<chapter>/<voice>.md` per the artifact-type convention; created a paired `nouvelle-france-voice` worktree.

**Didn't Work:**
- voice-editions did NOT reach a graduate-eligible govern verdict — REFUSED both rounds; remains `override-eligible`/blocked with 24 backlog items (TASK-19…42: test-quality holes + robustness hardening).
- My round-1 correctness fixes INTRODUCED 2 new false-cleans (verbatim donating multiset supply without consuming → re-opened AUDIT-17; verdict passing on an unclassified failure kind) — classic myopic convergence: fixed the cited example without enumerating adjacent channels. Round 2 caught them.
- The audit-barrage background poller kept being reaped by the harness between turns (govern itself stayed healthy); relaunched repeatedly.

**Course Corrections:**
- Governance is genuinely multi-round; per operator direction, scoped remediation to the correctness subset and backlogged the rest rather than chasing full convergence in-session.
- First artifact was subject-coupled (hardcoded nouvelle-france) — rebuilt as a subject-agnostic craft tool (Constitution VII); the project supplies only data.
- Fixed edition placement twice (root `.ai/` → a fake episode dir → `productions/ebook/voice-editions/`) to match the artifact-type-in-path convention.

**Insights:**
- A language model cannot emit hash-keyed coverage ledgers; the correct producer design is a model↔provider protocol — the model declares an index mapping, the provider derives units and computes the hashes. That is the real shape of TASK-29, not "add a prompt string."
- The fidelity gate earned its keep on real prose: eight voices re-narrated a whole chapter while every quoted primary source, citation, and figure survived byte-exact. Fidelity ≠ prose quality — the gate proves the evidence, not the narration — but the evidence guarantee held.
- Applying the 029 process drivers (channel-enumeration, round-0 self-red-team, invariant-first) is not optional: skipping them in round 1 is exactly what produced the two fix-induced regressions round 2 found.
- Audit-barrage recurs a false-positive class ("fixtures not committed") because lane agents see only the chunked diff and cannot run git — captured as tooling friction.

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 45
  - feat(voice-lab): subject-agnostic voice reader generator (discover + render + CLI)
  - feat(voice-lab): recognize [PB-###] citation markers + derive allow-list from sources: frontmatter (FR-020)
  - feat(voice-lab): real producer protocol — model declares index mapping, provider builds hash-keyed ledger (TASK-29)
  - design(voice-lab): Nouvelle-France voice lab spike plan
  - fix(voice): close fix-introduced false-cleans — verbatim consumes supply, verdict withheld on any unclassified failure, unresolved-dest vs survival, null/array request guard (AUDIT-20260727 03/18/29/28/05)
  - fix(voice): verify declared input hashes; validator refuses (not throws) on bad source/request; real profile commands (AUDIT 12/18/21/07/10)
  - chore(voice): track fixtures .gitattributes disabling EOL normalization (AUDIT-20260726-01)
  - fix(voice): verdict requires full check set; abort is its own blocking state (AUDIT 13/16/14)
  - fix(voice): cross-unit multiset, numeric-in-citation, structured failure kinds, empty-destination guard (AUDIT 17/08/11/23/19)
  - chore(execute): mark T001-T026 complete + ledger T024-T026 (voice-editions implementation complete)
  - chore(voice): whole-suite verification gate — tests/typecheck/eslint green, ceilings + typing verified (T026)
  - docs(voice-tooling): full v1 docs — entry points, .ai lifecycle, coverage-report semantics (T025)
  - test(voice-tooling): golden fixtures pinning deriveUnits behavior on deferred markdown constructs (T024)
  - chore(execute): ledger T022-T023 (voice-editions US3 complete)
  - test(voice): voice-edit restales edition (report-only), model-version change is drift not stale (FR-027/D18) (T023)
  - test(voice): voice as declared input + follows companion accepted, dot-zone authored refused (FR-001) (T022)
  - chore(execute): ledger T018-T021 (voice-editions US2 complete)
  - test(voice): regression — voice edition confined to .ai/, audit-zones reports mis-zoning pre-build (FR-028/029, SC-005) (T021)
  - feat(voice): enforce v1 exactly-one-source-draft, named refusal (FR-007/D5) (T020)
  - feat(voice): impure voice-revise provider + CLI, deterministic test stub model — US2 build green (T019)
  - test(voice): RED US2 voice-revise provider integration — impure, ledger, .ai routing, validator gate (T018)
  - chore(execute): ledger T011-T017 (voice-editions US1 complete, validator green)
  - docs(voice-tooling): validator honest boundary — no semantic/voice conformance in v1 (T017)
  - feat(voice-tooling): fidelity orchestrator (run.ts) + coverage report + voice-fidelity CLI — US1 green (T016)
  - feat(voice-tooling): citation no-fabrication + allow-list + D14 quote-dialect conditional (T015)
  - feat(voice-tooling): per-op mechanical obligations, corroborate-not-infer (T013)
  - feat(voice-tooling): unit-local multiset payload extraction + matching (T014)
  - feat(voice-tooling): unit-accounting check — exactly one disposition per source unit (T012)
  - feat(voice-tooling): fidelity pre-checks -- source-hash, ledger-structure, source citation allow-list (T011)
  - chore(execute): ledger T008-T010 (voice-editions US1 RED tests)
  - test(voice-tooling): RED US1 uncorroborated-but-passing, report-only count (T010)
  - test(voice-tooling): RED US1 refusal cases + no-verdict cannot-decide (T009)
  - test(voice-tooling): RED US1 faithful-edition pass + D22 corroborate-not-infer guard (T008)
  - chore(execute): ledger T005-T007 (voice-editions foundational complete)
  - feat(voice-tooling): coverage-report types + report-assembly helpers (T007)
  - feat(voice-tooling): voice-document schema + loader, documented no-author refusal (T006)
  - feat(voice-tooling): carrier-independent coverage-ledger schema + loader (T005)
  - chore(execute): ledger T003+T004 (voice-editions)
  - feat(voice-tooling): byte-exact source-unit derivation core, D6 (T004)
  - test(voice-tooling): RED source-unit derivation tests, D6 + FR-011 edition invariant (T003)
  - chore(execute): ledger T002 (voice-editions)
  - test(voice-tooling): fixtures dir + shared test-support module (T002)
  - chore(execute): ledger T001 (voice-editions)
  - feat(voice-tooling): scaffold TypeScript package skeleton (T001)
  - analyze(voice-editions): reconcile plan↔tasks structural drift found by speckit-analyze
- Files changed: 107
- Backlog touched: TASK-29

## 2026-07-26: Finish content-zone-segregation (execute → govern → ship) and author the whole voice-editions spec (design → runnable)

**Goal:** Pick up the paused content-zone-segregation execution at its US1 MVP boundary, drive it to a shipped feature, then return to voice-editions (its now-unblocked original driver) and take it through the full stack-control front door to a runnable spec.

**Accomplished:**
- **content-zone-segregation finished and SHIPPED.** Resumed execute from 15/25 → completed US2 (authored-direction refusal + legibility), US3 (`pc audit-zones` routing verb), and polish (T022–T025), each task a fresh subagent at its resolved model, test-first. Cleared two pre-existing blockers (split the oversized `miner-cache.test.mjs`; trimmed `zoning.test.ts` off the exact-500 gate). Whole-feature govern ran **4 rounds** (9→4→2→4 findings): fixed every actionable finding — the fail-open `..` classifier (AUDIT-01/06), cross-model symlinked-output-root + pre-mkdir escapes (AUDIT-03/05, reproduced RED), a transient scratch escape (AUDIT-10), routing coverage (AUDIT-07), the `classifyZone` trailing-slash false-safe closed structurally via a required `file|directory` kind param (AUDIT-14/15), plus honesty/coverage tightenings (02/08/13/17/18/19). Graduated the single-model tail by **documented `--override`** (operator-approved). Integrated a diverged `main` (PRs #3/#5/#6) at ship time, resolved the `miner-cache` double-split, merged **PR #7**, and recorded `status: shipped` on trunk. Suite 488 green.
- **voice-editions spec authored end-to-end and runnable.** Reconciled the design with what shipped (D19's stale `dist/.ai/` → `.ai/` sibling), recorded the operator's `design-approved`, then drove specify → clarify → plan → tasks → analyze: spec 004 (30 FRs, 3 validator-first stories, 7 SCs), 5 open questions resolved to design defaults, plan + Phase 0/1 artifacts (Principle I resolved architecturally — provider outside pc-core), 26 tier-tagged tasks, analyze-clean. Applied a third-party review's 6 valid corrections (declined 1 that was based on a false premise — D22 does exist). `execute-check: runnable`.

**Didn't Work:**
- govern never fully converged to zero: it oscillated 9→4→2→4 into a single-model, non-cross-model, non-live-defect tail (each round red-teamed the prior round's fixes). Resolved by documented override, not by chasing the asymptote.
- The govern chunker dispatched the `zoning.test.ts` chunk with an **empty diff body** every round (AUDIT-09/12) — a stackctl instrumentation defect, unfixable from feature code. Filed upstream (deskwork#532) + local TASK-17.
- The `--status` background poll for govern was externally killed ~3× mid-run and needed manual restarts.

**Course Corrections:**
- **Ship was not a clean merge.** "ship it" assumed a ready PR, but `main` had advanced with three merged PRs conflicting in the exact files the feature touched. Surfaced it and integrated `main` (green suite) rather than forcing the merge.
- **Verify review feedback before applying.** A third-party reviewer asserted FR-018 cited a non-existent D22; verified against the design (D22 exists, line 463) and declined that one correction rather than introducing a regression.
- **Caught a bad premise in my own subagent brief:** I told the plan agent "Bun runtime"; the repo is Node. The agent refused to invent Bun and corrected it loudly — the fail-loud discipline working on my own error.

**Insights:**
- The single-model govern tail is a real convergence signal: when findings stop being cross-model and become adjacent test-nitpicks red-teaming the last fixes, that is the point to override with a documented disposition, not to keep fixing (the myopic-convergence trap the process drivers name).
- The recurring production-control shape held again for voice-editions: impure producer → declarative metadata → deterministic corroboration → structured coverage report. The validator-first ordering (D3) makes the spec's MVP the smallest independently-valuable slice.
- Structural fixes beat point patches: making `classifyZone`'s file/dir distinction a required parameter closed the whole false-safe channel, where patching the one `.ai` example would have invited the next round to find the next example.

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 46
  - spec(voice-editions): apply third-party review corrections (US1 guarantee scope, fidelity-contract wording, FR-020/025, SC-002, report-only tie-in, corroborate-not-infer regression)
  - roadmap(voice-editions): record analyze-clean marker
  - analyze(voice-editions): close FR-024 quote-bank conditional + FR-007 single-source coverage
  - tasks(voice-editions): 26 tier-tagged tasks by user story (validator-first MVP)
  - plan(voice-editions): fill plan + Phase 0/1 artifacts (research/data-model/contracts/quickstart)
  - clarify(voice-editions): resolve 5 open targets to design defaults; record clarification session
  - spec(voice-editions): author spec 004 from the approved design record (D1-D22)
  - roadmap(voice-editions): record design-approved (operator approved; blocker shipped)
  - docs(voice-editions): reconcile design with shipped content-zone-segregation (.ai sibling root; blocker resolved)
  - workflow(graduate): design:feature/content-zone-segregation merging -> validating
  - Merge pull request #7 from audiocontrol-org/feature/voice
  - Merge remote-tracking branch 'origin/main' into feature/voice
  - chore(govern): graduate content-zone-segregation by documented override
  - test(zoning): media-extension trackability probes, honest kind docblock, ratified-invariant contract (AUDIT-17/18/19)
  - docs(zoning): update classifier contract for the required file|directory kind (AUDIT-14/15)
  - fix(zoning): require an explicit file|directory kind so the dot-zone root can't classify human-safe (AUDIT-14/15)
  - chore(govern): record round-2 findings and convergence state
  - test(editorial-tooling): scope no-cache run to a real cwd so the assertion can fail (AUDIT-11)
  - test(zoning): probe .ai/dist git-trackability at nested episode depth (AUDIT-13)
  - fix(zoning): guard the scratch root pre-invocation + assert escape dir is empty (AUDIT-10)
  - chore(govern): record round-1 audit findings, fixes-vs-backlog disposition
  - fix(zoning): classifyZone normalizes before refusing, matching RelativePathSchema (AUDIT-01/06 follow-up)
  - fix(zoning): refuse a symlinked output root and pre-mkdir symlink escape (AUDIT-03/05)
  - test(zoning): pin impure-decl/pure-response routing and .ai git-trackability (AUDIT-07/08)
  - fix(zoning): classifyZone refuses .. and absolute input instead of failing open (AUDIT-01/06)
  - chore(execute): complete content-zone-segregation (25/25); mark tasks done + persist ledger
  - style(zoning): satisfy lint (prettier + preserve caught error cause)
  - test(editorial-tooling): restore no-cache determinism assertion dropped in the split
  - test(zoning): condense stale header comment under the 500-line gate
  - refactor(editorial-tooling): split oversized miner-cache test under the 500-line gate
  - test(zoning): regression for the .ai in-place-edit boundary (T023)
  - docs(zoning): document the .ai convention and audit-zones verb (T025)
  - feat(zoning): register audit-zones verb in the CLI (T021)
  - feat(zoning): read-only routing-audit verb, lexical scope (T020)
  - test(zoning): RED US3 routing-audit verb test (T019)
  - feat(zoning): align refusal messages to asymmetric zone semantics (T018)
  - feat(zoning): refuse authored node declared under a dot-zone (T017)
  - test(zoning): RED US2 authored-direction refusal test (T015)
  - test(zoning): US2 legibility regression guards for classifyZone (T016)
  - Merge pull request #6 from audiocontrol-org/fix/cache-test-file-size
  - test(quote-bank): split the cache suite to satisfy the 500-line file cap
  - Merge pull request #5 from audiocontrol-org/feat/quote-bank-resumable-mining
  - Merge pull request #3 from audiocontrol-org/fix/surface-provider-diagnostics
  - backlog: capture operator-visibility findings (TASK-11/12)
  - fix(validate): surface the validator's named errors, and record them in the ledger
  - fix(providers): tee provider stderr to the operator instead of discarding it on success
- Files changed: 72
- Backlog touched: TASK-11, TASK-15, TASK-16, TASK-17, TASK-18

## 2026-07-26: Turn the codex voice experiment into features — voice-editions design, then content-zone-segregation end to end (design → spec → MVP)

**Goal:** Review the nouvelle-france `spike/codex-authorship` voice experiment and turn it into a real production-control capability. This unfolded into three linked pieces: design `voice-editions`; discover and design its blocker `content-zone-segregation`; and drive that blocker through the full stack-control front door to a running MVP.

**Accomplished:**
- **voice-editions design** (`docs/superpowers/specs/2026-07-25-voice-editions-design.md`), operator-approved-pending. Voice as a first-class declared input to any prose target; an impure revision provider gated by a deterministic fidelity validator + a per-unit coverage ledger. Survived three third-party review rounds.
- **content-zone-segregation** designed, reframed, and reclassified from the original `artifact-adoption` framing. Design record approved (`design-approved: yes`, `analyze-clean: yes`); D2b (bidirectional segregation) operator-ratified.
- Drove `/stack-control:define` end to end: spec 003 (24 FRs, 8 SCs), plan + research/data-model/contracts/quickstart, 25 tier-tagged tasks, `/speckit-analyze` clean.
- Drove `/stack-control:execute` through **US1, the MVP: 15/25 tasks, all green.** New `src/zoning/` classifier + routing; impure output routed to a dot-zoned `.ai/` root; realpath containment + zoning refusal in the build path; pure-declared-returns-impure now a named refusal. Each task dispatched to a fresh subagent at its resolved model (haiku/sonnet/opus), test-first, committed, pushed; durable execution ledger persisted (resumable).
- Backlog: captured **TASK-15** (`pc build` has no state guard; stale-over-modified can silently erase a hand edit). Design-inbox: captured the "declarative-production-with-deterministic-corroboration" pattern and a future "machine-operational" fourth-zone idea.

**Didn't Work / left open:**
- Execute is paused at the US1 MVP boundary (front-door marker exited cleanly, resumable via ledger). US2 (authored-direction refusal + legibility), US3 (routing audit verb), polish (T023–T025), and the whole-feature `govern` pass remain.
- A pre-existing, unrelated suite failure persists: `editorial-tooling/test/miner-cache.test.mjs` is 536 lines (>500-line architecture gate). Not this feature's; will trip T024's suite gate and possibly `govern` until fixed.

**Course Corrections:**
- **Biggest one:** while planning, reading `build.ts:112` revealed the design chain (three review rounds included) had the routing model *wrong*. Impurity-based routing already existed (post-response, into a non-dot `ai-generated/` sibling), which meant (a) the "false-safe hole" D2a claimed did not exist, and (b) `ai-generated/` would itself violate the new rule. Corrected D2a (fail-loud, not false-safe closure) and D3 (rename to `.ai/` sibling) across spec, design record, research, data-model, and plan — all operator-ratified. The feature landed smaller and more concrete than first specced.
- Corrected my own framing after operator pushback: naming conventions are a first-class *human* authority (legibility at a glance), not a swappable enforcement detail subordinate to machine provenance. Drove INV-2/INV-3.
- Corrected the voice-editions D19: the "waiver" escape hatch it named doesn't exist for derived nodes; the whole adopt-the-edit premise was superseded by prevention.

**Insights:**
- The recurring production-control shape: impure producer → declarative metadata → deterministic corroboration → structured coverage report (quote-bank, voice-editions, this feature). Worth naming in a governing doc (captured to the inbox).
- Two channels, two audiences: the path tells a *human* whether a location is human-safe or AI-permitted; the graph's impurity flag tells the *machine* exact provenance; enforcement keeps them from diverging. A dot-zone means "AI-permitted / not human-safe", never "definitely AI".
- Model-sized dispatch works well: haiku for scaffolding/docs, sonnet for standard impl/tests, opus reserved for the high-blast-radius enforcement — where the opus agent's parent-only-realpath reasoning (a pre-planted `.ai/out → /etc/passwd` symlink is *replaced* by the atomic rename, never written through) was exactly the rigor that tier is for.
- Reading the code beats trusting a reviewed design: three careful review rounds all missed the existing routing because they reasoned about the design, not `build.ts`.

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 21
  - chore(execute): persist content-zone-segregation execution ledger (15/25 tasks; resumable)
  - feat(zoning): refuse pure declaration that returns impure (T014)
  - feat(zoning): realpath containment ordering + impure zoning refusal (T009/T012/T013)
  - feat(zoning): route impure output to dot-zoned .ai root; migrate fixtures (T011/T022)
  - test(zoning): RED US1 tests — impure routing/refusal/escape (T006/T007/T008/T010)
  - feat(zoning): add zoning refusal helper + integration test scaffold (T002/T005)
  - chore(roadmap): record analyze-clean marker on content-zone-segregation
  - feat(zoning): add classifyZone path zone classifier (T001/T003/T004)
  - analyze(content-zone-segregation): tighten FR-003 test coverage; record coverage notes
  - tasks(content-zone-segregation): 25 tier-tagged tasks by user story
  - plan(content-zone-segregation): fill plan + Phase 0/1 artifacts
  - fix(content-zone-segregation): correct spec+design to match the real routing code
  - spec(content-zone-segregation): author spec 003 from the approved design record
  - design(content-zone-segregation): operator approved; D2b ratified
  - design(content-zone-segregation): record third-round approval; capture future fourth-zone watch item
  - design(content-zone-segregation): close the false-safe and escape holes, make zoning normative
  - design(content-zone-segregation): naming is a human authority, not swappable enforcement
  - design(content-zone-segregation): reframe adoption into an enforced provenance boundary
  - design(voice-editions): state the trust model - corroborate, never infer
  - design(voice-editions): narrow the guarantee to what the validator can prove
  - design(voice-editions): capture the design record for voice as a governed input
- Files changed: 32
- Backlog touched: TASK-13, TASK-14, TASK-15

workflow(open-design): design:feature/episode-production-contract planned -> designing
workflow(design-to-spec): design:feature/episode-production-contract designing -> specifying
workflow(design-to-spec): design:feature/quote-bank designing -> specifying
workflow(graduate): design:feature/episode-production-contract merging -> validating
workflow(graduate): design:feature/quote-bank merging -> validating
workflow(graduate): design:feature/content-zone-segregation merging -> validating
workflow(graduate): design:feature/voice-editions merging -> validating
workflow(graduate): design:feature/voice-producer-protocol merging -> validating

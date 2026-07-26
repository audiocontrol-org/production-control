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

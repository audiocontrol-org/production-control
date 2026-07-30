---
slug: 006-voice-compose-from-spine
targetVersion: ""
---

# Audit log — 006-voice-compose-from-spine

## 2026-07-30 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260730-01 — Mode-ordering test proves ordering in the one direction where it cannot fail — `op_obligations` is absent on a revise ledger regardless

Finding-ID: AUDIT-20260730-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/mode-agreement-run.int.test.ts:52-104

The test's stated contract is that mode-agreement is sequenced **first**, "proving the mismatch was decided BEFORE any op-legality/op-obligation ran, never masked by one" (header, lines 10-14). Its load-bearing assertion for that claim is `assert.equal(result.report.checks.op_obligations, undefined, 'op_obligations must not appear — op-legality never ran')` (≈lines 95-100). But the fixture is a `mode: revise` ledger (the faithful fixture carries no `mode` field, per the header at lines 18-23), and the op-obligations surface introduced by this feature is compose-scoped — the sibling chunk names it `check-op-obligations-compose.test.ts`, and the only run-level report in the diff that carries `checks['op_obligations']` is the compose-built edition in `open-question-marker.test.ts:93`. On a revise ledger `op_obligations` would be `undefined` whether mode-agreement ran first, last, or not at all. The assertion is tautological, and the comment attached to it asserts a guarantee the assertion does not establish.

The direction that *would* discriminate is the mirror case — `requestedMode: 'revise'` against a `mode: compose` ledger — because there the compose op-obligation and whole-unit-no-copy checks are live and could plausibly fail first and mask the mismatch (or emit a misleading named failure alongside it). That direction is not covered anywhere in this chunk. Note also the internal tension in the test itself: `DOWNSTREAM_CHECKS` (lines 40-50) asserts eight checks are *present with state `aborted`*, while `op_obligations` is asserted *absent* — two different report shapes for "did not run," and the test encodes both without explaining which one the ordering guarantee actually depends on.

Blast radius: an unattended agent reading this test concludes ordering is pinned in both directions and will refactor `runFidelity`'s check sequence freely. If a future edit moves compose op-legality ahead of mode-agreement, this suite stays green and a compose-ledger/revise-request mismatch gets reported as an op-legality failure instead of a mode mismatch — exactly the masking the test claims to rule out. Fix: add the mirror-direction case against a `mode: compose` ledger and assert `op_obligations` is present-and-`aborted` there, and make the two "did not run" shapes consistent.

### AUDIT-20260730-02 — An edition-invented `[OPEN-QUESTION: …]` marker passes silently — the survival check is one-directional and nothing fixtures fabrication

Finding-ID: AUDIT-20260730-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/open-question-marker.test.ts:60-130

All three marker tests check one direction only: a marker declared in the spine must survive into the edition (test 1), and its absence fails (test 2). The mechanism they exercise is `payloadSurvives(source, unionOfDestinations)` (`payload-match.test.ts:88-118`), which is by construction a source-⊆-destination containment check — a destination payload item with no source counterpart is not a shortfall and is not reported. So an edition that *invents* `[OPEN-QUESTION: Was the sample contaminated?]` where the spine declared no such question passes fidelity with `open_question_markers: 'none-declared'`, and the report affirmatively tells the reader no marker guarantee was in play.

That is the fabrication direction, and for this feature it is the consequential one. The audited range explicitly carries an overclaim regression (commit 918959d, "open-question marker enforcement (FR-013) + SC-007 overclaim regression"), and an open question the producer manufactured is precisely an overclaim about what the source left unresolved — it puts words in the spine's mouth about the state of the evidence. A dropped marker degrades the edition; a fabricated marker misrepresents the source. The test file's own framing ("REQUIRED payload", lines 1-8) treats the marker as a citation/numeral analogue, and citations and numerals have the same one-directional weakness, but neither of those carries the "the source is uncertain about this" semantics that make fabrication a trust-boundary event.

Blast radius: a downstream consumer treats a passing report plus `none-declared` as "this edition asserts nothing about unresolved questions," which is false. Fix: either add a destination-side check that every `[OPEN-QUESTION: …]` in the edition is byte-present in the spine (and a fixture for it), or state the invariant explicitly in the report field's documented meaning — `'none-declared'` must not be readable as "no markers in the edition" when it only means "no markers in the spine."

### AUDIT-20260730-03 — Whole-unit copy (R4) is never exercised under `merged`, only `represented` — the docstring claims both

Finding-ID: AUDIT-20260730-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/policy-op-legality.test.ts:15-17, 78-104, 128-141

The file header claims coverage of "a `represented`/`merged` destination byte-identical to a complete source beat (whole-unit copy, R4)" (line 15-16). The only whole-unit-copy test (`checkOpLegality: compose forbids a whole-unit copy`, lines 78-104) builds *both* coverage entries with `op: 'represented'`. No fixture anywhere in the file pairs `op: 'merged'` with a byte-identical destination. The `merged` op appears exactly twice in the whole file — in the two *passing* fixtures (line 116 `{ source_unit: ref(s1), op: 'merged', edition_units: [ref(e1)] }` and line 219) where the destination deliberately drifts.

Blast radius: an implementation (or a refactor of the existing one) whose copy predicate reads `if (entry.op === 'represented' && …)` passes this entire suite green while R4 is bypassable by relabelling the op `merged`. That is not a theoretical evasion — `merged` is a first-class legal compose op that this same file pins as legal, and the producer emitting the ledger is a language model choosing its own op labels. The result is a compose edition that lifts whole source paragraphs verbatim, passes both the producer preflight and the fidelity validator, and is reported as legitimately composed. Fix: add a `merged`-op whole-unit-copy fixture (byte-copy destination, `op: 'merged'`), and assert `whole-unit-copy` fires for it — ideally table-driven over `['represented', 'merged']` so any future compose-legal op must be added to the table deliberately.

### AUDIT-20260730-04 — A `grounded` record with an empty/absent `beats` array is never tested — the file's own "invented-prose hole" stays open

Finding-ID: AUDIT-20260730-04
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/policy-grounding.test.ts:11-13, 106-158

The header states the policy "enforces … grounded-beat resolution (a `grounded` record's beats each name a real source unit)" (lines 11-12). Every `grounded` record in the file carries exactly one populated beat (lines 40, 58, 78, 96, 115, 208). No test constructs `{ edition_unit: ref(e0), basis: 'grounded', beats: [] }` or a `grounded` record with `beats` omitted entirely.

Blast radius: if `beats` is optional or merely typed as an array on `GroundingRecord`, an edition unit declared `grounded` with zero beats satisfies EXHAUSTIVE (it has exactly one record), satisfies EXCLUSIVE (no duplicate, resolves to a real edition unit), and has no beat to dangle — so `checkGrounding` returns `ok: true`. That is precisely the invented-prose hole the file's own HIGH comment at lines 106-111 claims to close, reached by a shorter path than the occurrence collision it does test: the producer simply asserts grounding and names nothing. Because `checkGrounding` is the shared preflight *and* validator predicate (R8), nothing downstream re-checks it. If the schema layer already forbids empty `beats` for `basis: 'grounded'`, the pin still belongs in this file — this suite is the stated contract for the policy, and a schema-side guarantee it never references is a coupling this file cannot see. Fix: add `grounded`-with-`beats: []` → expect a named failure (a `beats-empty`/`unsupported-grounding` kind), and a `grounded`-with-`beats` absent case.

### AUDIT-20260730-05 — Stale RED-phase commentary survives into HEAD, asserting the shipped revise preflight does not exist and that a passing test is "expected to FAIL"

Finding-ID: AUDIT-20260730-05 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=low
Decision:   adjudicated (gate-counted high) — blast-radius=low/latent, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/revise-verbatim-preflight.int.test.ts:11-20, :84-89

The file header states `@/revise/preflight.ts`'s `runPreflight` "is a NO-OP for `mode !== 'compose'` **today**", that "T023 is the task that wires … into the revise branch of `runPreflight`", and "This file is RED-test-only: it does NOT implement that branch" (lines 11-16). The inline block above the first assertion goes further: "today (no revise verbatim-drift preflight exists yet -- T023 adds it) … the producer currently EMITS this drifted edition instead of refusing it. **This assertion is expected to FAIL until T023 wires** `checkOpLegality('revise', ...)`" (lines 84-89). But the audited range contains `1e27b42 feat(voice-compose): T023 US4 revise verbatim-drift pre-emit refusal (TASK-50)`, and this diff is the cumulative HEAD-vs-`cb8edab` state — so at HEAD, T023 has landed and both comment blocks describe the production code as the opposite of what it now is.

Blast radius, and why this is `high` rather than cosmetic: the wrong reading here is the *first* one a consumer reaches, and it changes behavior on two paths. (1) Triage: when this test fails in CI, whoever (or whatever unattended agent) reads the failure finds an in-file comment declaring that exact assertion "expected to FAIL" — a genuine regression in the revise verbatim-drift refusal, the precise empirical defect TASK-50 exists to close, gets dispositioned as the known-RED state and suppressed. (2) Contract discovery: an agent reading this test to learn where revise-mode op-legality lives is told `runPreflight` has no revise branch, so it will plausibly re-add the check somewhere else (a second enforcement site in `emit.ts`, `cli.ts`, or a new module) rather than extending the one that exists — exactly the fix-induced surface growth the process drivers target. Nothing else in the file corrects the reading; the header is the most authoritative-looking prose in it.

A reasonable fix: rewrite lines 11-20 in the post-GREEN indicative ("`runPreflight` refuses revise-mode verbatim drift via `checkOpLegality('revise', …)`; this test pins that behavior end-to-end through the real binary"), delete the "expected to FAIL until T023" paragraph at 87-89 entirely, and keep only the durable provenance (TASK-50, the 2/56 empirical defect, contracts/voice-compose-cli.md, Principle V). This is a general hazard of RED-first commits, not a one-off: any test file authored as RED needs its narration re-stated when the GREEN commit lands, and this file is evidence the execute loop has no step that does so.

---

### AUDIT-20260730-06 — Fails-open default `ledger.mode ?? 'revise'` silently disables the entire US3 compose-legality gate

Finding-ID: AUDIT-20260730-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-op-obligations.ts:~171

```ts
const mode: Mode = ledger.mode ?? 'revise';
```

Every mode-aware behavior added by T020 hangs off this one expression: the `checkOpLegality` fold (line ~172), the verbatim shared-supply pre-pass guard (`|| mode === 'compose'`, line ~186), and the per-entry skip (`mode === 'compose' && (...)`, line ~217). A ledger that reaches `checkOpObligations` without a `mode` stamp is therefore treated as `revise`, which means a *composed* edition containing `verbatim` or `cut` ops produces **zero** `illegal-op` failures, runs the revise byte-identity obligation instead, and can satisfy `op_obligations` outright. The gate does not fail loud on a missing mode — it fails permissive, in the exact direction the feature exists to prevent.

This is also the "fallbacks are bug factories" shape the project guidelines prohibit (CLAUDE.md: *"Never implement fallbacks … Throw errors with a description of the missing functionality"*). The `??` reads as backward compatibility, but the cost of the compatibility is that the older, unstamped ledger is the one that gets waved through. If `loadLedger` validation (c665538) already makes `mode` mandatory, then the in-memory `CoverageLedger.mode` should be non-optional and this `??` should not exist; if `mode` is genuinely optional for some caller, that caller needs an explicit decision rather than an implicit one. Either way the correct shape here is `if (ledger.mode === undefined) throw new Error('coverage ledger has no mode stamp; cannot judge op legality')`.

Blast radius: a compose ledger missing one field gets a *passed*-eligible `op_obligations` result with illegal dispositions present. An unattended producer loop reads that as "the gate cleared my composed edition" — the single highest-consequence wrong reading in this feature. Rated high rather than blocking only because I cannot verify from this chunk whether any live path can actually deliver an unstamped ledger here.

### AUDIT-20260730-07 — `requested_mode` presence channel is unguarded: a dropped or misspelled key degrades mode-agreement to a silent no-op

Finding-ID: AUDIT-20260730-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:61-69, 234-240

`isValidRequestedMode` (line ~66) closes the **value** channel correctly and deliberately — a present-but-invalid mode is refused loudly rather than read as "not supplied," and the doc comment says exactly that. But it leaves the **presence** channel wide open, which is the channel that actually fails in practice. If the provider recipe emits `requestedMode`, `requested-mode`, `mode`, or omits the field after a refactor, `isValidRequestedMode(undefined)` returns `true`, the spread at line ~239 contributes nothing, and the pipeline's *first* check silently becomes `mode_comparison: 'none-supplied'`. The build then proceeds to a `passed` verdict having never performed the independent mode comparison that US5 exists to perform.

Nothing in this diff distinguishes "governed build that legitimately has no requested mode" from "governed build whose recipe lost the field." The doc comment at line ~24-32 states the intended split — *"a governed build supplies it (from the provider recipe); standalone `voice-fidelity` use omits it"* — but that split is enforced nowhere. `mode_comparison: 'none-supplied'` in the report is disclosure, not a gate, and no code in this chunk reads it back. A reasonable fix is to make the governed invocation path assert the field (the provider that constructs `ValidateRequest` for a governed build refuses to emit one without `requested_mode`), so the optionality lives only in the standalone entry point, not in the wire validator that both share.

Blast radius: the independent mode check is the load-bearing half of the mode-agreement contract — it is what catches a producer that composed while the recipe asked for revise. A key-name drift in one recipe turns that check off permanently and quietly, and the resulting report still says `passed`. That is a defect a consumer will hit on the first recipe refactor.

### AUDIT-20260730-08 — Open-question-marker enforcement is mode-agnostic while the requirement and its report field are compose-scoped

Finding-ID: AUDIT-20260730-08 (claude-03 + claude-05 + claude-09 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=low
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/fidelity/check-op-obligations.ts:86-112; voice-tooling/src/fidelity/report.ts:112-145

`openQuestionMarkers` is appended to `PAYLOAD_KINDS` (line ~86-93), `KIND_LABEL` (~102), and `FAILURE_KIND_BY_PAYLOAD` (~111) with **no mode gate and no applicability gate** — unlike `lexiconTerms`, which the module guards with `lexiconApplicable`. So in **revise** as well as compose, a `[OPEN-QUESTION: ...]` marker present in the source unit becomes required payload whose exact bytes must survive into the declared destination, and a shortfall emits an `open-question-marker` failure that `classify-op-failures.ts` folds into `op_obligations` and withholds the verdict.

Meanwhile every stated scoping of this obligation is compose-only: the `OpFailureKind` doc comment cites "R7/FR-013, T027"; the report field `open_question_markers` exists **only** on the compose path, emitted solely by `composeTrustBoundaryFields` (report.ts ~117-145), whose own comment says run.ts decides `'enforced'` vs `'none-declared'` "from whether the SPINE actually declares one." A revise validation has no spine. The result is two concrete problems. First, a revise edition refused for a dropped marker gets an `op_obligations` failure with **no** corresponding report field saying the obligation was even in force — undiagnosable from the report alone. Second, and worse, byte-preservation of a marker is semantically wrong for revise in at least one obvious case: a revision that *resolves* an open question must delete the marker, and this code refuses exactly that edit. (That second consequence is conditional on `@/payload/extract.ts` recognizing markers in revise source units, which is outside this chunk — but the diff proves the *check* applies the kind unconditionally, so the extractor's mode-blindness is the only thing standing between this and a live refusal.)

Blast radius: the readings genuinely diverge — an agent reading the doc comments concludes compose-only, an agent reading `PAYLOAD_KINDS` concludes always-on, and the report is silent for revise either way. If the extractor does fire on revise sources, legitimate revise work becomes mechanically un-passable with no report field to explain why. The fix is to make the scope explicit in code: either gate the kind on `mode === 'compose'` (mirroring `lexiconApplicable`), or keep it mode-agnostic and emit `open_question_markers` on revise reports too.

### AUDIT-20260730-09 — Absent `mode:` silently loads as `revise`, and the default is indistinguishable from a declared `revise` — every compose-only check then no-ops while the report attests "matched"

Finding-ID: AUDIT-20260730-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/schema/ledger.ts:~122-131 (`parseMode`) + :~109-119 (the `loadLedger` return, which stamps `mode`), read against voice-tooling/test/check-mode-agreement.test.ts:56-66 and voice-tooling/test/check-no-copy.test.ts:150-164

```

`parseMode` implements the pre-006 backward-compat rule as `if (value === undefined) { return 'revise'; }`, and `loadLedger` then materializes that assumption into the returned object (`mode,` is unconditional in the return literal). The consequence is that the *assumed* mode and the *declared* mode are the same value with no provenance marker, so no consumer can tell them apart. Two downstream behaviors turn that into a silent-pass channel:

1. Every compose-only check keys off `mode === 'compose'` and reports **not-applicable / ok** otherwise — `check-no-copy.test.ts:150-164` codifies exactly that (`applicable: false`, `ok: true`, `failures: []` for a revise ledger). So a compose-produced ledger that omits `mode:` (a model-emitted YAML field is precisely the thing that goes missing) loads as `revise`, and `check-no-copy`, `check-edition-grounding`, and the compose half of `check-op-obligations` all become inert. The edition is then reported as validating with the compose invariants never evaluated.
2. The only guard against that is `check-mode-agreement`, and it is opt-in on the caller's side: `check-mode-agreement.test.ts:56-66` fixes `checkModeAgreement(undefined, 'revise') → ok, 'none-supplied'`. Worse, when a caller *does* thread `requested_mode: 'revise'`, `checkModeAgreement('revise', 'revise')` reports `mode_comparison: 'matched'` — an affirmative claim of independent agreement about a ledger that never said `revise` at all. Given that this same commit range added an SC-007 overclaim regression (918959d), a report field that says "matched" against a defaulted value is the same overclaim shape one layer down.

Blast radius: an unattended agent building or validating a compose edition gets a clean, affirmatively-worded validation for an edition whose compose-specific fidelity rules were never checked, because one optional YAML key was absent. That is a fallback that hides a failure mode, which the project guidelines call out directly. A reasonable fix is to stop collapsing the two states in the loader: return the declared mode plus its provenance (e.g. `mode` and a `mode_declared: boolean`, or keep `mode: Mode | undefined` on the parsed value and let the *validator* apply the compat default explicitly), and have `check-mode-agreement` report a third comparison value (e.g. `matched-by-default` / `ledger-mode-absent`) instead of `matched` when the ledger did not declare a mode. At minimum, `parseGrounding`'s compose/revise asymmetry should be mirrored by refusing a *defaulted* revise ledger that carries any compose-only artifact.

```

### AUDIT-20260730-10 — `mode: 'compose'` only refuses *absent* grounding — the partial-grounding channel has no fixture

Finding-ID: AUDIT-20260730-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise-protocol.test.ts:≈116-265 (parseModelOutput grounding), ≈388-548 (buildEdition T011)

The new grounding surface is exercised for exactly three failure classes: *no* grounding under compose (`/mode 'compose' requires a non-empty grounding declaration/`), grounding present under revise, and out-of-range indices. Nowhere in this file is **partial** grounding tested: a compose output whose edition has N units but whose `grounding` array declares fewer than N (`grounding: [{edition_unit: 0, basis: 'grounded', beats: [0]}]` against a two-unit edition), or one that declares the same `edition_unit` twice and leaves another silently undeclared. The only positive compose test (`COMPOSE_MODEL`, ≈391-404) supplies a perfectly 1:1 grounding, and the corresponding assertion is `assert.equal(ledger.grounding?.length, 2)` — which is satisfied by both a correct 1:1 mapping and by `[{edition_unit: 0,…},{edition_unit: 0,…}]`.

This is the channel the feature exists to close. The whole point of grounding accounting (SC-007 / the overclaim regression named in commit 918959d) is that every edition unit must declare a basis, so invented prose cannot pass as spine-derived. If `buildEdition` accepts a partial declaration, the model's cheapest escape from "declare a basis for every unit" is to simply omit the unit it invented — no error, a well-formed ledger, and downstream grounding accounting has nothing to account. The `coverage` sibling invariant is explicitly enforced with a per-source-unit cardinality check (`/coverage must carry exactly one entry per source unit/`, ≈356); grounding has no analogous cardinality assertion in this file, which is what makes the omission legible as a gap rather than a style choice.

I could not read `src/revise/protocol.ts` or `src/policy/grounding.ts` (other chunks), so two readings survive: (a) totality is unenforced at emit time and this is a live overclaim escape hatch; or (b) totality is enforced in `check-edition-grounding` at validate time, in which case the emit path still admits a ledger that the validator will reject — and this test file's three "fails loud" cases read as complete coverage when the load-bearing case is untested. A reasonable fix is one assertion each way: a partial-grounding compose build must throw, and a duplicate-`edition_unit` grounding must throw.

---

### AUDIT-20260730-11 — Compose pre-emit self-check silently drops `compose-forbids-cut` / `compose-forbids-verbatim` failures, so an illegal-op compose edition gets WRITTEN instead of refused

Finding-ID: AUDIT-20260730-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/preflight.ts:85-95 (compose branch of `runPreflight`), cross-file: voice-tooling/src/revise/ledger-build.ts (coverage build), voice-tooling/src/fidelity/check-op-obligations.ts

The compose branch runs `checkOpLegality('compose', coverage, sourceUnits, editionUnits)` and then keeps **only** `whole-unit-copy` failures:

```ts
refusals.push(
  ...legality.failures
    .filter((failure) => failure.kind === 'whole-unit-copy')
    .map((failure) => failure.message),
);
```

The inline justification for discarding the rest is self-contradictory on its face: *"The `compose-forbids-verbatim`/`-cut` kinds cannot arise here -- `buildEdition` only ever emits `represented`/`merged`/`cut` from the model's coverage and never a verbatim in compose"*. `cut` is in the list of ops `buildEdition` emits, and `cut` is exactly what compose forbids — `COMPOSE_HELP` states it as a MECHANICAL guarantee (`help.ts`: *"op is NEVER \"verbatim\", NEVER \"cut\""*). Nothing in the visible `buildEdition` diff (`ledger-build.ts`, the coverage-mapping block preceding line 126) mode-gates the op before stamping it into the ledger; `resolveGrounding` is the only mode-aware guard added, and it only inspects `grounding`, never `coverage[i].op`.

Blast radius: a compose model that returns `{"op":"cut","reason":"…"}` for a beat produces a ledger with a forbidden op, the pre-emit self-check returns `ok: true`, and the producer **writes** an edition + BuildResponse that the `voice fidelity` validator will then refuse at step 5. That breaks the stated contract in this module's own header (*"the caller REFUSES loudly (throws) BEFORE any write (Principle V)"*) and the help text's refusal contract (*"on any refusal … NO stdout"*), and it converts a clean local refusal into a downstream validation failure with a half-written `output_dir`. If `revise/cli.ts` happens to run a separate op-obligations guard before `buildEdition` (not visible in this chunk), the defect is a duplicated-guard/dead-filter problem instead — but the rationale comment is still wrong for `cut`, and the duplication should be named here rather than asserted away. Fix: drop the `whole-unit-copy` filter and push **all** `legality.failures` messages (they are already mode-scoped by the `'compose'` argument), or, if a subset is genuinely intended, assert exhaustively over the kind union so an unhandled kind is a compile error.

### AUDIT-20260730-12 — Compose producer can emit ledgers with illegal `verbatim`/`cut` ops

Finding-ID: AUDIT-20260730-12
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/preflight.ts:84-93; voice-tooling/src/revise/ledger-build.ts:94-127

`buildEdition` accepts any non-`cut` op, including `verbatim`, and accepts `cut` when it has a reason, then stamps the ledger with `mode: 'compose'` at lines 94-127. The only producer pre-emit legality call is `checkOpLegality('compose', ...)`, but `runPreflight` filters that result down to `whole-unit-copy` only at lines 89-93, explicitly dropping the shared policy’s `compose-forbids-verbatim` and `compose-forbids-cut` failures. That means a compose model output with `op: "cut"` or `op: "verbatim"` can pass producer preflight and be written, despite the help/contract saying compose mechanically enforces “op is NEVER `verbatim`, NEVER `cut`” and “on any refusal ... exits non-zero with NO stdout.”

The blast radius is high because adopters running `voice compose` can receive an invalid compose edition as a successful BuildResponse; the later fidelity validator may catch it, but the producer’s stated pre-emit boundary is already broken. A reasonable fix is to make compose preflight refuse all compose op-legality failures, or reject illegal compose ops during `buildEdition` before constructing/writing the edition.

### AUDIT-20260730-13 — A passing compose run emits no `edition_grounding` / `no_copy` check entries at all, so "enforced and passed" is indistinguishable from "never ran"

Finding-ID: AUDIT-20260730-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run-mode.ts:68-86; voice-tooling/src/fidelity/run.ts:388-396

`applyComposeEditionChecks` writes into `checks` **only on failure**: `if (groundingResult.applicable && !groundingResult.ok) { checks['edition_grounding'] = failed(...) }`, and the same shape for `no_copy`. The doc comment defends this as "present-and-`failed` ONLY on a real compose violation, so it never appears in a passing revise report." But the consequence for compose is that the two checks the entire US2/US3 work added are **absent from every passing compose report**. Every other check in this pipeline is present in all three states (`passed`, `notRun`/`aborted`, `notCheckable`) precisely so the report is a self-describing record of what was checked; these two are the only ones whose success is encoded as silence.

Silence is the one encoding a consumer cannot verify. Given a `verdict: passed` compose report, a gate cannot distinguish (a) grounding ran and passed, (b) grounding was skipped because `applicable` came back false for an unexpected reason, (c) the report came from a validator build that predates `check-edition-grounding.ts`. The same gap widens on the mode-mismatch abort: `AFTER_MODE_AGREEMENT` (run.ts:96-107) lists only the eight source-side checks, so `edition_grounding`/`no_copy` are not even marked `aborted` there — a mode-mismatch compose report is silent about them too, for a third distinct reason. For a feature whose stated purpose is honest trust boundaries under unattended operation, "absence means it passed" is the wrong default: an agent reading the report will conclude nothing was checked, or worse, assume it was.

Fix: emit the check unconditionally when `applicable` is true (`passed(...)` on success, `failed(...)` on violation) and emit an explicit non-applicable state (`notRun`/skip with a "revise: not applicable" diagnostic) when `applicable` is false — the revise-report concern the comment raises is satisfied by a distinct state name, not by omission. Add `edition_grounding`/`no_copy` to the mode-agreement abort list so a mismatch reports them as aborted rather than missing.

---

### AUDIT-20260730-14 — `OPEN_QUESTION_RE` truncates at the first inner `]`, so a marker containing a citation loses both the tail of the marker and any numeral after that bracket from all required-payload enforcement

Finding-ID: AUDIT-20260730-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/payload/extract.ts:53-61, 104-117

`OPEN_QUESTION_RE = /\[OPEN-QUESTION:[^\]]*\]/g` cannot span a nested `]`. `extractPayload` applies it to raw content, while `extractNumerics` applies it to content from which citations have **already been stripped**. The two extractions therefore disagree about how far a marker extends, and the gap between them is a hole in the required-payload guarantee.

Worked example on the spine beat `Not settled: [OPEN-QUESTION: does [^ref-4] cover the 42-unit cohort?]`:
- `extractPayload` → `openQuestionMarkers: ['[OPEN-QUESTION: does [^ref-4]']` — truncated at the citation's closing bracket. Everything after it (` cover the 42-unit cohort?]`) carries **no** survival obligation.
- `extractNumerics` first removes `[^ref-4]`, leaving `[OPEN-QUESTION: does  cover the 42-unit cohort?]`, which `OPEN_QUESTION_RE` now matches in full and deletes — so `42` is masked out of `numerics` as well.

Net effect: `42` is required by neither the marker multiset nor the numeric multiset, and an edition may silently drop or alter it (and the entire tail of the question) while `verbatim_quotes`, `numeric_literals`, and the new marker obligation all pass. That is exactly the double-booking/leak class the `extractNumerics` doc comment (extract.ts:104-117) claims to have solved — its stated rationale ("a digit that must be counted as part of the marker's own required bytes") is only true for markers with no nested bracket. The `[OPEN-QUESTION: does <cited claim> hold?]` shape is not exotic in this domain; asking an open question *about a cited claim* is the natural use.

Fix: extract markers from the same citation-masked text used for numerics (so both agree on extent), or make the marker pattern bracket-aware / anchored to `]` at end-of-marker with a documented rule that markers may not contain `]`, plus a fixture proving the nested-citation case. Whichever is chosen, the invariant to state is "the byte span the marker payload requires is exactly the span the numeric extractor masks" — today those two spans differ, and the difference is unenforced bytes. Fixtures for: marker containing a `[^n]` citation, marker containing `[ABC-1]`-style source marker, marker containing a bare `foo[0]`, and a numeral positioned after the inner `]`.

---

### AUDIT-20260730-15 — Passing reports omit the new mode-agreement check

Finding-ID: AUDIT-20260730-15
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:168-177; voice-tooling/src/fidelity/report.ts:156-167

`runFidelity` runs `checkModeAgreement`, but only writes `checks['mode_agreement']` when the check fails. On both pass paths it stores only `modeComparison` and leaves the named check absent. `computeVerdict` also still requires only the old ten checks, so a report can emit `verdict: passed` without proving that the new first check is present in `report.checks`.

This matters because the feature adds `mode_agreement` as a deterministic gate sequenced before all downstream checks. Downstream consumers inspecting the structured check map cannot distinguish “mode agreement passed” from “this older or broken runner never reported the check,” yet the top-level verdict still passes. The reasonable fix is to add `mode_agreement` to the required check vocabulary and set it to `passed(...)` on successful agreement, carrying `mode_comparison` either as check metadata or top-level report metadata consistently.

### AUDIT-20260730-16 — Compose-only checks emit no pass-side evidence: a clean compose report is indistinguishable from one where grounding/no-copy never ran

Finding-ID: AUDIT-20260730-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-edition-grounding.ts:31-33,50-60 · voice-tooling/src/fidelity/check-no-copy.ts:34-36,52-61 (consumers: voice-tooling/src/fidelity/run-mode.ts:64-86, voice-tooling/src/fidelity/run.ts:388-397)

Both wrappers compute an `applicable` flag whose stated purpose is to distinguish "no-op for revise" from a real compose evaluation — but that distinction is then thrown away. The only consumer is `run-mode.ts:71-85`, which writes into `checks` **only on failure** (`checks['edition_grounding'] = failed(...)`, `checks['no_copy'] = failed(...)`). I grepped the whole package: `edition_grounding` and `no_copy` never appear as `passed()` anywhere (`src/fidelity/run.ts` assigns `passed()` for `source_hash`:211, `ledger_structure`:254, `unit_accounting`:268, payload checks:338-369 — but nothing for these two). Because a non-applicable result is always `{ok:true, failures:[]}`, the guard `if (result.applicable && !result.ok)` is exactly equivalent to `if (!result.ok)` — `applicable` is dead in production code, and the report has no field carrying it.

The consequence is an overclaim at precisely the trust boundary this feature was built to protect. A passing compose validation report carries `verdict: passed` and contains **zero** record that edition-grounding or whole-unit no-copy were evaluated. That matters because the loader deliberately defaults an absent `mode` to `revise` for pre-006 backcompat (`src/schema/ledger.ts:19`, `109`), so a compose edition validated with a ledger whose `mode` key is missing (and whose `grounding` is therefore also absent — `parseGrounding` only rejects the *inconsistent* combinations, `ledger.ts:135-146`) is silently validated under revise rules: verbatim becomes legal, grounding is never accounted, no-copy never runs, and the emitted report is byte-comparable to a genuine clean compose pass. The only guard is the *optional* `requested_mode`; standalone `voice-fidelity` invocations pass `mode_comparison: none-supplied` and go on. Note the asymmetry inside this same feature: `check-mode-agreement.ts:33,51,59` goes out of its way to record *which* pass outcome occurred, and the contract mandates it (`contracts/fidelity-mode-agreement.md:23`), while the contract says nothing about a pass-side record for steps 4/5 — so nothing corrects this by default.

Reasonable fix: surface `applicable` in the report. Assign `checks['edition_grounding'] = passed({ units: editionUnits.length })` and `checks['no_copy'] = passed()` when `applicable && ok`, and record the revise no-op explicitly (e.g. `passed({ applicable: false })` or a `mode`-scoped report field) so "checked and clean," "not applicable because the ledger says revise," and "never ran" are three distinguishable report states rather than one.

---

### AUDIT-20260730-17 — `grounded` record with zero beats passes grounding untouched — invented prose can be labeled grounded

Finding-ID: AUDIT-20260730-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/policy/grounding.ts:99-118 (the "grounded beats resolve" loop), doc claim at grounding.ts:14-21

The module's stated reason to exist is that "a source-directed ledger silently permits invented prose (a paragraph with no beat behind it)" (line 14), so grounding must be exhaustive and exclusive. But the beat-resolution loop is `for (const beat of record.beats ?? []) { … }` — universally quantified over the beats that are present, and therefore **vacuously satisfied when `beats` is `undefined` or `[]`**. A grounding record of `{ edition_unit: X, basis: 'grounded', beats: [] }` produces: no `unaccounted` failure (a record exists for X), no `duplicate` (count is 1), no `dangling-record` (X is in the edition), and no `dangling-beat` (nothing to iterate). `checkGrounding` returns `ok: true`.

That is exactly the hole the module claims to close: a composed paragraph asserting `basis: 'grounded'` with nothing behind it is accepted as grounded by the "ONE source of truth" that both the producer preflight (`revise/cli.ts:158`) and the validator import. The `?? []` on line 108 is itself the evidence that `beats` is optional in the `GroundingRecord` type (it must be, for non-`grounded` bases). Even if `schema/ledger.ts` happens to require the field for `basis: 'grounded'`, an *empty array* still needs a `minItems`-style constraint, and the normative policy module — not only the wire schema — is where the refusal belongs, since this module is the thing the validator's verdict rests on.

Blast radius: a compose run that fabricates prose and self-labels it `grounded` emits with zero refusals from either entry point, and the validator subsequently certifies it. An unattended producer agent optimizing for "pass the gate" reaches this shape naturally (it is strictly easier than naming real beats). Fix: add a failure kind (e.g. `'grounded-without-beats'`) emitted when `record.basis === 'grounded' && (record.beats?.length ?? 0) === 0`, with a fixture per basis value in the enum.

### AUDIT-20260730-18 — R4 whole-unit no-copy is keyed on declared coverage destinations, so a byte-identical copy escapes by being declared elsewhere

Finding-ID: AUDIT-20260730-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/policy/op-legality.ts:119-143 (`collectWholeUnitCopies`), invoked at op-legality.ts:98

R4 is enforced pairwise: for coverage entry E, look up E's source beat, then compare only the units named in `E.edition_units`. Nothing checks the derived edition *as a whole* against the derived source *as a whole*. That makes the check evadable by declaration rather than by content:

Let beat `B` be composed into edition unit `U1` (`represented`, genuinely rewritten) — `collectWholeUnitCopies` compares `U1` vs `B`, hashes differ, clean. Now let the edition also contain `U2`, which is byte-identical to `B`, and let `U2` be accounted for only on the grounding side (`{ edition_unit: U2, basis: 'grounded', beats: [B] }`). Grounding is happy: `U2` has exactly one record, `B` resolves. Op-legality never sees `U2`, because `U2` is not in any coverage entry's `edition_units`. Result: a whole-unit verbatim lift of a source beat ships in a compose edition with **zero refusals from either entry point**, defeating the rule the header comment states at op-legality.ts:24-25.

The asymmetry is the tell: grounding is deliberately exhaustive over *derived* edition units (it does not trust declarations — grounding.ts:72), while no-copy trusts declarations exclusively. Blast radius: compose's central promise ("no copy — a spine beat must be re-voiced, not pasted") is enforceable only against a cooperative producer; a producer that mis-declares gets a clean gate and a passing validator. Fix: in compose mode, additionally check the edition set against the source set — for every derived edition unit, fail `whole-unit-copy` if its `contentHash` matches *any* derived source beat's `contentHash`, independent of coverage declarations. Keep the pairwise check for its better message, but make the exhaustive sweep the load-bearing one, and add a fixture for the "copy declared under a different beat" shape.

### AUDIT-20260730-19 — Compose preflight drops illegal `cut`/`verbatim` failures before emit

Finding-ID: AUDIT-20260730-19
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/cli.ts:155-172; voice-tooling/src/policy/op-legality.ts:85-99; adjacent surface voice-tooling/src/revise/preflight.ts:84-94

`checkOpLegality('compose', ...)` correctly reports `compose-forbids-verbatim` and `compose-forbids-cut` at `op-legality.ts:85-99`, but the producer path only gates writes through `runPreflight` at `cli.ts:160-172`. In the current adjacent preflight implementation, compose calls `checkOpLegality('compose', ...)` and then filters failures down to only `whole-unit-copy`, explicitly discarding `compose-forbids-cut` and `compose-forbids-verbatim`.

This matters because `buildEdition` can still construct a compose ledger containing `cut` entries: it accepts `declared.op === 'cut'` when a reason is present and returns a `CoverageEntry` with `op: 'cut'`. A model response with exhaustive grounding plus a `cut` therefore reaches `emitEdition`, despite the compose policy saying `cut` is illegal and the producer pre-emit contract saying refusal writes nothing. The validator may catch it later, but a downstream consumer invoking only `voice compose` receives a successful written artifact that violates compose-mode op legality. A reasonable fix is for compose preflight to include all compose op-legality failures, or at least both illegal-op kinds plus `whole-unit-copy`, before allowing `emitEdition`.

### AUDIT-20260730-20 — `grounding: []` is accepted, conflating "compose declared nothing" with revise's legitimate "absent"

Finding-ID: AUDIT-20260730-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/protocol.ts:121-124, 193-198 (`parseGroundingArray`) — cross-file: `voice-tooling/src/policy/grounding.ts`, `voice-tooling/src/fidelity/check-edition-grounding.ts`

`parseModelOutput` distinguishes exactly two states: `grounding` absent (`undefined` → field omitted from `ModelReviseOutput`, the documented revise path) and `grounding` present-and-array. It does **not** reject an *empty* array: `parseGroundingArray([])` passes `Array.isArray`, maps over zero elements, and returns `[]`, so a compose run whose model emits `"grounding": []` alongside a multi-unit `edition` produces `{edition, coverage, grounding: []}`. That the same commit explicitly rejects the empty case one level down — `parseGroundingBeats` fails with "basis 'grounded' requires a non-empty beats array" (protocol.ts:236-241) — is evidence the top-level empty case was simply not considered, not a deliberate choice.

The blast radius depends on the skip predicate in `policy/grounding.ts`. The module doc for `revise` says absence "is fine" (protocol.ts:22-24), and the prior policy tests in the barrage's other chunks include a "skip-behavior" case (commit c1e2595, `policy-grounding.test.ts`). If that skip is keyed on *emptiness / falsy records* rather than strictly on `mode === 'revise'`, then `"grounding": []` is a total bypass of the edition-grounding gate: every edition unit goes unaccounted, exhaustiveness has nothing to iterate, and the run reports clean. That is the feature's headline mechanical claim (FR grounding accounting) silently vacated by a two-character model output — precisely the class of thing an unattended producer loop would never notice, because the validator says PASS.

A reasonable fix is to make the emptiness decision at the mode-aware boundary rather than in the mode-blind parser: have the compose path (validator + producer preflight, per `run-mode.ts` / `check-edition-grounding.ts`) refuse when `grounding` is absent **or** empty while `edition` derives ≥1 unit, and add a fixture for `"grounding": []` in compose mode next to the existing missing-grounding fixture (`test/fixtures/spine/compose-missing-grounding-runner.ts`) — that fixture covers *absent*, and the empty-array channel is a distinct reachable state with no fixture.

### AUDIT-20260730-21 — `coverage` and `grounding` assert two independent beat↔edition mappings that nothing reconciles

Finding-ID: AUDIT-20260730-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/prompt/compose.ts:49-54, 70-72; voice-tooling/src/revise/protocol.ts:56-70 (`ModelGroundingEntry`) — cross-file: `voice-tooling/src/policy/grounding.ts`

The compose protocol has the model declare the beat→edition relation **twice, in two shapes that can disagree**. `coverage` says "beat *n* lands in edition units [a,b]" (compose.ts:49-50). `grounding` says "edition unit *a* has basis grounded/connective/framing, and if grounded these beats" (compose.ts:51-54). Nothing in the prompt states that these two must agree, and `protocol.ts` structurally cannot check it — it validates each array in isolation (`parseCoverageEntry`, `parseGroundingEntry`) and the module doc scopes itself to "the DECLARED SHAPE" only (protocol.ts:19-22).

The consequence is that `basis` is an unanchored self-label. A model may declare `coverage[0] = {op: "represented", edition_units: [3]}` and simultaneously `grounding = [{edition_unit: 3, basis: "framing"}]` — beat 0 provably lands in unit 3 per its own coverage claim, yet unit 3 asserts it is chapter framing "not itself a beat" and thereby escapes the grounded-beats obligation entirely. Nothing bounds how many units may claim `framing`/`connective`, so the pathological output ("every unit is framing") satisfies grounding vacuously. This matters because the grounding check is the surface the T029 docs sell as the mechanical half of the trust boundary; if `basis` is unfalsifiable, edition-grounding is producer-instruction, not mechanism, and the documentation overclaims. The one cross-check that *would* anchor it is free and already present in the payload: any edition unit named in some non-cut `coverage[n].edition_units` cannot be `connective` or `framing` — it demonstrably carries beat *n*.

A reasonable fix is to add that reconciliation in `policy/grounding.ts` (mode `compose`): for every non-cut coverage entry, every declared destination unit must appear in `grounding` with `basis === 'grounded'` and with that beat index in its `beats`; conversely a `grounded` entry's `beats` must be a subset of the beats whose coverage names that unit. Add a fixture where coverage and grounding contradict each other — the fixture list in the other chunks (`check-edition-grounding.test.ts`, `edition-grounding-run.test.ts`) shows exhaustiveness/exclusivity fixtures but no coverage↔grounding contradiction case, so this channel is currently untested. Please verify against `policy/grounding.ts` before acting; if the cross-check already exists there, this reduces to a prompt gap (the contract is never stated to the model at compose.ts:51-54).

### AUDIT-20260730-22 — Prompt schema asks for `beats` on records the parser rejects

Finding-ID: AUDIT-20260730-22
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/prompt/compose.ts:59-72; voice-tooling/src/revise/protocol.ts:224-233

The compose prompt’s compact output shape shows every grounding entry as `{ "edition_unit": ..., "basis": "grounded|connective|framing", "beats": [...] }` at `compose.ts:63`, but the parser explicitly rejects `beats` whenever `basis` is `connective` or `framing` at `protocol.ts:230-232`. The later explanatory text says to omit `beats` for those bases (`compose.ts:70-72`), so the prompt contradicts itself on a model-facing wire contract.

Blast radius is high because a model following the JSON shape literally can emit legitimate connective/framing records with `beats: []` or `beats: [0]`, and the producer will reject before ledger build despite the record being conceptually valid. A reasonable correction is to make the output shape a clear union, e.g. grounded records include non-empty `beats`, while connective/framing records do not include `beats`.

## 2026-07-30 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260730-23 — REVISE leaves numerals inside an open-question marker required by neither multiset — and the new mode-scope fixture enshrines the hole

Finding-ID: AUDIT-20260730-23 (claude-01 + claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/test/open-question-marker-mode-scope.test.ts:20-67 (with voice-tooling/test/payload-extract.test.ts:136-142)

Two facts are asserted directly in this diff. (1) `extractPayload` masks marker-span digits out of `numerics` **unconditionally** — `payload-extract.test.ts` ("the embedded digit is masked out of numerics") calls `extractPayload('[OPEN-QUESTION: What caused the anomaly in sample 2?]')` with no mode argument and asserts `numerics: []`; the signature has no mode parameter anywhere in the file. (2) The marker obligation is now compose-only — `open-question-marker-mode-scope.test.ts:67` asserts `result.payloadChecked.openQuestionMarkers === 0` in revise, i.e. the gate lives at the `checkOpObligations` layer, not at the extract layer. Compose those and the invariant the D3 fix states for itself ("the byte span the marker payload requires is exactly the span the numeric extractor masks") is **false in revise**: the extractor still masks the span, but nothing requires it. Any numeral an author writes inside `[OPEN-QUESTION: …]` in a revise source is unenforced payload — exactly the AUDIT-14 unenforced-bytes shape, reopened in the other mode by the AUDIT-08 fix.

The fixture proves it rather than catching it. `SOURCE_TEXT` (line 24) is `Beta beat raises a question. [OPEN-QUESTION: What caused the anomaly in sample 2?]` — the marker contains the numeral `2`. `EDITION_DROPS_MARKER` deletes the whole marker, `2` included, and line 55-60 asserts `result.ok === true`. So the suite now *defends* silent loss of a marker-interior numeral in revise. Blast radius: a revise run over a spine whose open question cites a figure (`[OPEN-QUESTION: does the 42-unit cohort hold?]`) can drop or alter `42` and still receive a PASS — a fidelity primitive reporting a guarantee it is not making, which is the failure mode this whole feature exists to prevent.

Invariant-first fix: the masking predicate and the obligation predicate must be the same predicate. Either gate the numeric masking on the same compose scope (so revise re-exposes marker-interior numerals as ordinary prose numerals, which is consistent with "in revise it is ordinary prose"), or keep the marker required in revise and model resolution as an explicit op rather than as unchecked deletion. Separately, this fixture should use marker text containing no numerals or citations so it asserts only the scope property, with a companion case asserting that a revise edition dropping `42` from inside a marker *is* refused via the numeric multiset.

### AUDIT-20260730-24 — The bracket-aware scanner's unbalanced-inner-`[` branch has no fixture — the two plausible behaviors are byte-loss and prose-swallowing

Finding-ID: AUDIT-20260730-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=reachable, fix-debt=no; reachable, high blast radius — NOT calibrated down (real signal preserved, SC-003).
Surface:    voice-tooling/test/payload-extract.test.ts:159-216 (the D3 nested-bracket block)

The fix replaced `/\[OPEN-QUESTION:[^\]]*\]/` with a bracket-aware span (D3 (c) proves `foo[0]` stays *inside* the marker, so the scanner must track nesting). That is a new parser branch, and the D3 block enumerates only **balanced** nested shapes: `[^ref-4]` (a), `[ABC-1]` (b), `foo[0]` (c), a numeral after the inner `]` (d), plus round-0 cases for an unterminated *outer* marker and two adjacent markers. The unbalanced-inner-bracket channel — `[OPEN-QUESTION: is foo[0 valid?] and 42 more.` — is unfixtured in every file in this chunk.

Both reachable outcomes are defects, which is why the missing fixture matters more than usual. If the scanner requires depth to return to zero, it never closes: the real marker is dropped entirely, the report's `open_question_markers` field (computed from "the spine declares at least one marker", per `open-question-marker.test.ts:8-11`) may still read `enforced` while nothing is enforced. If instead it consumes forward to the next `]` in downstream prose, the marker span over-merges and swallows unrelated prose into a required-payload multiset **while masking that prose's numerals out of `numerics`** — a new unenforced-bytes hole manufactured by the fix for the previous unenforced-bytes hole. The round-0 self-red-team driver applies squarely: this is what the fix *moved* rather than removed.

Blast radius: a single stray `[` in a hand-authored spine question silently changes which bytes the pipeline enforces, in a mechanism whose entire value is that operators can trust its scope claim. Fix: add fixtures for unbalanced-inner-`[` and unbalanced-inner-`]`, and state the scanner's invariant for malformed nesting explicitly (my recommendation: treat a marker whose nesting does not balance as *not a marker*, so it degrades to ordinary prose and no numerals are masked — matching the existing unterminated-outer behavior at round-0).

### AUDIT-20260730-25 — `check-op-obligations-compose.test.ts` documents `loadLedger` as defaulting an absent mode to `'revise'`, directly contradicting the AUDIT-06 fail-closed note added in the same chunk

Finding-ID: AUDIT-20260730-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/check-op-obligations-compose.test.ts:9 (and voice-tooling/test/classify-op-failures.test.ts:61-63)

Line 9 of the new test's header states the mode field is `(schema/ledger.ts, defaulted to 'revise' by \`loadLedger\`)`. The other file in this same chunk states the opposite policy: `classify-op-failures.test.ts:61-63` — "D6 (AUDIT-06): `checkOpObligations` no longer fail-open-defaults an absent mode; a ledger reaching it must be stamped." Commit `bc1c626` claims "no fail-open mode default (AUDIT-06/09)". The two statements are only reconcilable if the default was moved *up* into `loadLedger` rather than removed — which is precisely the fail-open AUDIT-06 was closing, just relocated one layer earlier: an edition whose YAML ledger omits `mode:` would then be validated as `revise`, and `compose`'s illegal dispositions (`verbatim`, `cut` — i.e. whole-unit copying from the spine) would pass unflagged.

Blast radius: the validator is the *independent* half of the trust boundary — its whole job is to judge a ledger it did not produce. If `loadLedger` still supplies `'revise'` for an unstamped ledger, an adversarial or hand-edited compose edition escapes compose op-legality entirely while the report prints `mode: revise` and `verdict: passed`. Even in the benign reading (line 9 is merely stale narration and `loadLedger` now refuses an unstamped ledger), an unattended agent reading line 9 as current will build against a defaulting `loadLedger` — reintroducing the hole in the next change. The readings are not resolvable from anything in the diff, which is what pushes this above `medium`.

Fix: verify `loadLedger`'s actual behavior on a ledger with no `mode:` key. If it defaults, make it refuse (fail-closed) and add a fixture pinning the refusal; if it already refuses, correct line 9 — no comment in the repo should describe a mode default that no longer exists.

---

### AUDIT-20260730-26 — D8 forward reconciliation is only fixtured against a `framing` self-label — a `grounded` record that OMITS a beat coverage proves it carries has no test

Finding-ID: AUDIT-20260730-26
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/policy-grounding.test.ts:287-317 (`D8 forward -- a unit coverage proves carries a beat cannot be labeled framing`)

The forward reconciliation test builds coverage `beat0 -> e0`, `beat1 -> e1`, then makes `e0` self-label `framing` and asserts one `basis-contradicts-coverage`. That fixture only distinguishes *basis label* — it passes under an implementation whose forward check is merely "a unit named by any coverage entry must have `basis: 'grounded'`". The stronger reading the file's own header claims (line 26-28: coverage and grounding are "two views of the SAME beat<->edition mapping") requires the forward check to be per-beat: if coverage proves `e0` carries beats `s0` and `s1`, a record `{e0, grounded, beats: [s0]}` must also be refused, because it drops a beat coverage declared. No fixture in this file exercises that shape — every `grounded` fixture supplies coverage that names exactly the beats the record names (`cov(ref(s0), ref(e0))` at lines 71, 88, 106, 129, 372).

Blast radius: an under-declaring `grounded` record is the exact invented-prose adjacency D8 exists to close, read from the other end — the unit legitimately carries beat `s0`, so it is honestly "grounded", but the prose derived from beat `s1` is now unaccounted-for provenance while the accounting reports `ok: true`. Since `checkGrounding` is the single source of truth for both the producer preflight and the validator (header lines 5-7), a downstream consumer — including an unattended agent trusting the validator's pass — gets a green grounding report over an edition whose beat→unit mapping the two views disagree about. The suite cannot tell whether the shipped implementation closes this or not, which is the defect: the test claims to test bidirectional reconciliation and only pins one direction's coarse form.

Fix: add a fixture where coverage maps `s0 -> e0` **and** `s1 -> e0`, and the record is `{e0, grounded, beats: [ref(s0)]}`, asserting `basis-contradicts-coverage` naming `s1`. If the intended contract is deliberately looser (grounding beats may be a strict subset of coverage-declared beats), state that invariant plus its in-scope exception in the header and add the passing fixture that pins it, so the looseness is a decision rather than an untested gap.

### AUDIT-20260730-27 — Behavior with empty `coverage` and an honest `grounded` record is unpinned — both fail-open and refusal-storm implementations pass this suite

Finding-ID: AUDIT-20260730-27
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/policy-grounding.test.ts:30-33, 178-186, 253-259

`coverage` is a newly added 4th parameter (header lines 30-31). The suite exercises exactly two empty-coverage shapes: connective-only records (lines 178-186, expected pass) and a `grounded` record with **no** beats (lines 253-259, expected `grounded-without-beats`). The one combination that actually discriminates the reconciliation's default posture — empty coverage plus a `grounded` record naming **real, resolvable** beats — is never fixtured.

That combination is the most likely regression channel for a freshly threaded argument. It has two mutually exclusive plausible behaviors and this suite accepts both: (a) fail-closed — D8 reverse fires `basis-contradicts-coverage` for every beat, because no coverage entry maps it, turning any caller that forgets to thread coverage (or threads a revise-shaped ledger with no coverage entries) into a total refusal storm on honest editions; or (b) fail-open — reconciliation is skipped when `coverage.length === 0`, in which case a producer can suppress the entire D8 check by emitting zero coverage entries, restoring `basis` to the unfalsifiable self-label AUDIT-21 was filed against.

Blast radius: under (b) the fix is defeated by a one-line producer behavior and no test notices; under (a) an unrelated caller wiring change silently converts passes into refusals with a misleading failure kind. Both are consequences an unattended consumer would act on. Fix: add two fixtures — `checkGrounding([{e0, grounded, beats:[s0]}], ed, src, [])` asserting the intended kind (and asserting it is *not* silently `ok: true` if fail-closed is intended), and a companion documenting whether an empty coverage view is legal input at all versus a caller error.

### AUDIT-20260730-28 — D8 reconciliation is only ever exercised with `op: 'represented'` — the `op` value channel is unfixtured

Finding-ID: AUDIT-20260730-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/policy-grounding.test.ts:46-52 (`cov` helper), used at 71, 88, 106, 129, 231, 299-300, 336, 372

The `cov` helper hardcodes `op: 'represented'`, and every coverage entry in the file — including both D8 tests and the D8 all-consistent pass — flows through it. So the entire reconciliation is pinned over a single value of a multi-valued field. Nothing in this file distinguishes an implementation that reconciles *all* coverage entries from one that filters to `op === 'represented'`.

This is precisely the channel-enumeration hazard: D8 adds a new fold over coverage, and the fold's selector is untested. If the implementation filters on `op === 'represented'`, then every legal-in-compose non-`represented` op (whatever the op-legality module admits for compose — compressed / merged / reordered / paraphrased-shaped ops) reopens the original AUDIT-21 hole in full: a unit coverage proves carries a beat under a non-`represented` op can still self-label `framing` or `connective` and escape the grounded obligation, and the suite is green. Conversely, if the implementation reconciles indiscriminately, then a `cut`-shaped entry (a beat deliberately dropped, whose `edition_units` should be empty or absent) needs a fixture proving it creates no obligation — otherwise a legal cut becomes a spurious `basis-contradicts-coverage`.

Blast radius: silently reduces D8 from "basis is falsifiable" to "basis is falsifiable for one op," which a consumer reading the header (lines 26-28) and the test names would never suspect. Fix: parameterize `cov` with `op`, and add (1) a forward fixture using each compose-legal non-`represented` op asserting the contradiction still fires, and (2) a fixture for the drop-shaped op asserting it imposes no grounding obligation.

### AUDIT-20260730-29 — `finalize`'s `openQuestionMarkers` default `'none-declared'` fabricates a trust-boundary fact whenever a caller omits it

Finding-ID: AUDIT-20260730-29
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run-outcome.ts:32-38, 66; voice-tooling/src/fidelity/report.ts:140-160

`finalize(...)` declares `openQuestionMarkers: 'enforced' | 'none-declared' = 'none-declared'` as a defaulted trailing positional parameter, and passes it straight into `composeTrustBoundaryFields` for any compose run. `open_question_markers` is not a nullable diagnostic — `report.ts:141-160` documents it as a *reported fact about the spine*: `'none-declared'` means "the spine declared no marker", and the AUDIT-02 paragraph tells the reader that a passing report with `'none-declared'` can be read as "no marker guarantee was in play AND the edition invented none." A defaulted value makes that statement unfalsifiable: any caller that forgets the argument, or any compose path that reaches `finalize` *before* `sourceDeclaresOpenQuestionMarker` has been computed (the early-abort paths that `finalize`'s own comment at lines 40-44 acknowledges — `source_hash` / `ledger_structure` / `unit_accounting` failures return early), emits an affirmative "the spine declared no marker" about a spine that may declare several.

The docblock on `composeTrustBoundaryFields` defends only one direction — "it never invents an `'enforced'` claim on its own" — but the invented `'none-declared'` is the *permissive* direction, the one that tells a reader no marker guarantee was in play. This is precisely the fallback-that-hides-a-failure-mode shape the project guidelines ban outside test code: the honest behavior for "we don't know yet" is to omit the field (the type is already optional, `report.ts:141`), not to assert the safe-looking value.

Blast radius: a compose report that aborts early, or a future second call site, reports a spine's enforced markers as `none-declared`. An unattended consumer diffing reports, or an operator auditing whether marker survival was in play for a given edition, gets a confident wrong answer with no signal that the value was never computed. Fix: make the parameter required and non-defaulted, and have the abort paths pass an explicit third state (or omit the field entirely by passing `undefined` and making `composeTrustBoundaryFields` spread it conditionally). While there, consider replacing the six-positional-parameter signature with a single options object — `finalize(checks, failures, true, mode, modeComparison, marks)` is exactly the shape where a caller silently drops a trailing argument.

---

### AUDIT-20260730-30 — Compose-only checks are not required for a passing verdict

Finding-ID: AUDIT-20260730-30
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/report.ts:181-197

`REQUIRED_CHECKS` now requires `mode_agreement`, but it still omits the newly introduced compose-side checks: `edition_grounding`, `no_copy`, and `open_question_fabrication`. `computeVerdict` only guards against absent obligations by iterating this list, so a caller that assembles an otherwise passing compose report without one of these checks can still receive `verdict: 'passed'`.

This matters because the diff’s own contract language says these checks provide pass-side evidence and prevent consumers from confusing “checked and clean” with silence. The live `runFidelity` path does populate them, but `computeVerdict` is the shared verdict primitive and its required vocabulary is the fail-closed boundary. The reasonable fix is to include the compose-only check keys in the required vocabulary, using explicit `passed`, `not-run`, or `aborted` states as appropriate for revise and earlier-abort paths.

### AUDIT-20260730-31 — Hash-keyed grounding refs collapse byte-identical units, so "exactly one grounding record per edition unit" is not decidable

Finding-ID: AUDIT-20260730-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/ledger-build.ts:178-202 (`resolveGrounding` → `unitRefOf`), plus the ref-keyed grounding consumers in `voice-tooling/src/policy/grounding.ts`

`resolveGrounding` converts each model-declared `edition_unit` **index** into a content-addressed `UnitRef` via `unitRefOf(editionUnit)` (documented as "bare-hex `contentHash` -> `sha256:<hex>`"). Index identity is therefore destroyed at resolution time: two derived edition units with identical bytes produce the *same* `UnitRef`. The compose contract advertised in this very diff (`help.ts`, MECHANICAL tier: "every edition unit carries exactly one grounding record") is stated over *units*, but the ledger only carries *refs*. Under a byte-identical duplicate the downstream policy has no way to distinguish "unit 3 grounded, unit 7 ungrounded" from "both grounded" — a set/membership-keyed check silently **accepts** an ungrounded unit (the core guarantee of the feature evaporates), while a cardinality-keyed check ("exactly one record per ref") **falsely refuses** a legitimate edition that grounded both duplicates. Both failure modes are silent-and-wrong from the operator's seat.

Evidence: `edition_unit: unitRefOf(editionUnit)` at the end of the `declared.map` callback, with no index, ordinal, or offset carried alongside; the same shape applies to `beats: [...unitRefOf(beatUnit)]` resolved against `sourceUnits`. The trigger is not exotic — spines are short beat lines, and duplicate one-line beats, repeated section markers, or a repeated `[OPEN-QUESTION] …` line all derive to colliding units. The pre-existing `coverage` mapping has the same shape, but this diff is what extends the scheme to grounding, where the "exactly one" cardinality claim is newly load-bearing.

A reasonable fix is to make the ref carry index identity (e.g. `{ index, ref }` or an `occurrence` ordinal on the `UnitRef`) so per-unit grounding is decidable, **or** to refuse loudly at resolution time when `editionUnits`/`sourceUnits` contain byte-identical members — a refusal is honest; a collision that reconciles by accident is a bug factory. Either way this needs a fixture with two byte-identical edition units and a fixture with two byte-identical beats.

### AUDIT-20260730-32 — Model-leading frontmatter bypasses producer preflight’s unit view

Finding-ID: AUDIT-20260730-32
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/ledger-build.ts:75-76, voice-tooling/src/revise/ledger-build.ts:140-141

`buildEdition` derives `editionUnits` from `args.model.edition` before it prepends the provider ledger frontmatter. `deriveUnits` strips exactly one leading frontmatter block, so if the model returns an edition body that itself starts with `--- ... ---`, lines 75-76 silently derive units with that model-supplied block stripped. Lines 140-141 then prepend the real ledger block and write the model body unchanged, meaning the validator later strips only the provider ledger and sees the model-supplied frontmatter as edition content.

That makes the producer preflight check a different unit set than the emitted artifact. A compose model can produce leading frontmatter, pass grounding/no-copy preflight against the stripped body units, and still emit an edition whose validator-facing units have an extra or shifted first unit. The blast radius is high because this breaks the stated “before any write” self-check contract for a plausible model output shape: downstream consumers get a written artifact that the producer’s own preflight did not actually check as emitted. A reasonable fix is to refuse model editions that begin with complete frontmatter, or derive preflight/ledger refs from the exact post-ledger artifact body representation the validator will see.

### AUDIT-20260730-33 — Marker comparison is a `Set`, so an edition that multiplies one spine marker N times passes both fabrication and survival, and no fixture covers the channel

Finding-ID: AUDIT-20260730-33 (claude-07 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/fidelity/check-open-question-fabrication.ts:71-77

Both sides are deduplicated: `spineMarkers` is a `Set` (line 63) and the edition scan skips repeats via `seen` (lines 74-76), commented as *"one refusal per DISTINCT fabricated marker (mirrors `checkCitations`)"*. But the header at line 16 describes citations as governed by a **multiset** (*"the citation multiset's concern (`checkCitations`)"*), so the mirroring claim holds for the refusal-reporting granularity while silently diverging on occurrence-sensitivity. The consequence: a spine that declares one `[OPEN-QUESTION: X]` and an edition that repeats it across five units passes fabrication (byte-present), and passes survival too, since source-subset-of-destination containment (lines 5-6) is satisfied by 1 ⊆ 5.

Per the channel-enumeration driver, this is the value channel the new surface opens and it has no fixture: the test files visible in the other chunks cover the nested-citation case (`open-question-marker-nested.int.test.ts`), mode scope (`open-question-marker-mode-scope.test.ts`), and fabrication (`open-question-marker-fabrication.int.test.ts`), but nothing named for amplification. Blast radius is low — repeating the same open question is a weaker overclaim than inventing one, and occurrence-sensitivity was deliberately hardened for the *policy* layer in `c1e2595` rather than here — so the right outcome may well be to accept it. But the acceptance should be stated as the invariant ("marker presence is set-valued; multiplicity is not an overclaim because the claim is identical") with a fixture pinning the behavior, rather than left as an undocumented consequence of a `Set` chosen to bound refusal noise.

### AUDIT-20260730-34 — `op: 'represented'` with empty/absent `edition_units` is an undeclared cut that op-legality accepts in both modes

Finding-ID: AUDIT-20260730-34
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/policy/op-legality.ts:92-118, 136, 232

`checkOpLegality` treats destination-set emptiness as a non-event everywhere. In compose, `entry.op === 'cut'` is refused (`compose-forbids-cut`, ~line 99), but an entry declaring `op: 'represented'` / `'merged'` with `edition_units: []` (or the field absent — the three `?? []` sites at ~136, ~198 in grounding.ts, and ~232 prove the code treats it as optional) falls into the `else` branch at ~104, calls `collectWholeUnitCopies`, whose `for (const destRef of entry.edition_units ?? [])` iterates zero times, and reports nothing. The beat is declared "represented" and lands nowhere. That is precisely a cut, spelled differently, and compose v1's stated invariant is that cut is illegal. The same shape defeats revise's "cut requires a reason" obligation (docstring table, ~line 23): declare the vanished beat `represented` with no destinations and no reason is ever demanded.

Nothing else in this chunk closes it. The AUDIT-18 exhaustive sweep is *edition*-side — it compares derived edition units against derived beats and can only find prose that exists; it structurally cannot see a beat that produced no prose. `checkGrounding` is likewise edition-side (every edition unit has a record); a beat with zero destinations creates no edition unit and therefore no grounding obligation. And the D8 forward reconciliation iterates `entry.edition_units ?? []` too (grounding.ts ~198), so an empty destination list contributes no `coverageBeatsByDest` entry and no contradiction.

Blast radius: a producer (or a model emitting a ledger) that silently drops source material passes the full compose gate clean. The feature's headline claim — compose cannot cut in v1 — is bypassable with a one-token declaration change, and the validator reports OK. Fix: in `checkOpLegality`, refuse a non-`cut` coverage entry whose resolved destination set is empty, as its own failure kind (e.g. `op-without-destination`), in both modes; and if the wire type genuinely makes `edition_units` non-optional, delete the `?? []` guards so the type carries the invariant instead of the code silently absorbing it.

---

### AUDIT-20260730-35 — Invented prose escapes grounding entirely by self-labeling `basis: 'connective'`; the AUDIT-04/17 fix only closed the `grounded`-with-zero-beats channel

Finding-ID: AUDIT-20260730-35
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/policy/grounding.ts:132-155, 226-243

The module header states the purpose plainly (lines 12-15): "a source-directed ledger silently permits invented prose (a paragraph with no beat behind it), grounding must be both EXHAUSTIVE and EXCLUSIVE." The `grounded-without-beats` check (~136-144) closes exactly one channel: a record that says `grounded` and cites nothing. Enumerate the adjacent channels the same surface opens and the hole is obvious — `if (record.basis !== 'grounded') { continue; }` at ~133 means a record labeled `connective` or `framing` is exempt from *every* beat obligation in this module.

Now trace an invented paragraph through the full policy. It is a derived edition unit, so it needs a record — EXHAUSTIVE satisfied by emitting one. It is not a destination of any coverage entry (coverage is source-directed; no beat points at it), so `coverageBeatsByDest` has no entry for it and the FORWARD reconciliation at ~226-243 never examines it. Its basis is not `grounded`, so the REVERSE check at ~245-262 skips it and `grounded-without-beats` skips it. Result: `{ ok: true }`. One `basis: 'connective'` label launders an arbitrary quantity of fabricated prose past the check whose stated job is catching fabricated prose, and nothing in the module bounds how much of an edition may be `connective`/`framing`.

Blast radius: this is the quietly-plausible failure — the gate reports clean, so a downstream consumer reads "grounding verified" as "every sentence traces to source." A reasonable fix is to make the non-grounded bases carry their own obligation rather than being an exemption: require `connective`/`framing` records to be structurally bounded (e.g. refuse a `connective` unit that exceeds a declared size/whitespace-normalized token threshold, or require every non-grounded unit to be adjacent to a grounded one), and at minimum surface the connective/framing *count and byte fraction* in the validator report so the escape hatch is visible rather than silent. If bounding is genuinely out of scope for v1, the boundary belongs stated as an invariant in the header ("grounding proves provenance for grounded units only; connective volume is not-checkable and is reported, not refused") — the current header instead claims the module catches invented prose, which it does not.

---

### AUDIT-20260730-36 — Marker-survival and whole-unit no-copy are mutually unsatisfiable for a marker-only spine beat, and no fixture pins which invariant wins

Finding-ID: AUDIT-20260730-36
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/open-question-marker-fabrication.int.test.ts:8, :81-96 (interacts with `no_copy`, exercised at voice-tooling/test/mode-agreement-run.int.test.ts ≈62-93)

This chunk establishes two invariants that, in the compose channel, both bind the *same bytes*. The fabrication header states the survival/fabrication rule as byte-containment: "every edition marker must be byte-present in the spine" (line 8), and the faithful test at :81-96 proves the edition must carry `MARKER` byte-for-byte (`Beta rewritten, still raising it. ${MARKER}`) to pass. Meanwhile the sibling test file's fixture comment is explicit that a byte-identical edition unit is a genuine `no_copy` violation — "Unit 0 is byte-identical to source beat 0 ("Alpha beat.") -- a whole-unit copy … so `no_copy` is genuinely LIVE and would FAIL were it ever reached."

Now take a spine beat whose entire content is an open question — e.g. a beat that reads exactly `[OPEN-QUESTION: What caused the anomaly in sample 2?]`. That is a completely plausible spine beat: a spine is a beat list, and "this is unresolved" is a beat. The grounded edition unit for that beat must reproduce the marker verbatim (survival), and the marker is the beat's whole content, so the unit is a whole-unit copy (no_copy fails). The only escapes are (a) padding the unit with prose the spine does not supply — which the grounding/uncorroborated machinery is specifically built to refuse — or (b) dropping the marker, which the survival check refuses. Every branch refuses.

Blast radius: an unattended producer loop composing from any spine containing a marker-only beat cannot ever produce a passing edition. It will burn retries and terminate in a refusal whose two named failures point in opposite directions (`no_copy` says stop copying, marker enforcement says preserve exactly), with nothing in the artifact telling the operator or the agent that the input is unsatisfiable rather than the model being bad at its job. That is worse than a plain failure: it is a failure mode that reads as a model-quality problem. The fix is to state the boundary as an invariant plus an in-scope exception — e.g. "no_copy's invariant is that no edition unit reproduces a source beat's *authored prose* verbatim; a unit whose entire content is a preserved `[OPEN-QUESTION: …]` span is the in-scope exception because marker bytes are mandated by FR-013, not chosen by the model" — and to add a fixture with a marker-only spine beat asserting the resulting pass (or an explicit, named "spine beat is marker-only, not composable" refusal, if that is the chosen semantics).

---

### AUDIT-20260730-37 — SC-006 backward-compat test asserts the *defaulted* mode, not the fixture's absent-`mode` precondition — the guard can silently decay to a tautology

Finding-ID: AUDIT-20260730-37
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise-verbatim-preflight.int.test.ts:145-172

The SC-006 regression test's entire load-bearing claim is stated in its own comment: *"The fixture ledger itself carries neither `mode:` nor `grounding:` — the exact pre-006 shipped shape. `loadLedger` must still load it, defaulting the absent `mode` to `'revise'`."* But the assertions run **after** `loadLedger`:

```ts
const ledger = loadLedger(extractLedgerYaml(edition));
assert.equal(ledger.mode, 'revise', 'an absent ledger `mode` must default to "revise" on read...');
assert.equal(ledger.grounding, undefined, 'a pre-006 ledger declares no grounding at all');
```

`ledger.mode === 'revise'` is satisfied both by "the key was absent and the default fired" and by "the fixture literally says `mode: revise`". Nothing in the test observes the raw frontmatter. The fixture is shared (`test/fidelity-pass.test.ts` also pins it, per the comment), so any future edit that stamps `mode: revise` into `faithful-edition.md` — a plausible, well-intentioned normalization once every new edition carries the field — leaves this test green while the absent-key path it exists to protect stops being exercised anywhere. Same argument for `grounding`: a revise ledger omits grounding by construction, so `undefined` proves nothing about the fixture.

Blast radius: this is the *only* guard in this chunk for the 54 shipped pre-006 editions. If it decays to a tautology and `loadLedger`'s default is later removed or narrowed (a live risk — commit `bc1c626` explicitly removed a fail-open mode default elsewhere), every shipped edition starts failing validation with no test having caught it. Fix: assert the precondition on the raw YAML before loading — e.g. `const yaml = extractLedgerYaml(edition); assert.doesNotMatch(yaml, /^\s*mode\s*:/m); assert.doesNotMatch(yaml, /^\s*grounding\s*:/m);` — then assert the defaulted value.

---

### AUDIT-20260730-38 — `runFidelity` is called with no `requested_mode` and asserted to pass — the mode-agreement check is skippable by omission, and no fixture pins that channel for a compose ledger

Finding-ID: AUDIT-20260730-38
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise-verbatim-preflight.int.test.ts:160-172

The SC-006 test invokes the validator with the `requested_mode` field absent:

```ts
const result = runFidelity({ source, sourceIdentity: 'source-riverbank-survey', edition });
assert.equal(result.passed, true, ...);
```

and pins that this passes. Read together with the ledger default this same test asserts (absent `mode` → `'revise'`), that establishes a two-step channel: a validator call that omits `requested_mode` accepts whatever the ledger declares, and a ledger that omits `mode` is read as `revise`. Under revise mode the compose-only obligations (edition-grounding, no-copy, op-legality for `represented`) do not run at all — that is the whole point of the mode split introduced by `0e2bbd2`/`6c14aa5`.

The consequence is an enforcement-bypass shape with no fixture anywhere in this chunk: a **compose** edition whose ledger's one `mode: compose` line is missing or stripped, validated by a caller that does not pass `requested_mode`, is silently graded under revise rules and skips grounding enforcement entirely. Commit `e4c7472`/`638bdc4` added `check-mode-agreement` and `ValidateRequest.requested_mode` precisely to close mode confusion, and `bc1c626` claims "no fail-open mode default (AUDIT-06/09)" — but this test entrenches the complementary fail-open on the *schema* side and exercises only the benign half. I could not read `@/fidelity/run.ts` to confirm whether an absent `requested_mode` is refused; if it is, this test would not pass as written, so the diff itself is the evidence that omission is permitted.

Blast radius: an unattended agent or CI job that calls `runFidelity` without `requested_mode` (the exact call shape this test blesses) gets a `verdict: passed` on an ungrounded compose edition. Fix: add the missing fixture — a compose-mode ledger validated with no `requested_mode` — and pin the intended behavior explicitly (refuse, or grade as compose from the ledger). If the SC-006 compat really does need the absent-mode default, scope it as a named legacy affordance rather than a silent global default, and state the invariant plus its in-scope exception in the test comment.

---

### AUDIT-20260730-39 — Exhaustive no-copy sweep opens an unfixtured false-refusal channel: legitimate byte-identical carry-over (OPEN-QUESTION marker beats, headings, short structural lines) is indistinguishable from a copy

Finding-ID: AUDIT-20260730-39
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/policy-op-legality.test.ts:133-235 (the three D4/AUDIT-18 sweep tests)

The AUDIT-18 fix replaced a coverage-keyed pairwise detector with an **exhaustive sweep** whose invariant is stated in the diff's own words: *"every derived edition unit that byte-equals any source beat is a copy, regardless of how (or whether) coverage declares it"* (comment at the `D4 sweep -- a copy accounted only via grounding` test). Applying the channel-enumeration driver to that added surface: the sweep's **value channel** is now *every* string in the edition, not just declared destinations. Every fixture in this file feeds the sweep long, distinctive prose sentences (`'Beta cites [^b] and counts 1978.'`, `'Gamma one with 42.'`) where byte-equality unambiguously means plagiarism. Nothing pins the behavior for edition units that byte-equal a beat **for a legitimate reason**.

The concrete collision is with FR-013, landed in this same feature (`918959d feat(voice-compose): T027-T028 open-question marker enforcement`) and asserted in the sibling chunk's prompt test: `assert.match(prompt, /OPEN-QUESTION/, 'states the open-question marker must be preserved')` (voice-tooling/test/prompt.test.ts:81-84). If a spine beat *is* a standalone open-question marker paragraph, the producer is required to preserve it byte-for-byte (and AUDIT-02 additionally refuses fabricated/altered markers), which yields a derived edition unit that byte-equals a source beat — which the sweep must refuse as `whole-unit-copy` per the invariant above. That is an unsatisfiable pair of obligations: the producer cannot both preserve and not-preserve. The same channel covers markdown headings, short list items, and any structural line the spine and edition legitimately share.

Blast radius: an unattended producer loop hits a refusal it cannot repair by re-voicing, because the only repair (mutate the marker/heading) is independently refused. The failure is silent-until-encountered — the pass-side fixtures all use long prose, so CI stays green while real spines with marker-only or heading beats deadlock. A reasonable fix is to state the sweep's invariant *with its in-scope exception* rather than as an unqualified universal — e.g. the sweep applies to prose-bearing units and exempts units whose entire content is a preserved structural token (marker line, heading, footnote definition) — and to add fixtures for exactly those two shapes: (a) a spine beat that is only an OPEN-QUESTION marker, preserved in the edition; (b) a shared heading. If instead the intended answer is "refuse them, and the spine must never contain such beats," that must be a pinned refusal fixture plus a documented spine precondition, not an unexercised implication.

---

### AUDIT-20260730-40 — Stale RED narration survives in the prompt-test header — the same shape the AUDIT-05 de-stale sweep fixed elsewhere

Finding-ID: AUDIT-20260730-40 (claude-08 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/prompt.test.ts:1-12

The header reads: *"`@/revise/prompt/index.ts` does not exist yet at RED time (T003 implements it) -- this file is expected to fail to load with a 'cannot find module' error until then, which is the correct RED state for a test-first task."* In the audited range that module exists (`852e77e feat(voice-compose): T003-T004 mode-keyed prompt module (compose+revise)`), so the standing description of this file's own behavior is false as committed.

Commit `f3a3892` explicitly performed this cleanup for a sibling file (*"de-stale revise-preflight RED narration (AUDIT-05)"*), so the shape is already recognized as a defect on this feature; this instance was missed by that sweep, which means the sweep was not exhaustive across the test tree. Blast radius is comprehension-only, but it is the kind that misleads an unattended agent: a reader (human or agent) triaging a real load failure in this file will consult the header, be told the failure is expected and correct, and stop investigating. The fix is to rewrite the paragraph in past tense as provenance (*"authored RED-first against T003"*) or delete it, and to grep the rest of `voice-tooling/test/` for the remaining `does not exist yet` / `expected to fail to load` instances rather than fixing this one in isolation.

### AUDIT-20260730-41 — `open_question_markers: 'enforced'` is computed from the spine alone and never consults whether any ledger op actually subjected that beat to payload survival

Finding-ID: AUDIT-20260730-41 (claude-02 + claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:425-435

```ts
const openQuestionMarkers = sourceDeclaresOpenQuestionMarker(sourceUnits)
  ? 'enforced'
  : 'none-declared';
```

The accompanying comment justifies `'enforced'` with "in which case `checkOpObligations` above already required its bytes to survive". That implication only holds for beats whose op actually imposes payload survival. `sourceDeclaresOpenQuestionMarker(sourceUnits)` scans the **source units**, with no reference to `ledger` at all — so it cannot know whether the marker-bearing beat was `cut`, was skipped, or landed in a destination that `findUnresolvedDestinationChecks` could not resolve. In revise mode `cut` is legal (it is only compose that forbids it, per T020/b5ec9a5), so the live case is: a revise ledger that cuts the one beat carrying `[OPEN-QUESTION: …]`. Nothing required those bytes to survive anywhere, the run can still reach `verdict: 'passed'`, and the report affirmatively states that the byte-survival guarantee was `enforced`.

This is the same overclaim class the feature spent AUDIT-06/AUDIT-09 and the SC-007 regression eliminating (`no fail-open mode default`, `honest matched-by-default`): a trust-boundary field that asserts an enforcement stronger than what actually ran. Blast radius: a downstream consumer — an editor, or an agent gating publication on "were the open questions carried forward?" — reads `enforced` on a passing report and concludes the open questions reached the edition when they were deliberately dropped. Fix: compute the field from the checks that actually ran, e.g. `'enforced'` only when at least one marker-bearing source unit had a survival-imposing op with a resolved destination, and introduce a third honest value (`declared-but-not-subject` / `none-declared`) for the cut/unresolved case. (If a downstream gate in `run-outcome.ts` already scopes this field to compose, the cut case is covered by compose's cut-illegality, but the unresolved-destination case and the general source-only derivation still stand.)

---

### AUDIT-20260730-42 — `runPreflight` dispatches modes by negation (`mode !== 'compose'`), so any future producer mode silently inherits the weakest self-check

Finding-ID: AUDIT-20260730-42
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/revise/preflight.ts:56-79

`runPreflight` takes a `ProducerMode` but branches on `if (mode !== 'compose')` (line 64) and treats the entire complement of `'compose'` as "revise". The whole FG-C commit in this range is titled *"no fail-open mode default"* — and `prompt/index.ts:20-29` in this same chunk demonstrates the shape the feature actually wants: an exhaustive `switch` with a `never`-typed default that makes an unhandled mode a compile error. The producer's only pre-emit gate uses the opposite pattern.

Blast radius: today `ProducerMode` is a closed two-member set, so behavior is correct. The moment a third mode is added (`outline`, `condense`, whatever), it gets the revise branch by default — **no grounding check, no whole-unit no-copy, only `revise-verbatim-drift`** — and the compiler says nothing. That is a silent downgrade of the write gate for a mode nobody audited, in the one function whose documented job is "the caller REFUSES loudly (throws) BEFORE any write (Principle V)". An unattended agent adding a mode would get a passing typecheck and a passing suite while shipping an ungated producer.

Fix: replace the negation with `switch (mode) { case 'compose': …; case 'revise': …; default: assertNever(mode) }` — `assertNever` already exists at line 121 in this file, so the fix is mechanical and adds no surface.

---

### AUDIT-20260730-43 — revise branch filters op-legality failures by kind and silently drops every other kind — the exact fail-open the compose branch was hardened against

Finding-ID: AUDIT-20260730-43
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/preflight.ts:74-78

The compose branch was deliberately rewritten (AUDIT-11/12/19) so that *every* failure `checkOpLegality('compose', …)` reports becomes a refusal, routed through an exhaustive switch whose `assertNever` default makes "a future unhandled kind a COMPILE error here … never a silent drop" (comment at lines 81-90). The revise branch does the inverse:

```ts
const refusals = legality.failures
  .filter((failure) => failure.kind === 'revise-verbatim-drift')
  .map((failure) => failure.message);
```

Any failure kind other than `revise-verbatim-drift` that `checkOpLegality('revise', …)` reports — now or later — is dropped on the floor, and `ok` is computed from the filtered list. The filter is also redundant with the mode argument already passed on line 73: the predicate is documented as mode-scoped by its first parameter, so if the scoping works the filter removes nothing, and if the scoping ever loosens the filter converts a real violation into a pass.

Blast radius: a revise-mode illegal op that the shared policy detects is written to disk instead of refused, because the producer discarded the finding before computing `ok`. This is a write-gate fail-open, and it is asymmetric with the compose branch in the same function, which means the honesty property the feature claims ("the same refusal the validator would issue at step 5, caught here at the source") holds for compose only. Fix: drop the `.filter` and map every failure to a refusal, routing through the same exhaustive switch `composeOpLegalityRefusal` already provides (rename it to `opLegalityRefusal` and share it).

---

### AUDIT-20260730-44 — Compose prompt drops the blockquote / quoted-span byte-exactness clause that the revise prompt keeps, while its own doc comment says beats carry quoted spans

Finding-ID: AUDIT-20260730-44 (claude-03 + claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/revise/prompt/compose.ts:35-37 (vs. voice-tooling/src/revise/prompt/revise.ts:34-36)

The revise fidelity contract enumerates three payload classes: *"Every blockquote and quoted span, every citation marker … and every numeral … MUST survive VERBATIM"* (revise.ts:34-36). The compose contract enumerates two: *"Every citation marker (e.g. [PB-P056] and [^1]) and every numeral in a beat MUST still survive BYTE-EXACT"* (compose.ts:35-37). Blockquotes and quoted spans are absent — yet compose.ts's own header comment (lines 8-10) states beats carry *"citation markers, numerals, and quoted spans that anchor the composition to its evidence"*, and the compose output-format block never re-introduces the quote obligation.

Both resolutions of this gap are bad, which is why it is high rather than medium. If the shared payload extractor (`payload-extract`, in another chunk) enforces quoted spans mode-independently, the compose producer is being instructed to a weaker contract than the one that will refuse it — the model will legitimately paraphrase a quotation and eat a pre-emit refusal it was never warned about, burning rounds with no diagnostic pointing at the prompt. If the extractor scopes quotes out of compose, then the feature ships a fidelity hole: a composed chapter may silently alter the wording of a quotation lifted from a source-cited spine, which is precisely the corruption the byte-exactness machinery exists to prevent, and it would corrupt quietly rather than loudly.

Fix: decide the invariant explicitly and state it in one place. If quotes are enforced in compose, add the blockquote/quoted-span clause to compose.ts:35 verbatim from revise.ts:34. If they are deliberately out of scope for compose, say so in the contract bullet *and* correct the header comment at compose.ts:8-10, and add a fixture pinning a paraphrased-quote compose edition as passing so the exemption is a tested invariant rather than an omission.

---

### AUDIT-20260730-45 — `CoverageLedger.mode` is optional on the type, re-opening the fail-open mode channel that AUDIT-06/09 closed in the validator

Finding-ID: AUDIT-20260730-45
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/schema/ledger.ts:50-71 (`CoverageLedger.mode?: Mode`, `grounding?: GroundingRecord[]`)

The new field is declared optional with an explicit rationale for the optionality:

```ts
  /**
   * Optional on the type so pre-006 construction sites that build a
   * `CoverageLedger` literal directly (not via `loadLedger`) are unaffected;
   * `loadLedger` itself always populates this, defaulting to 'revise' when
   * absent from the ledger bytes.
   */
  mode?: Mode;
```

The stated safety argument only covers ledgers that arrive through `loadLedger`. It says nothing about the *other* direction, which is the dangerous one: any code path that builds a `CoverageLedger` literal — `@/revise/ledger-build.ts`, every test fixture, any future emitter — can omit `mode` and the type system will not object. Downstream, the compose-only obligations are all gated on `mode === 'compose'` (op-legality, whole-unit no-copy, edition-grounding, mode-agreement, open-question marker enforcement). A compose ledger constructed without `mode` therefore does not fail; it silently takes the revise branch and **every compose-only check is skipped**. That is precisely the fail-open shape commit bc1c626 removed from the validator ("no fail-open mode default (AUDIT-06/09)"), re-entering through a different door: the type, not the parser. The `?? 'revise'` an agent naturally writes when it hits `Mode | undefined` in a new check is the same defect one layer out.

Blast radius: fail-open, and silent in the direction that matters. The most likely first victims are the tests — a compose fixture that forgets `mode` passes its no-copy/grounding assertions *vacuously*, so the suite reports green on a check that never ran. The same hole makes a real producer regression (ledger-build dropping the stamp) invisible until a human reads the emitted YAML. The invariant here is stronger than "optional field": v1 says grounding is REQUIRED+non-empty iff mode is compose, and MUST be absent iff revise — a discriminated union expresses exactly that and makes both wrong states unconstructible: `type CoverageLedger = Base & ({ mode: 'compose'; grounding: GroundingRecord[] } | { mode: 'revise'; grounding?: never })`. The handful of pre-006 literal construction sites the comment is protecting should be updated to say `mode: 'revise'` explicitly — that is a mechanical edit, and it is cheaper than a permanently reachable fail-open channel.

### AUDIT-20260730-46 — `check-no-copy` computes `ok` from a string-filtered subset of `checkOpLegality` failures with no exhaustiveness guard — any failure kind neither filter claims is silently swallowed

Finding-ID: AUDIT-20260730-46
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `voice-tooling/src/fidelity/check-no-copy.ts:63-67` (with `voice-tooling/src/fidelity/check-op-obligations.ts`, not in this chunk)

`checkNoCopy` calls the shared `checkOpLegality`, then keeps only failures whose `kind === 'whole-unit-copy'` and derives its verdict from that filtered list: `ok: failures.length === 0` (line 67). The module doc (lines 15-19) justifies this by hand-enumerating the kinds it deliberately drops — `compose-forbids-verbatim` / `compose-forbids-cut` — and asserting those belong to `check-op-obligations.ts` (step 2). So the validator partitions one policy function's failure set across two checks *by string match on `kind`*, and nothing anywhere asserts the partition is total. A failure kind that neither filter claims is not reported by either check, and both report `ok: true`. That is a silent pass produced by the one mechanism whose entire purpose is to prevent silent passes.

This is not hypothetical drift risk — `checkOpLegality`'s kind set is actively growing inside this very feature: T020 added the `illegal-op` kind for compose, T023 added the revise verbatim-drift path, and FG-A's round-2 note adds `whole-unit-copy` sweep changes. The next kind added by anyone who doesn't happen to read this file's prose enumeration disappears from the validator. Note the asymmetry that makes this concrete rather than speculative: FG-B's own ledger row (`.stack-control/execute/voice-compose-from-spine.ledger.jsonl`, round-2 FG-B) advertises an "exhaustive switch+assertNever" for exactly this failure set **on the producer preflight side** — the team knows the technique, applied it to the producer, and left the validator on a bare `.filter()`. The validator is the trust boundary a governed build actually relies on.

Blast radius: a downstream governed build receives a report where `no_copy: ok` and `op_obligations: ok` while `checkOpLegality` did in fact return a failure — the edition ships with an unreported policy violation and the report affirmatively claims it was checked. Reasonable fix: make the split total by construction — have `checkOpLegality` expose kinds partitioned by consuming check (e.g. a discriminated grouping), or give each wrapper an exhaustive `switch (failure.kind)` with `assertNever` in the default branch so an unclaimed kind is a compile error rather than a silent drop. A cheaper interim fix that still has teeth: assert `noCopyFailures.length + opObligationFailures.length === result.failures.length` at the one call site that runs both.

---

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

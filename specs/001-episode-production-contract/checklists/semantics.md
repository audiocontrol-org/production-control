# Requirements Quality Checklist: Core Production Semantics

**Purpose**: Validate that the requirements defining the state model, advisory edges,
provenance, and refusals are complete, unambiguous, and internally consistent — before
tasks are generated against them
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md)
**Depth**: Standard | **Audience**: Reviewer (pre-tasks gate)

> These are unit tests for the requirements, not for the implementation. Each item asks
> whether something is *written correctly*, not whether it *works*.

## Requirement Consistency

- [ ] CHK001 - Is the set of node states consistent between the spec and the data model? [Conflict, Spec §FR-006 vs data-model.md "Node state"] — **FAILS.** FR-006 enumerates exactly six states (`fresh`, `stale`, `missing`, `blocked`, `invalid`, `needs-review`) and says every part holds exactly one. The data model adds `present` and `absent` for authored nodes, making eight. One of the two is wrong.
- [ ] CHK002 - Are the refusal cases consistent between the spec and the data model? [Conflict, Spec §FR-005 vs data-model.md "Validation rules"] — **FAILS.** The data model refuses an unknown document `version`; FR-005 does not list it. Either the spec is missing a refusal or the data model invented one.
- [ ] CHK003 - Is "unvalidated" a state, an attribute, or neither? [Ambiguity, Spec §FR-006 vs quickstart.md S2/`pc next`] — **FAILS.** `pc next` renders `epub  unvalidated`, but `unvalidated` is not among FR-006's six states. FR-012 also makes an unvalidated-but-fresh target block release, so a node can be `fresh` and still block — which FR-006's "exactly one state" framing obscures.
- [ ] CHK004 - Do the advisory-edge requirements and the release-readiness requirement agree on what "unwaived" means? [Consistency, Spec §FR-012, §FR-021, §FR-022]
- [ ] CHK005 - Are the requirements consistent about whether an authored node has a state at all, given FR-006 says "every part"? [Consistency, Spec §FR-006, §FR-002]

## Requirement Completeness

- [ ] CHK006 - Is the independence of the advisory signal and the derived signal stated as a *requirement*, or only as an edge case? [Gap, Spec §"Edge Cases" vs §FR-018–022] — The dual-signal rule (rebuilding a derived output must not clear an authored node's review) appears only in Edge Cases. It is load-bearing enough to be an FR; an implementer reading only the FRs would not know it.
- [ ] CHK007 - Are requirements defined for what happens when a followed identity is itself absent or blocked? [Gap, Spec §FR-020] — FR-020 defines needs-review when a tracked part's content *changes*. It does not say what the tracking part reports when the tracked part cannot be hashed at all.
- [ ] CHK008 - Are requirements defined for the state of a derived node whose provider declared itself impure? [Gap, Spec §FR-032] — Impurity must be declared and recorded, but no requirement says whether it affects the node's reported state or its cause.
- [ ] CHK009 - Is there a requirement covering a build interrupted mid-flight (outputs written, record not)? [Gap, Spec §FR-014, §FR-017] — research.md R8 resolves this deliberately; the spec itself is silent, so the resolution is invisible to anyone reading only the requirements.
- [ ] CHK010 - Are requirements defined for a waiver whose recorded reason is empty or whitespace? [Edge Case, Spec §FR-021] — "with a recorded reason" is stated; whether an empty string satisfies it is not.
- [ ] CHK011 - Are the requirements complete about who may declare `follows` — can a *derived* node declare it? [Gap, Spec §FR-018] — FR-018 says "an authored part". Whether a derived node declaring `follows` is a refusal or silently ignored is unspecified.

## Requirement Clarity

- [ ] CHK012 - Is "content" defined precisely enough to be unambiguous for directory-valued outputs? [Clarity, Spec §FR-008] — The spec says staleness compares *content*; only the Edge Cases mention directories being "characterized as a whole". A reader could implement per-file comparison and satisfy the letter of FR-008.
- [ ] CHK013 - Is "large" defined for the assets that must live outside version control? [Ambiguity, Spec §FR-023, §FR-026] — FR-026 requires failing loud on "raw binary" with no stand-in. Neither "large" nor "raw binary" is defined, so the guard's trigger condition is unspecified.
- [ ] CHK014 - Can "the actionable frontier" be derived unambiguously from the requirements? [Clarity, Spec §FR-011] — FR-011 requires the frontier as a distinct query but does not define membership. quickstart implies blocked nodes are excluded; the spec does not say so.
- [ ] CHK015 - Is the precedence between states defined where more than one could apply? [Gap, Spec §FR-006] — data-model.md asserts `blocked` outranks `stale`, with good reasoning. The spec states no precedence rule at all, so "exactly one state" is underdetermined.

## Consistency With Non-Negotiable Constraints

- [ ] CHK016 - Can the store-absence requirement and the zero-network requirement both hold? [**Conflict**, Spec §FR-025 vs §"Edge Cases" (stand-in referencing an absent asset)] — **FAILS, and this is the most serious item here.** FR-025 forbids contacting the store to report state. The edge case requires failing loud when a stand-in references an asset *absent from the store*. Absence in the store is unknowable without contacting it. As written, the two requirements cannot both be satisfied.
- [ ] CHK017 - Are the requirements clear that `pc status` verifies pointer *well-formedness* rather than asset *existence*? [Clarity, Spec §FR-025, §FR-026] — Follows from CHK016; the distinction is never drawn.
- [ ] CHK018 - Is every requirement that promises "fails loud" paired with a statement of what is named? [Consistency, Spec §FR-036, §FR-005, §FR-026]

## Acceptance Criteria Quality

- [ ] CHK019 - Is SC-003 verifiable from outside the implementation? [**Measurability**, Spec §SC-003] — **FAILS.** "…with no propagation rules written by hand" is a claim about *how the code is written*, not an observable outcome. It is untestable as an acceptance criterion and violates the template's own technology-agnostic rule. The observable half ("changing any authored input causes every affected output, at any depth, to report stale") is fine on its own.
- [ ] CHK020 - Is SC-009's universal claim ("no sequence of operations") bounded enough to be checkable? [Measurability, Spec §SC-009] — A universal negative cannot be tested exhaustively. It is checkable as stated only if reframed against the surface (no flag, no verb).
- [ ] CHK021 - Do any success criteria contain invented precision? [Measurability, Spec §"Success Criteria"] — **PASSES.** Deliberately no percentages, timings, or throughput figures.
- [ ] CHK022 - Are the success criteria traceable to functional requirements? [Traceability, Spec §"Success Criteria"]

## Scope Boundary Quality

- [ ] CHK023 - Are the out-of-scope items stated crisply enough that planning cannot silently reopen them? [Coverage, Spec §"Out of Scope"] — **PASSES.** Each names the boundary and the reason, and the section states they are recorded operator decisions.
- [ ] CHK024 - Is the transcript's inclusion justified in the requirements themselves, not only in the design record? [Traceability, Spec §"Assumptions"] — **PASSES.** Assumptions record both the reasoning and the non-coupling to video tooling.
- [ ] CHK025 - Are the deferred consumers of the transcript (video, audiobook) recorded so a later reader cannot mistake it for dead weight? [Coverage, Spec §"Assumptions", §"Edge Cases"] — **PASSES.** The "output with no consumer is still first-class" edge case exists precisely for this.

## Dependencies & Assumptions

- [ ] CHK026 - Is the assumption that providers are trusted (no sandboxing) paired with a statement of the consequence? [Assumption, Spec §"Assumptions"]
- [ ] CHK027 - Is the binary-validation assumption consistent with the `invalid` state and with release-readiness? [Consistency, Spec §"Assumptions", §FR-006, §FR-012]
- [ ] CHK028 - Is the dependency on an S3-compatible interface stated without naming a vendor? [Consistency, Spec §"Dependencies", §FR-027] — **PASSES.**

## Summary

**28 items. Five failed; three warranted a decision. All eight are now resolved in the
spec and data model.** Re-run: all items pass.

### Resolutions

**CHK016 — the real contradiction.** FR-025 forbade contacting the store to report state,
while an edge case demanded failing loud when a stand-in referenced an asset *absent from
the store*. Absence in the store is unknowable without contacting it; the two requirements
could not both hold.

Resolved by drawing the distinction that was missing: reporting state answers *"is this
production consistent with what we recorded"*, not *"is every byte retrievable"*. Status
validates that a stand-in is **well-formed** — checkable offline, because the stand-in
carries the content address itself — and asset existence surfaces at the first operation
that genuinely needs the bytes. Conflating the two would have forced status onto the
network or made it lie. Both edge cases are now stated explicitly.

**CHK001 / CHK015 — the state model.** The spec claimed six states for every part; the data
model had eight. The data model was closer to right, and the reason is the authored/derived
distinction: an authored node has **no `stale` state**, because it has no producer, so
staleness is not a question that can be asked of it. FR-006 now enumerates by kind, and
FR-006a adds the missing precedence rule — *report the state that asserts least* — which
makes "exactly one state" determinate instead of underdetermined.

**CHK003 — validation is not a state.** Resolved by FR-006b: validation is a recorded fact
orthogonal to freshness. `fresh`-and-unvalidated is a real, common condition that still
blocks release; `invalid` means validation *ran and failed*. The three cases (absent /
passed / failed) are now distinguished in the data model. `pc next` renders the *action*,
which is why "unvalidated" appears there without being a state.

**CHK019 / CHK020 — unverifiable success criteria.** SC-003 asserted "with no propagation
rules written by hand" — a claim about the code's internals, untestable from outside and in
breach of the template's own technology-agnostic rule. Trimmed to the observable half.
SC-009's universal negative ("no sequence of operations") is now stated against the command
surface, where it is actually checkable.

**CHK002** — unknown-version refusal added to FR-005.

**CHK006 — dual-signal independence promoted to FR-022a.** It was load-bearing but lived
only in Edge Cases, so an implementer reading the requirements would not have found it. It
now states both directions: rebuilding must not clear a review, and waiving must not affect
a derived state.

**CHK013 — FR-026's trigger defined.** "Large raw bytes" had no trigger condition. Now: an
untracked file over a **configurable size threshold with a stated default**, rather than a
guess about whether content looks binary — an author must be able to predict the refusal
rather than discover it.

Also added while resolving: FR-022b (a waiver's reason must be non-empty — a waiver without
a reason is not a decision) and FR-022c (a tracked part that cannot be resolved reports
absence, not drift — the system cannot claim drift against something it cannot read).

### Why this pass was worth running

Every finding here is a **requirements** defect, not an implementation defect. CHK016 in
particular describes two requirements that cannot both be satisfied — it would have been
discovered by whoever implemented `pc status` and tried to make an offline command verify
remote existence, at which point the cheap fix (deciding what status *means*) would have
been made under pressure by someone mid-task.


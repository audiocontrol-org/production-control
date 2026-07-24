# Specification Quality Checklist: Episode Production Contract v0.1

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validation pass 1 — issues found and fixed inline:**

1. *Implementation detail leak.* The first draft named the mechanisms directly (sha256,
   YAML filenames, S3, stdio JSON, TypeScript). These are plan-level decisions already
   recorded in the design record. Rewritten to state the guarantee instead of the
   mechanism — e.g. FR-008 requires that staleness derive from input *content* and give
   identical answers in a fresh clone, which is testable without naming a hash algorithm.
   The design record remains the place the mechanisms live.

2. *Vocabulary leak from the subject domain.* "Episode" is the term production-control
   uses, but the spec had inherited "profile"/"ledger" as if they were user concepts.
   Renamed to *recipe* and *origin record* in user-facing prose so the spec reads for a
   stakeholder; the design record keeps the implementation names.

3. *Success criteria contained invented metrics.* Draft SC items proposed percentages and
   timings that had no basis. Removed — every SC is now a verifiable fact about behavior
   rather than a projected number. Per project rule: no baseless projection statistics.

**Deliberate deviations from the template's guidance:**

- The template suggests marking unknowns with [NEEDS CLARIFICATION]. None remain. The
  design record already resolved every scope question through recorded operator decisions
  (domain separation, editorial+audio slice, content lives in subject repos, stop at
  releasable). Re-asking them here would re-litigate settled decisions, which
  `/stack-control:define`'s capture-over-YAGNI policy forbids.

- One genuine ambiguity was found in the design record and is recorded below rather than
  invented away.

## Clarification resolved (operator, 2026-07-15)

**The timed transcript is a v0.1 target.** The contradiction was real — the design's Scope
claimed the slice "forces the timed-transcript contract" while declaring no target that
produced one — but it resolved in favor of the Scope claim, not against it.

Operator's reasoning: video must be created from the narration, and audiobook indices are
needed; forced alignment is the only way to obtain either. Video cut lists hang on
word-level timings and audiobook indices need the same timings against the same script, so
the alternative is deriving alignment twice or hand-timing forever. The consumers are
deferred but known and planned, which makes this keystone work rather than speculation.

The initial draft's proposal to drop it was wrong: it reasoned from the declared graph
rather than from what the work requires.

Recorded consequences:
- Spec Assumptions now declare the transcript as a target, with its rationale and the
  reason it does not couple v0.1 to the video tooling (its producer is whichever tool
  satisfies *narration + script → timings*; the system is ignorant of which).
- Two edge cases added: the interaction where an authored part is both tracked-against and
  a declared input to the same output (both signals must fire independently), and the rule
  that an output with no consumer is still first-class.
- The design record's Scope and Open Questions were corrected to match.

Remaining open (schema, not scope): segment- vs word-level timings, how the transcript
references script structure, and how alignment failure is represented. Deliberately left
for contact with a real aligner.

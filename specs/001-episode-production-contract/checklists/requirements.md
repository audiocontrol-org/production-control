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

## Open item carried to /speckit-clarify

**The timed transcript's status is contradictory in the design record.** Its Scope
section claims the editorial+audio slice "forces the timed-transcript contract that video
will later need," and its Open Questions section says the schema should be pinned during
implementation. But no declared target in this version produces or consumes a timed
transcript — the chain is longform→{website, ebook}, narration→voiceover→podcast.

This spec therefore does not require a timed transcript, on the reasoning that a spec
should require what its targets need and nothing more. If the intent was for v0.1 to
establish that contract, a target must exist that produces it, and this spec needs a
requirement for it.

This is a scope question for the operator and is the right subject for `/speckit-clarify`.
It is recorded here rather than guessed at.

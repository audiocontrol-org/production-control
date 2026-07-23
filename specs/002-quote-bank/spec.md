# Feature Specification: Quote bank

**Feature Branch**: `002-quote-bank`

**Created**: 2026-07-23

**Status**: Draft

**Design record**: `docs/superpowers/specs/2026-07-22-quote-bank-design.md` (approved)

## Overview

A reproducible capability to build a **quote bank** — verbatim, source-cited,
fabrication-checked passages — from a project's primary sources, for any subject.
The bank grounds downstream drafts in real source voice instead of paraphrase.

A quote is literal source text, so the bank's integrity is *verbatim fidelity*,
which is mechanically checkable. The capability therefore pairs an **impure**
producer (a language model selects quotable passages) with an **independent,
deterministic** acceptance gate (a validator that guarantees every quote is real
and unaltered except in disclosed, checkable ways). It lives in a separate
reusable package and is orchestrated by production-control with no change to
production-control's core.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Independently verify a quote bank's fidelity (Priority: P1)

A producer has a quote bank and the sources it was drawn from, and needs to know —
without trusting whatever produced it — that every quote is a real, unaltered
excerpt of its cited source. They run the validator; it either confirms the whole
bank or names exactly which quotes fail and why.

**Why this priority**: The validator is the trust anchor. It is what makes an
impure producer safe, it is fully deterministic, and it delivers value on its own
(any quote bank, however produced, can be checked). It is the MVP: with only the
validator, a bank authored by any means becomes trustworthy.

**Independent Test**: Hand-write a small quote bank against a fixture source —
some quotes valid, one with a fabricated span, one with an undisclosed alteration,
one using an out-of-set edit — and run the validator. It passes the valid bank and
fails each bad one, naming the offending quote. No producer is involved.

**Acceptance Scenarios**:

1. **Given** a quote bank whose every quote's excerpt appears verbatim in its cited
   source and whose disclosed edits reproduce each presentation, **When** the
   validator runs, **Then** it accepts the bank.
2. **Given** a quote bank containing a quote whose span text does not appear in its
   source, **When** the validator runs, **Then** it rejects the bank and names that
   quote and span.
3. **Given** a quote whose disclosed edits do not reproduce its presentation text
   byte-for-byte, **When** the validator runs, **Then** it rejects the bank naming
   the undisclosed alteration.
4. **Given** a quote using an edit outside the allowed closed set, **When** the
   validator runs, **Then** it rejects the bank naming the illegal edit.
5. **Given** the same bank and sources, **When** the validator runs repeatedly,
   **Then** it returns the identical verdict every time, using no language model and
   no network.

### User Story 2 - Build a quote bank from a project's sources (Priority: P2)

A producer points the capability at a project's primary sources and gets back a
quote bank of the most quotable passages, each attributed to its source and each
guaranteed verbatim.

**Why this priority**: This is the production step that saves the manual labor of
mining a corpus. It depends on US1 for its guarantee — the producer is allowed to
be impure precisely because the independent validator gates its output.

**Independent Test**: Run the miner over a small fixture corpus; feed its output to
the US1 validator; confirm the bank is accepted and its quotes are attributed to
real sources.

**Acceptance Scenarios**:

1. **Given** a directory of source documents, **When** the miner runs, **Then** it
   produces a quote bank whose every quote passes the independent validator.
2. **Given** the miner selects a passage whose text is not exactly present in any
   source, **When** it grounds its selections, **Then** that passage is omitted from
   the bank rather than emitted unverified.
3. **Given** the miner has produced a bank, **When** its output is inspected, **Then**
   the producer is recorded as impure and reports no validation verdict of its own —
   acceptance is decided only by the validator.

### User Story 3 - Ground a draft in the quote bank, and control regeneration (Priority: P3)

A producer builds a downstream draft (e.g. a script) that draws on the quote bank,
and wants the bank treated as a first-class produced input whose regeneration is a
deliberate choice, not something the system forces.

**Why this priority**: This integrates the bank into the production graph and pins
down its lifecycle semantics. It depends on US1/US2 existing.

**Independent Test**: Model a draft that consumes the quote bank; change the sources
and confirm the bank is reported stale; change only the producing model's version
and confirm the bank is *not* forced to rebuild (reported as drift instead).

**Acceptance Scenarios**:

1. **Given** a quote bank consumed by a draft, **When** the sources change, **Then**
   the bank is reported stale (there is new material to draw from).
2. **Given** a built quote bank, **When** only the producing model's version changes,
   **Then** the system reports producer drift and does **not** automatically restale
   or rebuild the bank.
3. **Given** a producer wants a fresh selection, **When** they regenerate the bank,
   **Then** it is a deliberate action they take, never an automatic system response.

### Edge Cases

- A source document referenced by a quote does not exist in the supplied sources →
  the validator rejects, naming the missing source.
- A passage appears more than once in a source → the quote is still faithful; an
  optional recorded position may sharpen the citation but is not required.
- A source is empty or unreadable → surfaced as an error, never silently skipped.
- The producing model is unavailable at mine time → the miner fails loudly; it never
  emits a partial or fabricated bank.
- Two quotes cite the same passage → both are valid independently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each quote in a bank MUST attribute its text to a `source` that resolves
  to a source document supplied to the capability.
- **FR-002**: Each quote MUST record one or more spans, and each span's raw excerpt
  MUST be an exact, byte-for-byte substring of its source (no normalization).
- **FR-003**: Each quote MUST record a readable presentation text and the disclosed
  transformations (edits) from its spans' raw bytes to that text.
- **FR-004**: Edits MUST be limited to a closed set that only fixes OCR errors and
  joins non-adjacent excerpts with a marked ellipsis; no edit may rewrite,
  paraphrase, or insert text that is not in the source.
- **FR-005**: The capability MUST provide an independent validator that, for every
  quote, verifies (a) the source resolves, (b) each span's raw excerpt is an exact
  byte-for-byte substring of that source, (c) re-applying the edits to the spans'
  raw bytes reproduces the presentation text byte-for-byte, and (d) every edit is
  within the closed set.
- **FR-006**: The validator MUST reach its verdict with no language model, no
  similarity threshold, and no network access; it MUST accept a bank only if every
  quote passes, and otherwise reject it, naming each violation.
- **FR-007**: The capability MUST provide a producer that builds a quote bank from the
  sources: it selects quotable passages using a language model, then grounds each
  selection by extracting the exact source bytes rather than transcribing them.
- **FR-008**: The producer MUST declare itself impure and MUST NOT report a validation
  verdict of its own; a quote bank's acceptance MUST be decided solely by the
  independent validator.
- **FR-009**: A selected passage that cannot be grounded (its text is not exactly
  present in a source) MUST be omitted from the bank, never emitted unverified.
- **FR-010**: The quote bank MUST be a produced artifact built from a `sources` input
  consisting of plain-text primary-source documents, each carrying a stable source
  id used for attribution.
- **FR-011**: Changing the sources MUST cause the bank to be reported out of date;
  a change to only the producing model's version MUST be reported as producer drift
  and MUST NOT automatically invalidate or rebuild the bank.
- **FR-012**: Regenerating the quote bank MUST be a deliberate human action, never an
  automatic system response to a producer-version change.
- **FR-013**: The capability MUST live in a separate reusable package usable by any
  project, and MUST require no change to production-control's core to be orchestrated.
- **FR-014**: The quote/span/edit schema MUST remain extensible for future metadata
  and organization, while adding none of it in this version.

### Key Entities

- **Source document**: a project's primary-source text, carrying a stable id used for
  citation. Supplied by the project; its production (OCR, translation) is out of scope.
- **Quote bank**: the produced collection of quotes over a set of sources.
- **Quote**: an attributed excerpt — a `source`, one or more `spans`, a presentation
  `text`, and the `edits` relating them; optionally a note, location, and id.
- **Span**: a single source excerpt — the exact `raw` bytes copied from the source,
  and optionally its position.
- **Edit**: one disclosed, closed-set transformation from raw bytes toward the
  presentation (an OCR fix or an ellipsis join).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the quotes in an accepted bank are verbatim excerpts of their
  cited sources — verified mechanically, with no exceptions.
- **SC-002**: Any bank containing a fabricated or undisclosed-altered quote is
  rejected, and the rejection names every offending quote — zero false-cleans.
- **SC-003**: The validator's verdict is fully deterministic and offline: the same
  bank and sources yield the identical verdict on every run, with no language model
  and no network.
- **SC-004**: A fabricated passage proposed during mining never appears in the
  produced bank (it is dropped at grounding).
- **SC-005**: A quote bank can be built for a new subject by supplying only that
  subject's sources — no per-subject change to the capability's code.
- **SC-006**: A change to only the producing model's version never, by itself, causes
  the system to rebuild or invalidate an existing bank.

## Assumptions

- Sources are supplied as plain-text documents each carrying a stable id; converting
  a corpus (OCR, PDF, translation) into that form is the project's responsibility and
  is out of scope.
- A language model is reachable for the mining step; the deterministic validator
  requires none.
- Downstream drafts consuming the bank are separate features; this feature exercises
  the consumption relationship but does not author the drafts.
- **Out of scope (operator-set):** a readable rendered view of the bank; multilingual
  / translation handling; source-format conversion; the broader asset-bank
  generalization (tracked as `design:feature/asset-bank`); any change to
  production-control's core.

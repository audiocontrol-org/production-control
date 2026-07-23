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
   byte-for-byte, **When** the validator runs, **Then** it rejects the bank, names the
   quote, and reports the mismatch between the mechanically reconstructed presentation
   and the recorded text (the first differing byte or range) — it does not infer what
   undisclosed operation occurred.
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

- A quote cites a `source` not present in the supplied sources → validator rejects,
  naming the missing source.
- A source document is **not valid UTF-8** → error before any quote is processed
  (FR-001), never silently coerced.
- Two documents declare the **same source id** (or ids differing only by case) →
  mining and validation fail before processing (FR-018).
- A source id remaps to a different file, or a manifest points at a missing file →
  fail before processing (FR-018).
- A passage occurs **more than once** in a source with no recorded offset → faithful,
  accepted, but reported location-ambiguous (FR-010). With an offset that identifies
  the wrong occurrence → the recorded `raw` still must match at that offset or it fails.
- An `ocr-fix` `before` occurs **multiple times** in the target span, two edits
  **overlap**, or an edit references a **nonexistent span** → structurally invalid,
  rejected before fidelity (FR-007).
- An `ellipsis-join` references spans in an invalid order or a missing index →
  rejected (FR-007).
- The quote bank contains **no quotes** → structurally valid and passes fidelity (an
  empty bank is faithful); whether it is *useful* is a separate, out-of-scope
  completeness concern, not this validator's.
- The source directory contains **no usable documents** → the miner surfaces it; it
  does not silently emit an empty bank as if successful.
- The miner is **interrupted** after writing temporary output → no previously accepted
  bank is replaced (FR-016).
- The miner processes several sources but **cannot read another** → the run fails; no
  partial bank is emitted (FR-015).
- A source changes only in **line-ending convention** → different bytes, so the bank is
  reported out of date (FR-019); fidelity is against the exact bytes on disk.
- Presentation `text` contains Unicode **visually identical but byte-distinct** from the
  reconstruction → rejected (byte-for-byte, not visual, comparison).
- Two quotes cite the same passage → both valid independently.

## Requirements *(mandatory)*

### Encoding & byte semantics

- **FR-001**: Source documents MUST be valid UTF-8. Fidelity is evaluated against the
  exact UTF-8 byte sequence stored on disk. The capability MUST NOT normalize Unicode,
  whitespace, punctuation, case, or line endings before matching. A source that is not
  valid UTF-8 MUST be surfaced as an error, never silently coerced.
- **FR-002**: A span's `raw` is a Unicode string whose UTF-8 encoding MUST match a
  contiguous byte range of its cited source exactly. Any recorded position is a **byte
  offset** into the source. The YAML serialization of the bank MUST round-trip these
  strings without altering their bytes.

### Attribution, spans, and edits

- **FR-003**: Each quote MUST attribute its text to a `source` that resolves to a
  supplied source document, and MUST record one or more spans, each an exact byte
  substring of that source (per FR-001/FR-002).
- **FR-004**: Each quote MUST record a readable presentation `text` and the disclosed
  `edits` transforming its spans' `raw` into that text.
- **FR-005**: Edits MUST be limited to a **closed set** with operational semantics
  precise enough for independent reproduction (full schema in `data-model.md`):
  - `ocr-fix` — targets one span, locating an incorrect byte substring (`before`) and
    replacing it with a correction (`after`); MUST record the incorrect source form.
  - `ellipsis-join` — joins two spans in declared order with an exact marked separator.
  No edit may rewrite, paraphrase, reorder, insert unsourced text, or target text
  introduced by an earlier edit. Edits apply **sequentially in declared order**.
- **FR-006**: Each quote MUST carry an `id` that is **unique within the bank**;
  violations and any downstream reference MUST identify a quote by its `id`, not by
  list position. (Cross-regeneration stability of ids is **not** guaranteed — a
  regeneration is a new selection.)

### The validator (independent, deterministic)

- **FR-007**: The capability MUST provide an independent validator that, before fidelity
  evaluation, MUST reject a **structurally malformed** bank — unknown schema version,
  missing required fields, an empty span list, a duplicate quote id, a `source` that
  does not resolve, an edit referencing a nonexistent span, or an overlapping/invalid
  edit — naming the defect.
- **FR-008**: For every quote the validator MUST verify (a) `source` resolves, (b) each
  span's `raw` is an exact byte substring of that source, (c) re-applying the edits to
  the spans' `raw` bytes reproduces `text` byte-for-byte, and (d) every edit is within
  the closed set.
- **FR-009**: The validator MUST reach its verdict with no language model, no similarity
  threshold, and no network. It MUST accept a bank only if every quote passes;
  otherwise it MUST reject, naming each violation. For a reconstruction failure it MUST
  report the **mismatch between the mechanically reconstructed presentation and the
  recorded `text`** (the first differing byte or range); it MUST NOT attempt to infer
  what undisclosed operation occurred.
- **FR-010**: When a span occurs more than once in its source and no byte offset is
  recorded, the validator MUST still accept it if faithful, but MUST report it as
  **location-ambiguous** (a non-blocking advisory, for downstream citation tooling).
- **FR-011**: Neither the validator nor the miner may modify the supplied source
  documents.

### The miner (impure producer)

- **FR-012**: The capability MUST provide a producer that builds a quote bank from the
  sources: it selects quotable passages using a language model, then **grounds** each
  selection by extracting the exact source bytes rather than transcribing them.
- **FR-013**: The producer MUST declare itself impure and MUST NOT report a validation
  verdict of its own; a bank's acceptance MUST be decided solely by the independent
  validator.
- **FR-014**: A selected passage that cannot be grounded to an exact span MUST be
  **omitted** from the bank, never emitted unverified.
- **FR-015**: The producer MUST distinguish three failure levels: (a) a candidate that
  cannot be grounded is omitted and reported; (b) a source that cannot be processed
  (unreadable, not UTF-8) fails the run — no completed bank is emitted; (c) any
  provider-level failure or interruption fails the run **atomically** (see FR-016).
- **FR-016**: A failed or interrupted mining run MUST leave any previously accepted quote
  bank unchanged: the producer writes a complete bank only on success. (production-control's
  build path already stages and atomically commits, so a failed build never replaces the
  prior committed artifact; the producer MUST likewise never emit a partial bank.)
- **FR-017**: The producer MUST emit a machine-readable **mining report** — which source
  ids were processed, skipped, empty, unreadable, or failed, and how many candidates were
  selected, grounded, and omitted — WITHOUT reporting a validation verdict. (A bank may
  pass fidelity while the report reveals weak selection; the two are separate.)

### Sources, orchestration, and lifecycle

- **FR-018**: The `sources` input MUST provide an **unambiguous** mapping from stable
  source ids to source documents. Duplicate ids, ids differing only by case, ids
  containing path separators or control characters, or a mapping pointing at a missing
  file MUST cause both mining and validation to fail **before any quote is processed**.
  (The concrete carrier — filename stem vs a manifest — is fixed in `data-model.md`.)
- **FR-019**: The quote bank MUST be a produced artifact built from the `sources` input;
  changing the sources MUST cause the bank to be reported out of date.
- **FR-020**: A change to only the producing model's version MUST be reported as producer
  drift and MUST NOT automatically invalidate or rebuild the bank. The model identity
  MUST be carried within the **existing** producer tool/version provenance (no new
  provenance field, no production-control core change), so the existing producer-drift
  reporting surfaces it.
- **FR-021**: Regenerating the quote bank MUST be a deliberate human action, never an
  automatic system response to a producer-version change.

### Packaging & extensibility

- **FR-022**: The capability MUST live in a separate reusable package usable by any
  project — the owning implementation boundary for the schema, miner, and validator —
  and MUST require no change to production-control's core to be orchestrated.
- **FR-023**: The quote/span/edit schema MUST remain extensible for future metadata and
  organization, while adding none of it in this version.
- **FR-024**: The schema MUST define edit application order, span ordering, encoding, and
  serialization precisely enough that an independent implementation reconstructs identical
  presentation bytes from an accepted bank.

### Key Entities

- **Source document**: a project's primary-source text, carrying a stable id used for
  citation. Supplied by the project; its production (OCR, translation) is out of scope.
- **Quote bank**: the produced collection of quotes over a set of sources.
- **Quote**: an attributed excerpt — a bank-unique `id`, a `source`, one or more
  `spans`, a presentation `text`, and the `edits` relating them; optionally a note and
  location.
- **Span**: a single source excerpt — the exact `raw` bytes copied from the source, and
  optionally a byte `offset` (to disambiguate a repeated passage).
- **Edit**: one disclosed, closed-set transformation from raw bytes toward the
  presentation — an `ocr-fix` (target span, `before`, `after`) or an `ellipsis-join`
  (between two spans, exact separator). Operational schema and application order in
  `data-model.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of quotes in an accepted bank, every source span is an exact
  excerpt of its cited source, and the presentation is mechanically derivable from those
  spans using only disclosed, allowed edits.
- **SC-002**: Any bank containing an ungrounded span, an illegal edit, an unresolvable
  source reference, or a presentation that cannot be reconstructed from its declared
  spans and edits is rejected, with every violation identified — zero false-cleans.
- **SC-003**: The validator's verdict is fully deterministic and offline: the same bank
  and sources yield the identical verdict on every run, with no language model and no
  network.
- **SC-004**: Every proposed candidate that cannot be grounded is absent from the
  emitted bank and recorded in the miner's mining report as omitted (observable output,
  not private model behavior).
- **SC-005**: A quote bank can be built for a new subject by supplying only that
  subject's sources — no per-subject change to the capability's code.
- **SC-006**: A change to only the producing model's version never, by itself, causes
  the system to rebuild or invalidate an existing bank.
- **SC-007**: A failed or interrupted regeneration leaves the previously accepted quote
  bank unchanged.
- **SC-008**: Duplicate, ambiguous, or invalid source ids are rejected before mining or
  fidelity validation proceeds.
- **SC-009**: An independent implementation can reconstruct every accepted quote's
  presentation from the schema and produce the same bytes as the reference validator.

## Assumptions

- Sources are supplied as **valid UTF-8** plain-text documents, each carrying a stable,
  unique id via an unambiguous mapping (FR-018); converting a corpus (OCR, PDF,
  translation) into that form is the project's responsibility and is out of scope.
- A language model is reachable for the mining step; the deterministic validator
  requires none.
- Downstream drafts consuming the bank are separate features; this feature exercises
  the consumption relationship but does not author the drafts, and does not guarantee
  cross-regeneration stability of quote ids (a regeneration is a new selection).
- The reusable package is the **owning implementation boundary** for the schema, miner,
  and validator; its name, CLI entry points, provider/validator commands, and schema
  versioning are settled in the plan.
- **Out of scope (operator-set):** a readable rendered view of the bank; a completeness
  / selection-quality profile (separate from fidelity); multilingual / translation
  handling; source-format conversion; the broader asset-bank generalization (tracked as
  `design:feature/asset-bank`); any change to production-control's core.

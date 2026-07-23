# Quote-bank capability — design record

- Date: 2026-07-22
- Roadmap item: `design:feature/quote-bank`
- Status: approved (feeds the stack-control define → specify → … → govern chain)

## Problem

Downstream drafts (a podcast script, an article) are stronger when they quote
primary sources in the sources' own words rather than paraphrasing them. Doing
that safely requires a **quote bank**: verbatim, source-cited passages a draft
can draw on. The bank must be trustworthy — every quote must be real, attributed,
and unaltered except in disclosed, checkable ways — and it must be reproducible
for **any** subject, not one corpus.

This adapts a process lesson observed in a content project (build the quote bank
before the first draft, so drafts use real period voice from the start). It uses
**none** of that project's outputs — only the discipline.

## What a quote bank is (and is not)

A quote is **literal source text**, not a creative output. There is nothing to
author. A quote bank's entire integrity is **verbatim fidelity**, and because a
quote is literal, fidelity is **100% mechanically checkable** against the source.

So the quote bank is a **derived artifact whose acceptance is a deterministic
fidelity gate** — the inverse of a creative draft:

| | a script draft | a quote bank |
|---|---|---|
| nature | creative | mechanical |
| producer | impure (a model writes it) | impure (a model *selects*) |
| trust anchor | a human owns the result | a deterministic gate owns fidelity |
| human role | authors the final | none required for correctness |

No human authors or owns the bank. The only judgment is **selection** (which
passages are worth including), which is editorial, not authorial, and where an
impure selector costs nothing on the thing that matters because the gate is
deterministic.

## Decisions settled in design

1. **Selection is impure (an LLM).** Choosing quotable passages across a whole
   corpus is expensive by hand and is exactly where judgment helps. Because the
   fidelity gate is deterministic, an impure selector is safe: it can vary which
   quotes it picks run to run, but it can never make a quote unfaithful.
2. **Fidelity is raw-spans-plus-disclosed-edits, not fuzzy matching.** A quote
   records the exact source span(s) it draws from, the readable presentation, and
   the explicit transformations between them. The gate re-derives the
   presentation from the spans and the edits and compares byte-for-byte. No
   similarity threshold ever enters — a threshold would be the non-deterministic
   gate this design exists to avoid.
3. **It lives in a separate reusable package,** not in production-control core and
   not in any one subject repo. production-control orchestrates it; it never
   contains it.

## Placement and scope of change

A new standalone package (working name `editorial-tooling`) holds three things:

- the **quote-bank schema**,
- the impure **quote-miner provider**, and
- the deterministic **quote-fidelity validator**.

**No production-control core change is required.** The capability fits the
existing model exactly — a derived target produced by an impure provider and
gated by an independent validator, over a directory input. That it fits is itself
the proof that the earlier impure-provider and independent-validator work is
sufficient and reusable. Any content project installs the package and points its
sources at it.

## The graph model

- `sources` — an authored **directory input**: the project's primary-source
  documents as plain-text files, each carrying a stable **source id** (the id used
  in citations). Converting a corpus (OCR, translations, PDFs) into plain text +
  ids is **per-project** and out of scope here; everything below is generic over
  that shape.
- `quote-bank` — a **derived target**: `quote-bank ← [sources]`, produced by the
  miner (impure), carrying the quote-fidelity **validator** as its independent
  acceptance gate. Committed once built (irreproducible selection), regenerated
  deliberately.
- Downstream, a draft target may take `quote-bank` as an input. The
  "build the quote bank first" sequencing then becomes a graph fact: a draft is
  built from the bank, and the bank's freshness against the sources is tracked
  like any other derived state.

## The schema (data model)

A quote bank is a structured file in **YAML**, matching the manifest / profile /
ledger convention already used across production-control. Each quote:

- `source` — the source id; must resolve to a source document.
- `spans` — one or more source excerpts, the fidelity anchor. Each span has a
  `raw` field — the excerpt as an **exact, byte-for-byte substring** of the source
  (OCR warts and all; no Unicode normalization). `raw` is named distinctly from the
  quote's `text` below so it is always obvious which value came straight from the
  source. The validator confirms each span's `raw` appears verbatim in the source.
  A span MAY also record an `offset` to disambiguate a passage that occurs more
  than once; not required for v1 (an ambiguous span is still faithful — the offset
  only sharpens the citation).
- `text` — the readable presentation a draft would quote.
- `edits` — the **disclosed** transformations from the spans' `raw` bytes to
  `text`, each an explicit, mechanically-applicable operation drawn from a
  **closed** set:
  - `ocr-fix` — replace a specific byte substring within a span's `raw` with a
    correction.
  - `ellipsis-join` — join spans with a marked `…`.
  No operation may rewrite, paraphrase, or insert unsourced text. The closed set
  is the guarantee that "cleanup" cannot become "authoring."
- optional `note` (human-readable disclosure), `location` (page/line if known),
  and a stable `id`.

The schema is a flat list of independent quotes in v1, and is intended to stay
**extensible**: future editorial organization (themes, chronology, speaker,
collection) can be added as optional fields without touching the fidelity model.
None of that is in v1.

## The miner (impure)

For each source document, an LLM (invoked via the `claude` CLI, following the
existing `script-provider`) **selects** quotable passages. The tool then
**grounds** each selection deterministically: it locates the passage in the source
and extracts the *exact* raw span from the source itself — the model points, the
tool copies the bytes — then records the presentation and the disclosed edits, and
emits the schema. Grounding the span in the tool (rather than trusting the model
to transcribe verbatim) keeps the miner's output close to passing, while the
independent validator remains the actual guarantee.

The miner declares itself **impure** (selection varies run to run) and reports
**no validation verdict of its own** — the independent validator decides, exactly
as the `script-provider` was reworked to do.

## The validator (deterministic — the trust anchor)

Run via `pc validate quote-bank`. For **every** quote:

1. `source` resolves to a source document supplied in `sources`.
2. Each span's `raw` is an **exact, byte-for-byte substring** of that source.
   (Else: fabrication or miscopy — fail, naming the quote and span.)
3. Re-applying the `edits` to the spans' `raw` bytes reproduces `text`
   **byte-for-byte**. (Else: undisclosed alteration — fail.)
4. Every edit is within the **closed op set**. (Else: an illegal transformation —
   fail.)

Passes only if all quotes pass; otherwise fails, naming each violation. No LLM,
no threshold, no network. This is what makes an impure miner safe: fidelity is
guaranteed independent of the miner's reliability.

## Regeneration is editorial, not freshness

The bank is impure — a newer or better model may select a *different* set of
equally faithful quotes. That is an **editorial** change, not a correctness
regression, so production-control must not treat it as staleness to chase:

- If the **sources change**, the bank goes stale like any derived artifact and
  re-mining is the right response — there is new material to draw from.
- If only the **miner's (model) version changes**, that is producer drift.
  production-control already *reports* producer drift without restaling or
  rebuilding, which is exactly the behavior wanted here: the existing bank is
  still faithful, and regenerating it for a newer selection is a deliberate human
  decision, never automatic.

So regenerating the quote bank is an editorial action a person takes, not a
freshness signal the system raises — consistent with production-control's existing
treatment of provider-version drift.

## Testing strategy

- **Validator first (TDD).** It is deterministic and the trust anchor, so it is
  built and tested before the miner, against fixtures: valid quotes; a fabricated
  span; an undisclosed edit; an out-of-set edit; a multi-span ellipsis join.
- **The fabricated-quote failure mode, explicitly.** The scenario a reader worries
  about most — an LLM inventing a quotation — is covered at both levels and named
  as such: at the **miner**, a selected passage whose text is not actually in the
  source fails to ground (no exact span can be extracted) and is **omitted**; at
  the **validator**, a quote carrying a fabricated span is **rejected**. A fixture
  demonstrates each, so the system's answer to fabrication is a test, not a claim.
- **Miner.** Unit-test its deterministic parts (span-locating, schema emission)
  with an injected fake model; one live by-hand run mines a tiny fixture corpus
  and its output is fed to the real validator.
- **End-to-end.** In a proving ground: mine a small corpus → `pc validate
  quote-bank` passes → a draft target grounds in the bank.

## Build order (for the plan)

1. The schema + the deterministic quote-fidelity validator.
2. The impure quote-miner provider.
3. Orchestration: model `quote-bank ← [sources]` with the validator, and exercise
   it end-to-end in a proving ground (mine → validate → ground a draft).

## Out of scope (v1)

- A readable `QUOTE-BANK.md` renderer (a downstream nice-to-have generator).
- Multilingual / translation handling beyond plain-text sources with ids.
- Source-format conversion (OCR / PDF → text) — per-project, not the tool's job.
- Any change to production-control core.

## Fidelity rules (binding)

- Every quote is real source text: exact spans, verbatim.
- Cleanup exists only as **disclosed, closed-set, mechanically-re-derivable**
  edits. Nothing is paraphrased, invented, or silently altered.
- The miner may be wrong about *what* to include; it can never be wrong about
  *fidelity*, because the deterministic gate re-checks every quote against its
  source.

## A reusable pattern (noted here, not extracted)

This capability is a concrete instance of a more general shape:

> impure discovery → deterministic grounding → independent deterministic validation

The same shape plausibly fits later selection-from-sources capabilities — image,
map-excerpt, archival-document, audio-excerpt, or timeline-event selection. It is
called out here only so the resemblance is on record. The pattern is **not**
abstracted in this design: extracting it into its own design belongs with the
*second* capability that adopts it, not the first — generalizing from a single
instance would be guessing at the seam.

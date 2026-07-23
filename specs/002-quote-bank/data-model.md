# Phase 1 Data Model: Quote bank

The quote bank is a YAML document over a set of source documents. Everything below
is subject-agnostic — no field encodes any subject knowledge.

## Entities

### Source document (input)

A project's primary-source text.

| Field | Type | Notes |
|---|---|---|
| id | string | Stable, unique across the corpus; used for citation (`source` on a quote). |
| bytes | text | The document's exact bytes (plain text). |

- Supplied as the `sources` directory input. How the id is carried (filename-stem
  vs a small manifest) is a task-level decision; the id MUST be stable and unique.
- Producing the plain text from a raw corpus (OCR, PDF, translation) is out of scope.

### Quote bank (the artifact)

The produced YAML document.

| Field | Type | Notes |
|---|---|---|
| version | integer | Schema version literal (`1`); an unknown version is a refusal. |
| quotes | list<Quote> | Zero or more quotes. An empty list is valid (a corpus may yield nothing quotable). |

### Quote

An attributed excerpt.

| Field | Type | Required | Notes |
|---|---|---|---|
| source | string | yes | MUST resolve to a source document's id. |
| spans | list<Span> | yes (≥1) | The exact source excerpts, in presentation order. |
| text | string | yes | The readable presentation. |
| edits | list<Edit> | yes (may be empty) | Disclosed transformations from the spans' `raw` to `text`. |
| id | string | no | Stable quote id (e.g. per-source sequence). |
| note | string | no | Human-readable disclosure. |
| location | string | no | Page/line if known. |

- The schema is **extensible**: additional optional fields (future themes,
  significance, etc.) may be added later without changing the fidelity model. None
  are added in v1.

### Span

A single source excerpt.

| Field | Type | Required | Notes |
|---|---|---|---|
| raw | text | yes | Exact, byte-for-byte substring of the quote's source (no normalization). |
| offset | integer | no | Byte offset of `raw` in the source; disambiguates a passage that occurs more than once. Not required. |

### Edit

One disclosed transformation, from a **closed** set.

| Kind | Fields | Meaning |
|---|---|---|
| `ocr-fix` | `find` (byte substring within a span's `raw`), `replace` (the correction) | Replace an OCR error. |
| `ellipsis-join` | (positional — between two spans) | Join adjacent spans with a marked `…`. |

- No other edit kind is permitted. An edit MUST NOT rewrite, paraphrase, reorder, or
  insert any text not derivable from the spans' `raw` by an `ocr-fix` or a marked
  ellipsis. This closed set is the guarantee that cleanup cannot become authoring.

## Validation rules (the deterministic gate)

For **every** quote in the bank, all of the following MUST hold, or the bank is
rejected naming the offending quote/span:

1. **Source resolves** — `source` names a supplied source document.
2. **Verbatim spans** — each span's `raw` is an exact byte-for-byte substring of that
   source document (no Unicode normalization, no case folding, no whitespace
   collapsing).
3. **Reproducible presentation** — applying the quote's `edits` to the spans' `raw`
   bytes (in order, ellipsis-joining as declared) reproduces `text` **byte-for-byte**.
4. **Closed edit set** — every edit is an `ocr-fix` or `ellipsis-join`; no other kind.

The verdict uses no language model, no similarity threshold, and no network. The
same bank + sources yield the same verdict on every run.

## Relationships & lifecycle

- `quote-bank ← [sources]`: the bank is derived from the sources.
- A quote references exactly one `source`; a source may back many quotes; a passage
  may back more than one quote (each independently valid).
- **Freshness**: the bank restales when `sources` change (new material). A change to
  only the producing model's version is **producer drift** (reported, not
  auto-restaled). Regeneration is a deliberate human action, never automatic.
- **Impurity**: the bank is produced by an impure miner (selection varies), so it is
  committed as the durable record; its fidelity — the thing that must not vary — is
  guaranteed by the deterministic validator regardless.

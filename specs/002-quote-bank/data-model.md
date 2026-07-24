# Phase 1 Data Model: Quote bank

The quote bank is a YAML document over a set of source documents. Everything below
is subject-agnostic — no field encodes any subject knowledge.

## Entities

### Source document (input)

A project's primary-source text.

| Field | Type | Notes |
|---|---|---|
| id | string | Stable, unique across the corpus; used for citation (`source` on a quote). |
| bytes | UTF-8 text | The document's exact UTF-8 bytes on disk. |

- **Encoding**: source documents MUST be valid UTF-8. Fidelity is evaluated against the
  exact UTF-8 byte sequence on disk. No Unicode normalization, no whitespace/line-ending
  normalization, no case folding, no BOM stripping. A non-UTF-8 source is an error.
- **Id mapping (v1)**: the source id is the source file's **name stem** (the filename
  without its directory or extension). The mapping MUST be unambiguous: two files
  yielding the same id (including ids differing only by case), or an id containing a
  path separator or control character, is an error surfaced **before any quote is
  processed** (by both miner and validator). (A manifest carrier may be added later
  without changing the fidelity model; the filename-stem rule is v1.)
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
| id | string | yes | **Unique within the bank.** Names the quote in diagnostics and downstream references (never by list position). Not guaranteed stable across a regeneration (a new selection). |
| source | string | yes | MUST resolve to a source document's id. |
| spans | list<Span> | yes (≥1) | The exact source excerpts, in presentation order. |
| text | string | yes | The readable presentation. |
| edits | list<Edit> | yes (may be empty) | Disclosed transformations from the spans' `raw` to `text`. A quote of N spans MUST carry exactly N−1 `ellipsis-join` edits joining consecutive spans (plus any `ocr-fix` edits). |
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

One disclosed transformation, from a **closed** set. Every edit carries an `op`.

`ocr-fix` — correct an OCR error within one span:

| Field | Type | Notes |
|---|---|---|
| op | `"ocr-fix"` | |
| span | integer | Index into `spans` (0-based) of the target span. |
| before | string | The exact incorrect byte substring within that span's `raw`. Recorded (the incorrect source form is preserved). |
| after | string | The replacement. |
| at | integer | **Optional** byte offset of `before` within the span's `raw`. **Required** when `before` occurs more than once in the span (else the edit is structurally ambiguous → rejected). |

`ellipsis-join` — join two consecutive spans:

| Field | Type | Notes |
|---|---|---|
| op | `"ellipsis-join"` | |
| between | [integer, integer] | Two **consecutive** span indices `[i, i+1]`. |
| separator | string | The exact join string; MUST contain U+2026 (`…`). |

Example:

```yaml
edits:
  - op: ocr-fix
    span: 0
    at: 14
    before: "coiony"
    after: "colony"
  - op: ellipsis-join
    between: [0, 1]
    separator: " … "
```

- No other `op` is permitted. An edit MUST NOT rewrite, paraphrase, reorder spans,
  insert unsourced text, or target text introduced by an earlier edit. This closed set
  is the guarantee that cleanup cannot become authoring.

### Reconstruction algorithm (deterministic)

The validator reconstructs a quote's presentation and compares it to `text`
byte-for-byte:

1. Take each span's `raw`, in order, as its working string.
2. Apply the quote's `ocr-fix` edits **in declared order**: for each, at the target
   span's offset (`at`, or the sole occurrence of `before`), verify the current bytes
   equal `before`, then replace with `after`. Edits within a span MUST NOT overlap.
3. Join the spans in order: between span `i` and span `i+1`, insert the `separator` of
   the `ellipsis-join` declared for that pair. (A quote of N spans has exactly N−1
   such joins, over consecutive pairs.)
4. The result MUST equal `text` byte-for-byte. On mismatch, the validator reports the
   quote id and the first differing byte/range between the reconstruction and `text`;
   it does not infer what undisclosed operation occurred.

## Validation rules (the deterministic gate)

**Step 0 — Structural validity (before any fidelity check).** Reject, naming the
defect, if: the bank's `version` is unknown; a source id mapping is ambiguous
(duplicate/case-colliding/invalid id — FR-018); a required field is missing; a quote
`id` is not unique in the bank; a span list is empty; a `source` does not resolve; an
edit references a nonexistent span; the ellipsis-join count is not (spans − 1) over
consecutive pairs; an `ocr-fix` is ambiguous or overlaps another. No fidelity check
runs on a structurally invalid bank.

**Fidelity — for every quote**, all of the following MUST hold or the bank is rejected
naming the offending quote/span:

1. **Source resolves** — `source` names a supplied source document.
2. **Verbatim spans** — each span's `raw` is an exact byte-for-byte substring of that
   source (no Unicode normalization, no case folding, no whitespace collapsing).
3. **Reproducible presentation** — the reconstruction algorithm above reproduces `text`
   **byte-for-byte**.
4. **Closed edit set** — every edit is an `ocr-fix` or `ellipsis-join`; no other kind.

**Advisory (non-blocking)** — a span occurring more than once in its source with no
recorded `offset` is accepted if faithful but reported **location-ambiguous**, for
downstream citation tooling.

The verdict uses no language model, no similarity threshold, and no network. Neither
the validator nor the miner modifies the supplied sources. The same bank + sources
yield the same verdict on every run.

## Relationships & lifecycle

- `quote-bank ← [sources]`: the bank is derived from the sources.
- A quote references exactly one `source`; a source may back many quotes; a passage
  may back more than one quote (each independently valid).
- **Freshness**: the bank restales when `sources` change (new material). A change to
  only the producing model's version is **producer drift** (reported, not
  auto-restaled). Regeneration is a deliberate human action, never automatic.
- **Model identity, no core change (FR-020)**: the miner encodes the model it used
  within the producer identity it already reports in its BuildResponse `tool`
  (`{ name, version }`) — e.g. the `version` incorporates the model id. A model change
  therefore surfaces through production-control's **existing** producer-drift reporting
  (which compares recorded tool name/version), with no new provenance field and no
  production-control core change. Tool-version drift, model-version drift, and
  configuration drift are all expressed through that one existing channel.
- **Impurity**: the bank is produced by an impure miner (selection varies), so it is
  committed as the durable record; its fidelity — the thing that must not vary — is
  guaranteed by the deterministic validator regardless.

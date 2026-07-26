# Contract: coverage-ledger-schema (the YAML ledger document, D10)

The coverage ledger is the declared per-source-unit disposition mapping —
"the authoritative editorial declaration" (D22) that `voice fidelity`
corroborates. This document specifies the schema and its one loader; the schema
itself is defined in full, with validation rules and relationships, in
`../data-model.md` ("Coverage ledger" section) — this file is the wire-format
reference a producer or a hand-authoring human reads to write one correctly.

## Carrier (v1: YAML frontmatter; carrier-independent by design, D10)

v1's carrier is the edition's own YAML frontmatter block (the first `---`…`---`
delimited region of the edition file). The **schema is carrier-independent**: it
is a self-contained YAML document, and the package exposes exactly **one**
loader:

```ts
function loadLedger(yamlText: string): CoverageLedger
```

`loadLedger` has no knowledge of where `yamlText` came from. v1's caller extracts
it from frontmatter; a later carrier (a sidecar file, once
`design:feature/directory-outputs` lands) would extract the same string from a
different location and call this same function unchanged. This is what makes a
future carrier move a **carrier swap in the provider and validator's I/O layer,
not a schema or fidelity-logic redesign** (D10).

## Shape

```yaml
ledger:
  version: 1
  source: { identity: ebook-ch01, hash: sha256:9a1c...64hex }
  voice:  { identity: voice-archival-restraint, hash: sha256:4f2e...64hex }
  coverage:
    - source_unit: { hash: sha256:aab1...64hex, occurrence: 0 }
      op: verbatim
      edition_units: [ { hash: sha256:aab1...64hex, occurrence: 0 } ]

    - source_unit: { hash: sha256:cc21...64hex, occurrence: 0 }
      op: represented
      treatment: compressed          # optional, non-normative
      edition_units: [ { hash: sha256:d091...64hex, occurrence: 0 } ]

    - source_unit: { hash: sha256:e711...64hex, occurrence: 0 }
      op: merged
      edition_units: [ { hash: sha256:d091...64hex, occurrence: 0 } ]  # shared with entry above

    - source_unit: { hash: sha256:0b44...64hex, occurrence: 0 }
      op: cut
      reason: "restates the death count carried by the preceding unit"
```

The `merged` example above shares destination `sha256:d091…` (occurrence 0) with
the `represented` entry — that shared destination is the mechanical condition
that distinguishes `merged` from `represented` (D8); it is not implied by naming
alone.

## Field reference

See `../data-model.md` § "Coverage ledger" for the authoritative field table,
required/conditional rules, and the closed operation-set obligation table. This
contract restates only what a hand-authoring human or a producer implementation
needs at a glance:

- `version` — literal `1`; any other value is refused before any entry is read.
- `source.hash` / `voice.hash` — full `sha256:<64 lowercase hex>`, matching
  `HashSchema` (`src/manifest/schema.ts`) exactly, so the ledger's hash format
  never diverges from the rest of the system's.
- `coverage[].op` — one of the closed set `verbatim` | `represented` | `merged` |
  `cut`. There is no fifth op and none may be added without a version bump (D8's
  whole point was collapsing an open-ended editorial vocabulary into a closed,
  mechanically distinct set).
- `coverage[].edition_units` — always a **list**, even for `verbatim`'s exactly-
  one-destination case (`[{ hash, occurrence }]`, not a bare object) — so the
  schema has one shape for 1:1, 1:M, M:1, and M:N mappings (D9).
- `coverage[].reason` — present **only** on `cut`; non-empty after trimming
  whitespace (same refinement as `WaiverSchema`/`BuildImpureSchema` elsewhere in
  this system).

## Additive extensibility (D21, FR-016)

The loader MUST NOT reject an entry carrying unknown additional keys at the
`CoverageEntry` level — only the fields specified above are validated strictly.
This is what lets deferred blended-voice fields (`function:`, `voice:` per unit,
recorded in the design record's "Deferred scope" section) land in a future
version without breaking v1-written ledgers or requiring every v1 loader in the
wild to be updated in lockstep. `version` itself stays a strict literal check —
extensibility applies to entry-level keys, not to a silent reinterpretation of
what `version: 1` means.

## What this schema does NOT decide

- It does not decide *how* a producer arrives at a disposition — that is
  `voice-revise-provider.md`'s concern.
- It does not decide *how* a disposition is checked — that is
  `voice-fidelity-validator.md`'s concern (per-op obligations, payload matching).
- It carries no subject-specific vocabulary — `treatment` is free text precisely
  because it is non-normative decoration, never a second, informally-enforced
  operation set growing beside the closed one (D8's rejection of the first
  draft's `kept`/`compressed`/`moved` triad, which "encoded editorial
  description, not mechanical obligation").

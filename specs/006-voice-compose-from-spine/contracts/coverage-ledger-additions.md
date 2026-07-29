# Contract: coverage-ledger additions (mode + grounding)

Extends `specs/004-voice-editions/contracts/coverage-ledger-schema.md`. Lands on the ledger's additive-extensibility seam (D21); `loadLedger` is extended to validate the new fields structurally.

## New ledger-level fields

```yaml
version: 1
source: { identity: <str>, hash: <sha256> }
voice:  { identity: <str>, hash: <sha256> }
mode: compose            # NEW — closed enum: compose | revise
coverage: [ ... ]        # unchanged shape; mode-scoped legality enforced elsewhere
grounding:               # NEW — REQUIRED+non-empty iff mode==compose; ABSENT iff mode==revise
  - edition_unit: { hash: <sha256>, occurrence: <int> }
    basis: grounded      # closed enum: grounded | connective | framing
    beats:               # REQUIRED+non-empty iff basis==grounded; ABSENT otherwise
      - { hash: <sha256>, occurrence: <int> }
```

## `loadLedger` validation rules (structural, from the ledger's own bytes — D20)

- `mode`: if present, MUST be `compose` or `revise`. If **absent**, default to `revise` (backward compatibility with pre-006 editions).
- `grounding`:
  - `mode == compose` → `grounding` MUST be present and non-empty; each record structurally valid.
  - `mode == revise` → `grounding` MUST be absent (v1; revise reverse-accounting is TASK-51).
- Each `GroundingRecord`:
  - `edition_unit`: a valid `UnitRef` (`{hash: non-empty string, occurrence: non-negative int}`).
  - `basis`: MUST be `grounded` | `connective` | `framing`.
  - `beats`: present and non-empty **iff** `basis == grounded` (each a valid `UnitRef`); MUST be absent for `connective`/`framing`.
- Fail-loud, naming the offending record index/field (matches existing loader style).

## Deliberately NOT checked by `loadLedger` (validator concerns — needs the derived edition)

- Whether every derived edition unit has exactly one grounding record (exhaustive/exclusive) — `check-edition-grounding.ts`.
- Whether a `grounded` record's `beats` name real derived source units — `check-edition-grounding.ts`.
- Whether a destination is a whole-unit copy of a beat — `check-no-copy.ts`.
- Mode-scoped op legality (no verbatim/cut in compose) — `check-op-obligations.ts` (mode-aware) / `policy/op-legality.ts`.

## Backward compatibility

Existing revise ledgers (no `mode`, no `grounding`) load unchanged: `mode` defaults to `revise`, `grounding` absent is legal for revise. SC-006 (54 shipped editions still valid) holds.

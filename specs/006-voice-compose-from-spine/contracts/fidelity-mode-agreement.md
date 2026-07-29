# Contract: fidelity validator — mode agreement, grounding, no-copy

Extends the `voice fidelity` validator (`fidelity/cli.ts`, `fidelity/run.ts`) with mode-awareness. All additions are pure/deterministic; the validator remains independent of the producer (Principle VI).

## `ValidateRequest` wire addition

```json
{
  "version": 1,
  "target": "<str>",
  "artifact": { "path": "<edition>", "hash": "<sha256>" },
  "inputs": { "source": { "path": "<spine>", "hash": "<sha256>" }, ... },
  "requested_mode": "compose"   // NEW — OPTIONAL
}
```

- `requested_mode` OPTIONAL, closed enum `compose | revise`. A governed build supplies it (from the provider recipe); standalone use omits it.

## Check ordering (`run.ts`)

Mode agreement is sequenced **first**, then the existing source-side checks, then the compose-only edition-side checks:

1. **mode-agreement** (`check-mode-agreement.ts`): if `requested_mode` supplied and `!= ledger.mode` → FAIL (`mode mismatch: requested <x>, ledger <y>`), before any op-legality. If absent → pass; set report `mode_comparison: none-supplied`.
2. source-hash → ledger-structure → citation-allowlist → unit-accounting (source) → op-obligations — **now mode-aware**: in compose, `verbatim` and `cut` ops are illegal dispositions (fail); revise unchanged.
3. payload/citations (existing).
4. **edition-grounding** (`check-edition-grounding.ts`, compose only): exhaustive + exclusive over derived edition units; grounded `beats` resolve. FAIL names the unaccounted edition unit / dangling record.
5. **no-copy** (`check-no-copy.ts`, compose only): no represented/merged destination is normalized-byte-identical to a complete beat it represents.

## Report fields (always emitted for a composed edition — FR-012)

```
mode: compose
mode_comparison: matched | none-supplied
spine_source_fidelity: not-checked
composition_semantic_grounding: not-checkable
open_question_markers: enforced | none-declared
```

These are reported facts. The validator MUST NOT emit a verdict implying semantic grounding, invented-fact detection, or spine-source correctness were proven.

## Verdict semantics (unchanged discipline)

- A single failed check withholds the pass verdict (existing full-check-set rule).
- A cannot-decide condition (e.g. malformed request) is its own non-pass state, named — never a silent pass (Principle V).
- Standalone validation with no `requested_mode` still produces a verdict per `ledger.mode`, with `mode_comparison: none-supplied` recorded so the reader knows no independent comparison occurred.

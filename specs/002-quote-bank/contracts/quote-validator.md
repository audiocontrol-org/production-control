# Contract: quote-validator (a production-control validator)

The validator is an independent production-control **validator** — it speaks the
existing ValidateRequest/ValidateResponse contract (`src/providers/contract.ts`),
declared as the `quote-bank` target's `validator`, distinct from its `provider`
(the miner). It is run by `pc validate quote-bank`.

## Invocation

`bin/quote-validator.mjs` — a subprocess reading one ValidateRequest on stdin,
writing one ValidateResponse on stdout. It reads only; it writes nothing. Runnable
by hand:

```
echo '<ValidateRequest>' | editorial-tooling/bin/quote-validator.mjs
```

## Input (ValidateRequest, on stdin)

```json
{
  "version": 1,
  "target": "quote-bank",
  "artifact": { "path": "/abs/quote-bank.yaml", "hash": "sha256:…" },
  "inputs": { "sources": { "path": "/abs/sources", "hash": "sha256:…" } }
}
```

- `artifact.path` is the already-built quote bank; `inputs.sources.path` is the same
  sources directory the build saw. production-control has already confirmed the
  artifact on disk matches its recorded hash before calling.

## Behavior (deterministic — no LLM, no threshold, no network)

Parse the bank, then in order:

- **Structural check first** — reject before any fidelity check on: unknown `version`;
  an ambiguous source-id mapping (duplicate/case-colliding/invalid id); a missing
  required field; a non-unique quote `id`; an empty span list; a `source` that does not
  resolve; an edit referencing a nonexistent span; an ellipsis-join count ≠ (spans − 1)
  over consecutive pairs; an ambiguous or overlapping `ocr-fix`.
- **Fidelity — for every quote**: (1) `source` resolves; (2) each span's `raw` is an
  exact byte-for-byte substring of that source; (3) the reconstruction algorithm
  (data-model.md) reproduces `text` byte-for-byte; (4) every edit is in the closed set.
- **Advisory** — a repeated span with no `offset` is accepted if faithful but flagged
  location-ambiguous (non-blocking).

The validator reads only; it modifies nothing.

## Output (ValidateResponse, on stdout)

```json
{ "version": 1, "state": "passed" }
```

or, on any violation:

```json
{
  "version": 1,
  "state": "failed",
  "errors": [
    "quote 'q-076-3' (source PB-P076): span 1 raw is not a substring of the source",
    "quote 'q-081-2': reconstruction does not match recorded text; first difference at byte 42"
  ]
}
```

- Errors name the quote by **id** and, for a reconstruction failure, report the
  **mismatch between the mechanically reconstructed presentation and the recorded
  text** (first differing byte/range) — never an inference of what undisclosed edit
  occurred.
- `passed` only if the bank is structurally valid **and** every quote passes fidelity;
  otherwise `failed` with each violation named. A validator that cannot reach a verdict
  (malformed input, unreadable source) exits non-zero with a diagnostic — "no verdict"
  is not "passed" (FR-006b): production-control records it as unresolved, never a false
  clean.

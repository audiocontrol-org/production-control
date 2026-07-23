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

Parse the bank; for **every** quote verify all four rules from data-model.md:

1. `source` resolves to a source document under `sources`.
2. Each span's `raw` is an **exact byte-for-byte substring** of that source.
3. Re-applying the `edits` to the spans' `raw` bytes reproduces `text` byte-for-byte.
4. Every edit is within the closed set (`ocr-fix`, `ellipsis-join`).

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
    "quote #3 (source PB-P076): span 1 raw is not a substring of the source (fabricated)",
    "quote #5: edits do not reproduce text byte-for-byte (undisclosed alteration)"
  ]
}
```

- `passed` only if **every** quote passes; otherwise `failed` with each violation
  named. A validator that cannot reach a verdict (malformed input, unreadable
  source) exits non-zero with a diagnostic — "no verdict" is not "passed"
  (FR-006b): production-control records it as unresolved, never a false clean.

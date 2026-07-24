# Contract: quote-miner (a production-control provider)

The miner is an ordinary production-control **provider** — it speaks the existing
BuildRequest/BuildResponse contract (`src/providers/contract.ts`). No new
production-control contract is introduced.

## Invocation

`bin/quote-miner.mjs` — a subprocess reading one BuildRequest on stdin, writing one
BuildResponse on stdout. Runnable by hand with no production-control present:

```
echo '<BuildRequest>' | editorial-tooling/bin/quote-miner.mjs
```

## Input (BuildRequest, on stdin)

```json
{
  "version": 1,
  "target": "quote-bank",
  "inputs": { "sources": { "path": "/abs/local/sources", "hash": "sha256:…" } },
  "output_dir": "/abs/empty/output/dir"
}
```

- `inputs.sources.path` is a resolved local **directory** of plain-text source
  documents, each carrying a stable source id.

## Behavior

1. Read every source document under `sources` and its id.
2. For each source, ask the model (via the `claude` CLI) to **select** quotable
   passages — pointing at them, not transcribing.
3. **Ground** each selection: locate it in the source and extract the exact byte
   span from the source itself; record `spans[].raw`, the presentation `text`, and
   the disclosed closed-set `edits`. A selection that cannot be grounded to an exact
   span is **omitted**.
4. Write the quote bank (YAML, per data-model.md) into `output_dir`.

## Output (BuildResponse, on stdout)

```json
{
  "version": 1,
  "outputs": [{ "path": "quote-bank.yaml" }],
  "tool": { "name": "quote-miner", "version": "0.1.0" },
  "impure": { "reason": "selects quotable passages via a language model; selection varies by model and run" }
}
```

- `impure` MUST be present (selection is non-reproducible). production-control records
  it and routes the output to the committed `ai-generated/` tree.
- **No `validation`** is reported — the miner never certifies its own output;
  acceptance is decided solely by the independent validator (see
  `quote-validator.md`).
- `outputs` is exactly one (the bank file, even if it holds zero quotes) —
  production-control's ingest admits a single output. The `tool.version` encodes the
  model identity used, so a model change surfaces through the existing producer-drift
  reporting (FR-020), no core change.

## Mining report (FR-017) — stderr

The miner writes a machine-readable **mining report** to **stderr** (diagnostics — not
a declared output, since ingest admits exactly one; visible by hand and in logs). It
records per-source and totals, e.g.:

```
selected: 30
grounded: 18
omitted_ungrounded: 12
sources_processed: 5
sources_skipped: 0
sources_failed: 0
```

A bank may pass fidelity while the report reveals weak selection — the two are separate.

## Failure levels (FR-015/FR-016)

- **Candidate** cannot be grounded → omitted, counted in the report. Not a failure.
- **Source** cannot be processed (unreadable, not UTF-8) → the run **fails**; no bank is
  emitted.
- **Provider** failure or interruption → the run fails **atomically**: the miner writes
  a complete bank only on success, and production-control's staged, atomic ingest never
  replaces a previously committed bank on a failed build. A malformed request, an
  unreadable source, or an unavailable model each fail loud (non-zero exit, stderr) —
  never a partial or fabricated bank.

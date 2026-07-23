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
- `outputs` is non-empty (the bank file, even if it holds zero quotes). Fail loud
  (non-zero exit, stderr naming the cause) on: a malformed request, an unreadable
  source, or the model being unavailable — never a partial or fabricated bank.

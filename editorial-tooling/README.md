# editorial-tooling

A standalone, reusable, subject-agnostic craft package for building and verifying a **quote bank**: verbatim, source-cited, fabrication-checked passages mined from a project's primary sources.

## What It Is

Editorial-tooling is a pair of independent command-line tools packaged as plain ESM `.mjs` files with no build step, no coupling to production-control (it speaks production-control's subprocess+JSON provider/validator contracts but imports no production-control code), and can be run entirely by hand. Tested with `node --test`; a single dependency (`yaml`) for parsing and serializing quote-bank YAML.

The quote bank itself is a YAML document containing structurally valid, source-verified quotes. Each quote carries:
- A stable id
- A reference to a source document
- Spans: exact byte excerpts from the source
- A presentation text (reconstructed from spans via disclosed edits)
- A closed set of edits: `ocr-fix` (within-span corrections) and `ellipsis-join` (joining spans)
- Optional metadata: notes, location

The schema is **extensible** (future fields may be added); **v1 adds no extra fields**. For the authoritative schema definition and reconstruction algorithm, see [`../specs/002-quote-bank/data-model.md`](../specs/002-quote-bank/data-model.md).

## The Two Tools

### quote-validator.mjs

**Independent, deterministic quote-fidelity validator.**

- **What it does**: reads a `ValidateRequest` on stdin, verifies that every quote in a quote bank is structurally valid *and* verbatim-faithful to its cited source (each span's `raw` is an exact byte substring; re-applying the disclosed closed-set edits reproduces the presentation `text` byte-for-byte), and writes a `ValidateResponse` on stdout.
- **No LLM, no network, no threshold**: purely deterministic. Either the quote is faithful or it is not.
- **Trust anchor**: the validator passes or fails the bank; it is the sole arbiter of what is quotable. This makes it valuable on its own, independent of how the bank was produced.
- **By-hand invocation**:
  ```
  echo '<ValidateRequest>' | node bin/quote-validator.mjs
  ```

The `ValidateRequest` specifies paths to the artifact (the quote bank YAML) and the sources directory. On success, stdout is `{"version": 1, "state": "passed"}`. On failure, stdout includes an array of errors. Advisories (non-fatal issues) are written to stderr.

### quote-miner.mjs

**Language-model-driven producer: selects quotable passages, then grounds them.**

- **What it does**: reads a `BuildRequest` on stdin, asks a language model (via the `claude` CLI) to identify quotable passages from source documents, then *grounds* each selection by copying the exact byte-for-byte source excerpt (re-confirming it exists and is unambiguous), writes the resulting quote bank YAML into the output directory, and writes a machine-readable mining report to stderr.
- **Impure and transparent about it**: unlike the validator, the miner depends on a language model and can fail in ways beyond validation. It declares itself impure and **reports no validation verdict of its own** — acceptance is decided solely by the validator.
- **Ungroundable selections are omitted, never emitted unverified**: if the model selects a passage that cannot be located in the source or is ambiguous, it is silently omitted from the bank.
- **Structured model output, not hand-written JSON**: on the default path the miner invokes `claude -p --output-format json --json-schema <inline schema>` and reads candidates from the envelope's `structured_output.candidates`. The CLI — not the model's prose — owns the JSON encoding, so a passage dense with guillemets or typographic quotes can no longer produce an unterminated string that kills a whole corpus run.
- **Bounded retry**: the model is stochastic, so each source's model call is retried on spawn error, non-zero exit, or unparseable output (default 3 attempts total; `QUOTE_MINER_MODEL_MAX_ATTEMPTS`, plus an optional `QUOTE_MINER_MODEL_RETRY_DELAY_MS` backoff that defaults to 0). After the last attempt it fails loud — it never degrades to "this source had nothing quotable".
- **Real model identity in `tool.version`**: the response envelope names the model actually used (`modelUsage` → `canonicalModel`), and that identity — e.g. `0.1.0+claude-opus-5`, not `0.1.0+claude` — is what the `BuildResponse` reports, so a model swap behind a fixed `claude` command surfaces as producer drift.
- **Sources are mined concurrently, output is deterministic**: sources are independent (grounding is a byte search against *that* source's own bytes, and quote ids are `q-<sourceId>-<n>`, scoped per source), so they are mined through a bounded worker pool instead of one at a time — a 100+ source corpus no longer costs an hour of wall clock in which any interruption discards every completed source. **Assembly does not follow completion order**: each source's result lands in a slot keyed by its original index, so the bank's `quotes` and the report's `per_source` are always in source order and the same model responses produce the same bytes whatever finishes first. The bound defaults to 4 (each model call is a full `claude` subprocess) and is set with `QUOTE_MINER_CONCURRENCY` or the `concurrency` option; a non-integer or `< 1` value fails loud rather than being clamped, and `1` is exactly the old serial path. Failure stays atomic: the first failing source fails the whole run, no further sources are scheduled, in-flight work is awaited to settlement, and no bank is written.
- **Two mining strategies, chosen explicitly (`QUOTE_MINER_STRATEGY`)**: see [Mining Strategies](#mining-strategies) below. The default is `per-source`; `agent` is opt-in.
- **A killed run is resumable (`QUOTE_MINER_CACHE_DIR`)**: see [Resumable Mining](#resumable-mining) below. Off unless you name a directory.
- **Model override via env var**: set `QUOTE_MINER_MODEL_CMD` to override the model command used (default: `claude`). A command whose basename is not `claude` is invoked with plain args and its stdout parsed as a bare JSON array of candidates — the stand-in/fake-model seam used by the tests. `QUOTE_MINER_MODEL_ID` pins the recorded model identity by hand and outranks everything else.
- **By-hand invocation**:
  ```
  echo '<BuildRequest>' | node bin/quote-miner.mjs
  ```

The `BuildRequest` specifies paths to the sources directory and an output directory. Stdout is a `BuildResponse` (success/failure; never partial output on failure). Stderr carries the mining report (counts: selected, grounded, omitted_ungrounded, sources processed/skipped/failed, and per-source breakdowns), plus a `progress: <completed>/<total> <id> [source <n>] selected=… grounded=… omitted=…` line emitted as each source completes so a long run is observable while it runs. Because sources are mined concurrently, completions do not arrive in source order: the leading counter is the number of sources *finished* (so it only ever climbs), while `[source <n>]` is that source's original position in the corpus.

## Mining Strategies

The miner has two interchangeable model adapters. They differ only in *how the model is asked*; everything downstream — grounding, disclosed edits, the bank, the validator's verdict — is identical, and the two produce byte-identical banks for identical model output. `QUOTE_MINER_STRATEGY` picks one; an unrecognized value fails the run rather than quietly choosing.

### `per-source` (default)

One `claude -p` invocation per source, with that source's text in the prompt.

- **Portable.** This adapter needs only *a CLI that takes a prompt and returns JSON*. That is the whole contract, which is why it is the default seam: any other model tool — a different vendor's CLI, a local model wrapper, a stand-in binary — can be dropped in through `QUOTE_MINER_MODEL_CMD` without touching the miner.
- **Best covered.** It carries the bulk of the test suite and every by-hand corpus run to date.
- **Expensive at scale.** Every invocation rebuilds Claude Code's system prompt and tool definitions: 15,667–37,788 `cache_creation_input_tokens` measured for even a trivial prompt. Over a 123-source corpus that setup is paid 123 times, on top of pushing the corpus text (6.9 MB in the case that motivated this) through prompts.

### `agent` (opt-in)

One `claude` invocation per *chunk* of sources, which dispatches one subagent per source (`Task`); each subagent reads its own file (`Read`) and returns the passages it selected, and the top-level run aggregates them into a single schema-conforming envelope.

- **Dramatically cheaper on a large corpus.** The CLI setup cost is paid once per chunk instead of once per source, and **source text never enters a prompt** — only file paths do, because the subagents open the files themselves.
- **Claude-Code-specific.** It depends on subagents, the `Task` and `Read` tools, and `--json-schema`. It is *not* portable to "any CLI that takes a prompt", which is exactly why it is opt-in rather than the default.
- **Chunk size** is `QUOTE_MINER_CHUNK_SIZE` (or the `chunkSize` option), default 10. Chunks are dispatched through the same bounded-concurrency pool as everything else, so chunks run concurrently *and* each one fans out internally; a non-integer or `< 1` value fails loud.
- **Cost accounting on stderr**: each batch emits `batch-usage: sources=… turns=… cache_creation_input_tokens=… …` from the response envelope, so the saving is measurable rather than assumed.
- **A source the model does not answer for fails the run.** It is *not* recorded as "nothing quotable". A missing answer and a barren source are different facts, and conflating them is the false-clean that once let roughly a quarter of a 123-source corpus contribute nothing while the run reported complete success. The failure happens inside the retry budget, so a dropped subagent normally costs one extra attempt; only a chunk that fails every attempt fails the run — atomically, writing no bank.

**Fidelity is unaffected by the choice.** Whoever read the file, every candidate is still grounded against the bytes *the miner itself loaded*, and anything that is not an exact byte substring of them is omitted (FR-014). Grounding never consults what a subagent claims a file says, so a subagent that misreads, paraphrases, or hallucinates is caught exactly as a hallucinating single model was.

## Resumable Mining

Mining a real corpus takes tens of minutes and the build is **atomic** — the miner never returns a partial bank. That is the right contract (a half-corpus bank would be a lie), but it means a kill, a rate limit, or one bad model response at source 59 discards every source that already succeeded. It happened three times on real runs.

Set **`QUOTE_MINER_CACHE_DIR`** (or pass `cacheDir` to `mine()`) and each source's **model output** is persisted the instant that source completes. A later run over the same corpus skips the model call for anything already on disk and pays only for the misses.

- **Off by default, and the location is never inferred.** No env var, no option, no cache — no directory is created and no file is written, which is byte-for-byte the previous behaviour. In particular the cache must *not* live inside the sources directory: that directory is a content-hashed production-control **input**, so writing into it would change the input hash and spuriously re-stale the bank on every build. Nor can it live in the output directory, where ingest admits exactly one file. So the operator says where.
- **The key is content.** An entry is keyed by the SHA-256 of the source's exact bytes plus a `PROTOCOL_VERSION`. A renamed but unchanged source therefore **hits** (a rename is not new work); a source edited by one character **misses** (its old candidates describe a document that no longer exists); and bumping `PROTOCOL_VERSION` when the prompt or candidate shape changes makes every old entry unreachable rather than silently reused under new semantics.
- **Only the model call is skipped.** Grounding, correction verification, and assembly run on the identical code path for cached and fresh candidates. **Nothing but candidates is cached** — grounded quotes never are. Grounding is cheap and deterministic, so there is nothing to save by caching it, and caching it would turn the cache into a fidelity bypass. A stale or tampered entry can make a run emit *fewer* quotes; it can never make it emit an ungrounded one.
- **Entries are written atomically, per source, immediately.** Temp file plus rename, as each source finishes — writing at the end of the run would cache nothing in exactly the case the cache exists for. A malformed, truncated, unreadable, or wrong-version entry is **ignored** (treated as a miss) and counted in `cache_entries_ignored`; a rotten cache is never fatal and is never trusted.
- **It composes with both strategies.** On the per-source path a cached source never reaches the model. On the `agent` path cached sources are filtered out of a chunk before it is dispatched, and a chunk whose sources are all cached spawns nothing at all.
- **Determinism is unchanged.** The bank's `quotes` and the report's `per_source` stay in original source order whatever was cached, and a resumed run's bank is byte-identical to the run it resumed.
- **Mixed model provenance is disclosed, not forbidden.** A resumed run can legitimately mix models — sources cached under yesterday's model, fresh ones under today's. Refusing the mix would throw away the completed work the cache exists to preserve, so the mix is allowed and *stated*: the report lists `model_identities`, warns loudly when there is more than one, and `tool.version` becomes `0.1.0+mixed(<id>+<id>)` over the sorted list rather than picking one identity and implying uniformity. A run served entirely from cache reports the **cached** identity, never the configured model that produced none of it.
- **The declared output contract is untouched.** Still exactly one `quote-bank.yaml` in `output_dir`, still `impure`, still no `validation`. The cache is not an output, not an input, and not part of any hash.

Resumption shows up on stderr: `sources_from_cache`, `cached_sources`, `cache_entries_ignored`, and `model_identities` in the mining report, plus a ` cache=hit` marker appended to the `progress:` line of each replayed source.

## Source Ids

Both tools load the sources directory through one shared module (`src/sources.mjs`), so the miner and the validator always agree on which bytes carry which id.

- **Manifest mode** — if the sources directory contains a `sources.yaml`, that file is the id carrier:

  ```yaml
  version: 1
  sources:
    PB-P001: newspapers/la-nouvelle-france/1879-07-15_x/issue.txt
    PB-P023: newspapers/a-nobleman/issue.txt
  ```

  Each key is the stable source id (the id quotes cite); each value is a path relative to the sources directory, nesting allowed. This is what makes an archive whose every document is named `issue.txt` loadable. Paths must stay inside the sources directory — an absolute path or one escaping via `..` is refused.

- **Fallback mode** — with no `sources.yaml`, the id of each regular file directly in the sources directory is its filename stem (the v1 rule, unchanged).

A source that cannot be loaded is a hard failure, never a silent skip: an ambiguous id (duplicate, case-collision, path separator), a missing or non-regular declared path, an unreadable file, or a file that is not valid UTF-8. **Every** such problem is collected and named in a single refusal, so a large corpus can be fixed in one pass rather than one run per bad file. The id mapping is the only thing this affects; the fidelity model (byte-exact spans, reconstruction, validator verdicts) is unchanged.

## The Quote Bank Schema

A quote bank is a YAML file with:
- `version`: integer literal (currently `1`)
- `quotes`: a list of quote objects, each with:
  - `id`: unique name within the bank
  - `source`: reference to a source document by id
  - `spans`: list of exact byte excerpts from the source (each with `raw` and optional `offset` for disambiguation)
  - `text`: readable presentation
  - `edits`: array of disclosed transformations (from the closed set `ocr-fix` and `ellipsis-join`)
  - `note`: optional human-readable disclosure
  - `location`: optional page/line reference

The validator reconstructs `text` from `spans` and `edits` to confirm fidelity. For the full schema specification, reconstruction algorithm, and validation rules, see [`../specs/002-quote-bank/data-model.md`](../specs/002-quote-bank/data-model.md).

## Running Tests

Tests use `node --test`. From the package directory:

```bash
npm install
npm test
```

Or directly:

```bash
node --test
```

Tests verify:
- Structural and fidelity validation
- Edit reconstruction (ocr-fix and ellipsis-join)
- Source mapping and ambiguity detection
- End-to-end mining and validation flows
- Stdin/stdout contract compliance for both tools

## Independence of the Two Tools

The validator and miner are **independent components**:

- **The validator can check ANY quote bank** however it was produced. It does not know or care whether the bank came from the miner, a human editor, or another tool. It is the trust anchor and is valuable on its own.
- **The miner is disposable and replaceable**. Because the independent validator gates all output, a new or different mining strategy can be swapped in without affecting the downstream contract. The validator's determinism makes replacement safe.

This separation is intentional: it allows the validator to serve as a standalone quality gate while the miner remains an experimental producer.

## No Coupling to production-control

Editorial-tooling speaks the subprocess+JSON contracts defined in `../specs/002-quote-bank/contracts/` but imports no code from production-control. It can be:
- Run independently as a CLI tool
- Embedded in other workflows
- Tested in isolation
- Extended with alternative mining strategies (because validation is independent)

The contracts are the sole interface; the implementation is self-contained.

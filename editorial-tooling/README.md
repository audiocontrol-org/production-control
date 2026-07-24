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
- **Model override via env var**: set `QUOTE_MINER_MODEL_CMD` to override the model command used (default: `claude -p`). This is used for testing with a fake model.
- **By-hand invocation**:
  ```
  echo '<BuildRequest>' | node bin/quote-miner.mjs
  ```

The `BuildRequest` specifies paths to the sources directory and an output directory. Stdout is a `BuildResponse` (success/failure; never partial output on failure). Stderr carries the mining report (counts: selected, grounded, omitted_ungrounded, sources processed/skipped/failed, and per-source breakdowns).

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

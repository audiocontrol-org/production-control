# Contract: voice-revise (a production-control provider)

The producer is a production-control **provider** — it speaks the existing
`BuildRequest`/`BuildResponse` contract (`src/providers/contract.ts`), declared as
a voice-edition target's `provider`, gated by that target's independent
`validator` (`voice-fidelity-validator.md`). It is run by `pc build <target>`.
It is the **generative half** — impure, and honest about it (D3).

## Invocation

`bin/voice-revise.mjs` — a subprocess reading one `BuildRequest` on stdin, writing
one `BuildResponse` on stdout, and a structured production report on stderr.
Runnable by hand:

```
echo '<BuildRequest>' | voice-tooling/bin/voice-revise.mjs
```

## Input (`BuildRequest`, on stdin)

```json
{
  "version": 1,
  "target": "prologue-archival-restraint",
  "inputs": {
    "source": { "path": "/abs/content/ebook/prologue.md", "hash": "sha256:…" },
    "voice": { "path": "/abs/content/voices/archival-restraint.yaml", "hash": "sha256:…" }
  },
  "output_dir": "/abs/.pc-build-prologue-archival-restraint"
}
```

- Exactly two required inputs per D5/D1: the source draft and the voice. An
  optional `lexicon` input (and, per D14, an optional `quote-bank` input) MAY
  also appear in `inputs`; their presence changes which fidelity checks the
  paired validator can run, not what the provider is required to do.
- Inputs are **already resolved to local paths** by production-control before
  invocation (FR-030 of the base contract) — the provider never fetches, never
  touches object storage, and holds no credentials (Constitution IV).

## Behavior

1. Read `inputs.source` and `inputs.voice`; refuse (write a diagnostic, exit
   non-zero, produce no output) if either fails UTF-8 decoding or the voice
   document fails schema validation (unknown `version`, a missing required core
   field, or the no-author-imitation refusal — `voice-document-schema.md`).
2. Derive source units from `inputs.source` via the D6 algorithm (the same
   algorithm the validator uses — `voice-tooling` ships one `deriveUnits`
   function shared by both entry points, so producer and validator can never
   disagree about what a "unit" is).
3. Invoke the model (mirrors `editorial-tooling`'s `quote-miner.mjs` `claude`
   adapter — a spawned CLI subprocess, not a vendored SDK) with the voice's
   directives and the source text, requesting a revision **plus a disposition
   for every source unit**. The provider's job is to produce prose **and** a
   complete accounting; it does not get to omit a unit's disposition.
4. Assemble the edition body from the model's revision and the coverage ledger
   (per `coverage-ledger-schema.md`) from the model's declared per-unit
   dispositions, computing `content_hash`/`occurrence_index` for every
   `edition_units` entry by deriving edition units from the assembled body via
   the same D6 algorithm (D7 — frontmatter is written last, after unit
   derivation, so its own bytes cannot perturb the hashes it then carries).
5. Write the edition (body + frontmatter ledger) as the sole declared output.
6. **A source unit the model cannot account for fails the whole run — no partial
   edition is written** (D20, edge case: "A source unit the producer cannot
   account for fails the run with NO partial edition emitted"). This mirrors
   quote-miner's atomic bank-or-nothing behavior exactly.

### What the provider does NOT do

- It reports **no validation verdict of its own** (D3: "`voice fidelity` reports
  NO validation verdict of its own" refers to the validator being independent of
  the producer; symmetrically, `voice revise`'s `BuildResponse.validation` field
  is always omitted — acceptance is decided solely by the paired `voice-fidelity`
  validator, exactly as `quote-miner.mjs` "reports no validation verdict of its
  own").
- It never asserts semantic equivalence or voice conformance; those are outside
  what any deterministic or impure component in this feature claims (D4, D16).
- It never writes outside `output_dir`, and it declares exactly one output
  (`onlyOutput()` in `src/providers/invoke.ts` refuses more than one).

## Output (`BuildResponse`, on stdout)

```json
{
  "version": 1,
  "outputs": [{ "path": "prologue-archival-restraint.md" }],
  "tool": { "name": "voice-revise", "version": "0.1.0+claude-opus-5" },
  "impure": { "reason": "narration revised by a language model against the declared voice" }
}
```

- `impure.reason` is always present — this provider is never referentially
  transparent (FR-005).
- `tool.version` carries the **real model identity actually used**
  (`0.1.0+<model>`), matching quote-miner's precedent, so a model swap behind a
  fixed command surfaces as producer drift rather than being invisible (D18;
  depends on `gap/real-model-identity-for-drift`, TASK-14, per the design
  record's Dependencies section — same open item quote-bank already carries).
- `validation` is always absent (see above).
- No output on failure — a run that cannot account for every source unit, or
  whose model call exhausts its retry budget, or whose voice/source input fails
  validation exits non-zero with no `BuildResponse` and no edition written.

## Routing (D19 — depends on content-zone-segregation, SHIPPED)

The edition's declared output resolves under the target's `impureOutputRoot()`
(`.ai/`, a sibling of `dist/` directly under the episode dir —
`src/zoning/route.ts`). This provider makes no routing decision itself; it
declares a relative output path and production-control's existing build pipeline
(`src/providers/build.ts`, `stage()`) resolves and enforces the root. A target
whose declared output would resolve to a human-safe path is refused by the
shipped segregation gate before this provider is ever invoked with a writable
`output_dir` for that path.

## Gating (the whole point of D3)

The build accepts an edition **only if** the paired `voice-fidelity` validator
returns `state: "passed"`. A produced edition that fails validation is refused
and not accepted — no partial or unvalidated edition is left in `dist/`/`.ai/`
as if it were accepted (Acceptance Scenario US2-2). This provider's own honesty
about its output is irrelevant to acceptance; the validator is the sole arbiter,
by design (Constitution VI, "the generator never gets to certify itself" —
`src/providers/contract.ts`).

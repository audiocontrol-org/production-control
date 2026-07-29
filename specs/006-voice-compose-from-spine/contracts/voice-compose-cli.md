# Contract: `voice compose` provider CLI + model protocol

The compose producer. Shares the `BuildRequest` wire and the index-based coverage protocol with `voice revise` (spec 005); adds the grounding declaration.

## Invocation

```
voice compose   # bin/voice-compose.mjs — reads one BuildRequest JSON on stdin
voice revise    # bin/voice-revise.mjs  — unchanged
```

Both dispatch to `runProducer(mode, request)` (`revise/cli.ts`). Each verb's `--help` states its fidelity contract. `mode` is fixed by the verb; a governed build's provider recipe names the verb.

## Input (`BuildRequest`, unchanged wire)

`{ version: 1, target, inputs: { <id>: { path, hash } }, output_dir }` — exactly as spec 005. Inputs resolve by type (a valid voice document → voice; the remaining input → the spine/source), unchanged. No `mode` field on the wire (mode is the verb).

## Model protocol (compose)

The prompt (from `revise/prompt/compose.ts`) instructs the model to expand each numbered beat into voiced prose and return ONE JSON object:

```json
{
  "edition": "<full composed markdown body; edition units separated by blank lines, in reading order>",
  "coverage": [ { "op": "represented|merged", "edition_units": [<0-based indices>] } ],
  "grounding": [ { "edition_unit": <0-based index>, "basis": "grounded|connective|framing", "beats": [<0-based source-unit indices>] } ]
}
```

Rules the prompt states (producer-instruction) and the pipeline enforces (mechanical):

- Exactly one `coverage` entry per source beat, in source order; op is `represented` or `merged` — **never** `verbatim`, **never** `cut` (mechanical: `policy/op-legality.ts`).
- Exactly one `grounding` entry per edition unit (mechanical: `policy/grounding.ts` + validator).
- Every citation marker + numeral in a beat survives byte-exact into that beat's destination (mechanical: existing payload machinery).
- No destination unit is a whole-unit copy of a beat (mechanical: `check-no-copy.ts`).
- Invent nothing; promotional/defense claims as attributed assertions; preserve open-question markers (producer-instruction; the marker bytes are mechanical iff declared, R7).

## Producer pre-emit self-check (`revise/preflight.ts`)

Before `emitEdition`, over the just-parsed model output:

- compose: run `policy/op-legality.ts` (no verbatim/cut/whole-unit-copy) + `policy/grounding.ts` (exhaustive+exclusive over the model's declared edition units).
- revise: run the verbatim byte-exact self-check (each `verbatim` unit's destination equals its source unit) — **TASK-50**; refuse drift naming the unit.
- Any violation → refuse, named, **before any write** (Principle V). Producer success grants the validator nothing.

## Output

- The composed edition markdown, routed to a dot-zoned path (content-zone contract), with the coverage ledger in frontmatter.
- The ledger is built by the provider from the model's index mappings (`ledger-build.ts`), stamped `mode: compose` with resolved `grounding` records (see coverage-ledger-additions.md).

## Refusals (named; non-exhaustive)

- `compose-mode forbids verbatim: coverage entry N`
- `compose-mode forbids cut: coverage entry N`
- `whole-unit copy: edition unit E is byte-identical to beat B`
- `grounding: edition unit E has no grounding record` / `... has N records`
- `revise verbatim drift: unit U destination differs from source` (TASK-50)

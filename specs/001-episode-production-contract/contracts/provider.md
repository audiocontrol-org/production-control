# Contract: Producing Tool (Provider)

**Status**: v0.1 | **Stability**: this contract is the boundary the architecture rests on

A provider is any program that turns local input files into local output files. It is
invoked as a subprocess and speaks JSON over stdio. It is **not** a plugin, not a Node
module, and not aware of production-control.

Any tool satisfying this contract may participate. production-control never branches on
which tool it is talking to.

## Invocation

```
<cmd...>            # argv exactly as the profile declares it
stdin  <- BuildRequest   (JSON, one object)
stdout -> BuildResponse  (JSON, one object)
stderr -> diagnostics    (free-form; surfaced to the operator on failure)
exit 0 -> success; non-zero -> failure
```

## BuildRequest

```json
{
  "version": 1,
  "target": "podcast",
  "inputs": {
    "voiceover": { "path": "/abs/local/path/voiceover.wav", "hash": "sha256:9f2..." }
  },
  "output_dir": "/abs/local/path/dist/.pc-build-podcast"
}
```

| Field | Meaning |
|---|---|
| `target` | The identity being produced. Informational — the provider need not branch on it |
| `inputs` | Every declared input, **already resolved to a local path**. Keyed by identity |
| `output_dir` | An empty directory the provider owns for this build |

**Inputs are always local paths.** production-control resolves them from the cache or the
asset store *before* invoking. This is the point of the contract: **providers never touch
object storage and never hold credentials** (FR-030). The `hash` is supplied so a provider
may verify what it received; it is never a thing the provider must fetch.

## BuildResponse

```json
{
  "version": 1,
  "outputs": [{ "path": "podcast.mp3" }],
  "tool": { "name": "audio-tooling", "version": "1.2.0" },
  "validation": { "state": "passed" }
}
```

Note the absence of `impure`: **that is how a referentially transparent tool declares itself
— by saying nothing.** `"impure": false` is a REFUSAL, not a synonym for absence. Admitting
the boolean would re-open the flag-shaped declaration FR-032 exists to close: a flag says
only "expect different bytes", where a reason says *which kind* of impurity, which is the
part a reader actually needs. There is exactly one way to declare impurity, and it carries
its reason.

| Field | Required | Meaning |
|---|---|---|
| `outputs` | yes | Paths **relative to `output_dir`**. Must be non-empty |
| `tool` | yes | Name and version, recorded in the ledger for drift reporting (FR-016) |
| `impure` | no | Absent means referentially transparent. Otherwise `{ "reason": "<why>" }` — see below |
| `validation` | no | The provider's own verdict on what it produced |

```json
"impure": { "reason": "synthesizes narration via a hosted model; output varies by model version" }
```

## Rules

1. **A provider MUST be runnable by hand** with local inputs and no production-control
   present (FR-031). If it cannot be, the boundary is drawn wrong.
2. **A provider MUST NOT contact the asset store** or hold credentials for it (FR-030).
3. **A provider SHOULD be referentially transparent** — the same inputs yield the same
   outputs. No hidden state, no global config, no cache, no network.
   production-control provides the world; the provider transforms it.

   *Referentially transparent*, not *pure*: a provider writes files, so it has side effects
   by definition. What must hold is that its outputs are a function of its inputs.

4. **A provider that cannot be MUST declare `impure` AND state why** (FR-032). A clock, a
   random source, a remote fetch, or a model call all make a tool impure. Referential
   transparency is a norm, not an invariant — but an *undeclared* impurity turns
   "deterministic production" into a claim nobody checked.

   **The reason is not paperwork.** `impure: true` says only "do not expect the same bytes
   twice." A reason says *which kind* of impurity — a font fetch is incidental and fixable
   by vendoring; a model call is inherent and permanent; a clock in a filename is a bug
   someone should just fix. A reader deciding whether to trust, cache, or repair an artifact
   needs to know which. Same logic as requiring a reason on a waiver: without one, it is not
   a decision, just a flag.
5. **A provider MUST declare everything it produces.** Emitting an undeclared file is a
   failure, not a bonus (FR-033).
6. **A provider MUST NOT write outside `output_dir`.** Not enforced in v0.1 (sandboxing is
   out of scope); a violation surfaces later as a build that will not reproduce.
7. **Silence is failure.** Exit 0 with no outputs is treated as failure (FR-033) — an empty
   success recorded as success is the false-clean the ledger exists to prevent.

## What production-control does with the response

1. Hashes every declared output.
2. Ingests them to their final location.
3. Writes the ledger entry — recording the input hashes it actually supplied, the tool and
   version the provider reported, and the output hashes it computed itself.

Steps 1–3 happen in the same invocation as the build (FR-014). **There is no path that
produces an output without a record**, and no flag that suppresses recording.

Note that production-control hashes the outputs itself rather than trusting a hash from the
provider. The provider is disposable; the record must not depend on its honesty.

## Impurity and the determinism boundary

An impure provider does not break the production's reproducibility, because the ledger
records the hash of what was *actually* produced. The podcast is built from *these*
narration bytes, whose hash is recorded, whoever or whatever made them.

What impurity costs is the ability to *re-derive* that artifact identically — which is why
it must be declared and visible, rather than discovered later.

## Test double

The fake provider used throughout the test suite satisfies this contract exactly: it reads
a `BuildRequest`, writes deterministic bytes derived from its inputs, and returns a
well-formed `BuildResponse`. It requires no ffmpeg, no network, and no bucket — which is
what makes SC-007 achievable.

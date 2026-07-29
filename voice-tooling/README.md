# voice-tooling

Reusable craft tools that produce and verify voice-varied editions of a source-locked draft.

## The two entry points

### `voice compose` (impure provider)

**Role**: generates a full narrative chapter by expanding a source-cited spine of beats into voiced prose through a language model, with edition-side grounding accounting.

**Invocation**: a subprocess reading one `BuildRequest` on stdin, writing one `BuildResponse` on stdout.

```bash
echo '{"version":1,"target":"...","inputs":{...},"output_dir":"..."}' | voice-tooling/bin/voice-compose.mjs
```

**What it does**:
1. Reads the spine (source beats) and voice document
2. Invokes the configured model (via `VOICE_REVISE_MODEL` env var or explicit `provider_args`) to expand each beat into flowing narrative prose in the voice
3. Assembles the edition from model output and emits a per-unit **coverage ledger** (the mapping of every source beat to its disposition) plus per-edition-unit **grounding records** (the origin basis of each composed unit)
4. Writes the edition (body + ledger frontmatter) to a dot-zoned `.ai/` path (impure output zone)

**What it declares**:
- `impure: { reason }` — the provider is never referentially transparent; every run is non-deterministic due to the model call
- `mode: compose` in the ledger — stamps the operation mode so the validator enforces compose-specific rules
- **No validation verdict** — acceptance is decided solely by the paired `voice fidelity` validator, not by this provider

**How it differs from `voice revise`**:
- **Compose expands**; revise rewrites. Compose forbids both `verbatim` (byte-exact reproduction) and `cut` (omission) operations; every beat is `represented` or `merged` into new prose.
- **No whole-unit copy**: no destination edition unit may be byte-identical to a complete source beat it represents.
- **Edition-side grounding**: every edition unit declares exactly one origin basis (`grounded` in specific beats, `connective`, or `framing`), providing exhaustive accounting of the composed output and preventing silent invention.
- **Revise operates on a draft** (continuous prose with optional verbatim spans); **compose operates on a spine** (structured beats to be expanded).

### `voice revise` (impure provider)

**Role**: generates voice variations from a source draft by invoking a language model against the source text and declared voice directives.

**Invocation**: a subprocess reading one `BuildRequest` on stdin, writing one `BuildResponse` on stdout.

```bash
echo '{"version":1,"target":"...","inputs":{...},"output_dir":"..."}' | voice-tooling/bin/voice-revise.mjs
```

**What it does**:
1. Reads the source draft and voice document
2. Invokes the configured model (via `VOICE_REVISE_MODEL` env var or explicit `provider_args`) to revise narration
3. Assembles the edition from model output and emits a per-unit **coverage ledger** (the mapping of every source unit to its disposition in the edition)
4. Writes the edition (body + ledger frontmatter) to `output_dir`

**What it declares**:
- `impure: { reason }` — the provider is never referentially transparent; every run is non-deterministic due to the model call
- **No validation verdict** — acceptance is decided solely by the paired `voice fidelity` validator, not by this provider

### `voice fidelity` (deterministic validator)

**Role**: validates that an edition preserves required payloads (quotations, citations, numeric literals) and maintains complete accounting of source units.

**Invocation**: a subprocess reading one `ValidateRequest` on stdin, writing one `ValidateResponse` on stdout, with the structured coverage report on stderr.

```bash
echo '{"version":1,"target":"...","artifact":{...},"inputs":{...}}' | voice-tooling/bin/voice-fidelity.mjs
```

**Deterministic guarantee**: no language model, no similarity threshold, no network calls. Every obligation checked is either byte-exact or a structural schema constraint.

**What it proves**:
- Source units are completely accounted for (every unit has exactly one disposition)
- Declared literal payloads (verbatim quotes, citations, numeric literals, lexicon terms) survive where required
- The edition's coverage ledger is schema-valid and consistent
- The ledger's source hash matches the supplied source

**What it does not prove** (declared out of scope for v1):
- Semantic equivalence of rewritten prose
- Voice conformance (whether the edition adheres to voice traits)

## Machine-artifact lifecycle (.ai/ root)

An edition is an **impure machine artifact**, not authored content. It is written to the dot-zoned `.ai/` root (a sibling of `dist/` under the episode directory) by the build system and **MUST NEVER be hand-edited in place**. The `.ai/` zone enforces this: the zone is off-limits to human authoring and managed by the build system alone.

### Companion document (human polish)

Human editing or polish lives in a **separate companion document**, authored in a human-safe area and connected to the edition via the manifest's advisory `follows` edge:

```yaml
# A human-authored companion in content/companions/my-polish.md
identity: my-prologue-polish
follows: prologue-archival-restraint  # Points to the edition's identity
```

The relationship is advisory: editing the edition does not rebuild the companion, and editing the companion does not modify or invalidate the edition. This separation ensures the edition remains an auditable, machine-generated artifact while supporting human refinement outside the machine's scope.

## Coverage-report semantics

Every time `voice fidelity` reaches a decision (either passed or failed), it emits a structured coverage report to stderr with the complete check sequence:

```json
{
  "verdict": "passed",
  "mode": "compose",
  "mode_comparison": "matched",
  "spine_source_fidelity": "not-checked",
  "composition_semantic_grounding": "not-checkable",
  "checks": {
    "source_hash":             { "state": "passed" },
    "ledger_structure":        { "state": "passed" },
    "unit_accounting":         { "state": "passed", "total": 57 },
    "verbatim_quotes":         { "state": "passed", "checked": 10 },
    "citations":               { "state": "passed", "mode": "multiset", "checked": 11 },
    "numeric_literals":        { "state": "passed", "checked": 8 },
    "lexicon":                 { "state": "not-run", "reason": "no lexicon declared" },
    "uncorroborated_units":    { "state": "reported", "count": 6 },
    "op_obligations":          { "state": "passed" },
    "edition_grounding":       { "state": "passed", "edition_units": 42 },
    "no_copy":                 { "state": "passed" },
    "semantic_claim_fidelity": { "state": "not-checkable", "reason": "not provable under D4 — declared out of scope for v1" },
    "voice_conformance":       { "state": "not-checkable", "reason": "not provable under D16 — declared out of scope for v1" }
  }
}
```

For composed editions, the report additionally includes:
- **`mode`**: `compose` or `revise` — the operation mode the ledger was produced under.
- **`mode_comparison`**: `matched`, `none-supplied`, or (on mismatch) a failure state — whether the requested mode agreed with the ledger mode.
- **`spine_source_fidelity`**: `not-checked` — indicator that spine correctness is out of scope.
- **`composition_semantic_grounding`**: `not-checkable` — indicator that semantic fidelity is not provable in v1.

### Check states

Each check reports one of five states:

- **`passed`** — the obligation was checked and satisfied
- **`failed`** — the obligation was checked and NOT satisfied (a named, decided failure)
- **`not-run`** — the check was skipped because an earlier check failed (aborted), OR it was not applicable (e.g., no lexicon was declared)
- **`reported`** — a count surfaced without a pass/fail verdict (currently: uncorroborated units)
- **`not-checkable`** — the obligation is outside scope for v1 (semantic equivalence, voice conformance)

### The ten checks (source-side + compose-specific)

1. **`source_hash`** — ledger's source hash matches the supplied source
2. **`ledger_structure`** — frontmatter parses as a schema-valid coverage ledger
3. **`unit_accounting`** — every derived source unit has exactly one ledger entry
4. **`verbatim_quotes`** — quoted spans declared as `verbatim` match byte-exact and survive into declared destinations
5. **`citations`** — citation markers survive where required and no citations are fabricated
6. **`numeric_literals`** — numeric literals survive where required
7. **`lexicon`** — when a lexicon is declared, its terms survive where required (`not-run` if no lexicon)
8. **`uncorroborated_units`** — a quality count of source units yielding no extractable literal payload (reported only, never a failure threshold)
9. **`op_obligations`** — mode-aware: in compose, forbids `verbatim` and `cut` ops; in revise, both are legal. (compose only: also requires grounding to exist — see edition-grounding check)
10. **`edition_grounding`** — compose only: every derived edition unit has exactly one grounding record; no record names a nonexistent unit (revise: not-run, as reverse accounting is deferred to TASK-51)
11. **`no_copy`** — compose only: no destination edition unit is byte-identical to a complete source beat it represents (revise: not-run)
12. **`semantic_claim_fidelity`** — NOT proven in v1 (not-checkable)
13. **`voice_conformance`** — NOT proven in v1 (not-checkable)

### Verdict semantics

A top-level `verdict: "passed"` appears **only when every APPLICABLE deterministic obligation passed**. This does NOT mean the edition is semantically equivalent to its source — semantic equivalence is out of scope. It means:
- Every source unit is accounted for
- Every required literal payload survives
- Every structural obligation is satisfied
- No applicable check is `failed` or was aborted

An absent `verdict` signals either a decided failure (some check failed) or the validator cannot decide (an I/O error, unreadable input). A `not-run` check with `aborted: true` marker blocks the verdict; a `not-run` check that is merely inapplicable (e.g., "no lexicon declared") does not. Neither `reported` (uncorroborated units) nor `not-checkable` (semantic/voice checks) block a `passed` verdict.

### Uncorroborated units as a quality signal, never a threshold

When a source unit yields no extractable literal payload (no quotations, citations, numeric literals, or lexicon terms to verify), it is recorded as `uncorroborated` with a `reported` state and a count. The uncorroborated-unit count is a **report-only quality signal** — it never causes the validator to refuse an edition. A high count indicates weak corroborating evidence for the operator to review; it is never a threshold-based refusal.

### Corroboration, never inference

The validator **corroborates** the producer's declared coverage mapping from the ledger. It does not **infer** a mapping the producer did not declare. A `represented` or `merged` entry declares which destination unit(s) hold the source unit's payload; the validator confirms those destinations exist and the payload survives there. It never attempts to discover a "better" destination or to map an accounted unit to an undeclared location. The ledger is the authoritative editorial declaration under review.

## V1 honest boundary (out of scope)

This validator **does not** and **cannot** prove:
- **Semantic claim equivalence** for rewritten prose — whether a represented or merged destination unit conveys the same meaning as its source unit.
- **Voice conformance** — whether an edition adheres to the voice's declared traits.

Both `semantic_claim_fidelity` and `voice_conformance` are reported as `not-checkable` in v1 by design, not by omission. This is a first-class limitation, stated plainly here and in every coverage report. These checks are always present in the ten-check report (never silently omitted), making the boundary explicit to readers of coverage reports and alerting operators to the scope.

## Compose-mode trust boundary (FR-012)

When validating a composed edition, the fidelity report classifies guarantees into three tiers:

### MECHANICAL (deterministically checked)

These guarantees are verified byte-by-byte and structurally:
- **Op-legality**: no `verbatim` or `cut` operations; every beat is `represented` or `merged`.
- **No whole-unit copy**: no destination edition unit is byte-identical to a complete source beat it represents.
- **Grounding exhaustive and exclusive**: every derived edition unit has exactly one grounding record; no grounding record names a nonexistent edition unit.
- **Payload byte-exactness**: every citation marker, numeral, and declared `[OPEN-QUESTION]` marker in a beat survives byte-exact into the beat's represented destination(s).
- **Mode agreement** (for governed builds): the validator requires `requested_mode == ledger.mode` and refuses on mismatch before op-legality.

### PRODUCER-INSTRUCTION (asked of the model, not mechanically verifiable)

These guarantees are stated in the producer's prompt to the language model and are NOT checked by the deterministic validator:
- **Invent nothing**: added claims must be attributed, traceable assertions — never fabricated facts or sources.

### ADVISORY / NOT CHECKED (reported in the fidelity report, not deterministically proven)

These are known boundaries where the validator provides no guarantee:
- **`spine_source_fidelity: not-checked`** — whether the spine itself cites correctly is outside scope (asset-bank territory).
- **`composition_semantic_grounding: not-checkable`** — whether composed prose is semantically faithful to its beats cannot be proven deterministically. A composed edition where all payload survives byte-exact but prose invents causal claims will pass the mechanical gate.

The fidelity report makes this boundary explicit in every report, ensuring readers know exactly what is and is not guaranteed.

## Coverage-ledger schema (mode + grounding additions)

The compose mode extends the coverage ledger with two new fields:

### Ledger-level `mode` field

```yaml
version: 1
mode: compose           # NEW — enum: compose | revise
                        # Absent in pre-006 editions defaults to revise (backward-compatible)
source: { identity: <str>, hash: <sha256> }
voice:  { identity: <str>, hash: <sha256> }
coverage: [ ... ]       # unchanged shape; legality is now mode-aware
grounding: [ ... ]      # NEW — present for compose, absent for revise
```

The `mode` field stamps the operation the ledger was produced under, enabling the validator to enforce mode-specific rules (e.g., forbidding `verbatim` in compose, requiring grounding records in compose).

### Grounding records (compose only)

```yaml
grounding:
  - edition_unit: { hash: <sha256>, occurrence: <int> }
    basis: grounded         # enum: grounded | connective | framing
    beats:                  # present+non-empty iff basis==grounded; absent otherwise
      - { hash: <sha256>, occurrence: <int> }
```

Each grounding record declares the origin basis of one edition unit:
- **`grounded`**: the edition unit is grounded in one or more specific beats (listed in `beats`).
- **`connective`**: the edition unit is bridge prose connecting beats, with no single beat as primary origin.
- **`framing`**: the edition unit is frame prose (introduction, conclusion) not grounded in a specific beat.

Grounding records enable exhaustive and exclusive accounting of the composed output, preventing silent invention of undeclared edition units.

## Unit-derivation coverage for deferred markdown constructs

The D6 unit-derivation algorithm (see `src/units/derive.ts`) is construct-agnostic: it operates only on separator lines (blank/whitespace-only) and fenced code-block delimiters. Markdown constructs outside the current corpus (setext headings, MDX-style statements, HTML blocks, and list items separated by blank lines) are documented via golden fixtures in `test/golden-markdown.test.ts`. These fixtures pin the exact unit-split behavior for each construct under D6 rules:

- **Setext headings** (text followed by `===` or `---` underline): Treated as two consecutive content lines forming a single unit (no line-ending normalization, no special syntax recognition). When the underline is `---` and not at the document start, it is neither a frontmatter delimiter nor a separator; it is ordinary content.
- **MDX-style constructs** (import/export statements, JSX-like component tags): Treated as ordinary content lines; no special syntax recognition. These lines contain non-whitespace and are grouped with adjacent non-separator lines into a single unit.
- **HTML blocks** (e.g. `<div>...</div>`): Treated as ordinary content lines; no special markup recognition. A blank line *inside* an HTML block causes a split (D6 has no "HTML block" exception; only fenced code blocks preserve separators). If HTML tags are on consecutive lines with no separator, they form one unit.
- **Loose lists** (list items separated by blank lines): Each item becomes a separate unit because D6 recognizes blank lines as separators, not markdown semantic grouping. This differs from markdown parsers that group loose list items; D6's separation here is the documented D6-defined outcome.

All constructs are subject to the same foundational D6 rules: exact byte preservation (no line-ending normalization), full SHA-256 content hashing, and deterministic occurrence indexing.

## Independent use

This package is independently useful outside production-control. All three entry points (`voice compose`, `voice revise`, and `voice fidelity`) can be invoked as subprocesses by any orchestrator speaking their respective request/response contracts. Both producers (`compose` and `revise`) read one `BuildRequest` JSON on stdin and write one `BuildResponse` on stdout; the validator reads one `ValidateRequest` on stdin and writes one `ValidateResponse` on stdout plus a structured coverage report on stderr. The package imports no production-control source code; all data structures are plain JSON shapes matching the wire contracts in `specs/006-voice-compose-from-spine/contracts/` and `specs/004-voice-editions/contracts/`.

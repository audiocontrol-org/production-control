# Contract: voice-fidelity (a production-control validator)

The validator is an independent production-control **validator** — it speaks the
existing `ValidateRequest`/`ValidateResponse` contract (`src/providers/contract.ts`),
declared as a voice-edition target's `validator`, distinct from its `provider`
(`voice revise`). It is run by `pc validate <target>`, and it is **independently
usable outside that path**: any edition, however produced (an external skill,
another model, a human editor), becomes checkable the moment it exists (D3, FR-006).

## Invocation

`bin/voice-fidelity.mjs` — a subprocess reading one `ValidateRequest` on stdin,
writing one `ValidateResponse` on stdout, and a structured coverage report on
stderr. It reads only; it writes nothing. Runnable by hand:

```
echo '<ValidateRequest>' | voice-tooling/bin/voice-fidelity.mjs
```

## Input (`ValidateRequest`, on stdin)

```json
{
  "version": 1,
  "target": "prologue-archival-restraint",
  "artifact": { "path": "/abs/.ai/prologue-archival-restraint.md", "hash": "sha256:…" },
  "inputs": {
    "source": { "path": "/abs/content/ebook/prologue.md", "hash": "sha256:…" },
    "voice": { "path": "/abs/content/voices/archival-restraint.yaml", "hash": "sha256:…" },
    "lexicon": { "path": "/abs/content/voices/lexicon.yaml", "hash": "sha256:…" }
  }
}
```

- `artifact.path` is the already-built edition; production-control has already
  confirmed the file on disk matches its recorded hash before calling.
- `inputs.source` and `inputs.voice` are always present (D5: exactly one source
  draft; a voice is always declared). `inputs.lexicon` is present **only** when
  the target declares a lexicon input; its absence is what drives the `lexicon`
  check's `not-run` state (FR-020).
- The validator reads the edition's frontmatter itself to obtain the coverage
  ledger — the ledger is not passed separately, because it travels inside the
  artifact (D7, D10).

## Behavior — the ordered check sequence (deterministic — no LLM, no threshold, no network)

Every check runs in this order; an earlier check's failure aborts the sequence
(later checks are reported `not-run` with the reason "aborted: <earlier check>
failed") **except** where the design explicitly calls for continuing to collect
uncorroborated-count information — see step 5.

1. **`source_hash`** — the ledger's `source.hash` MUST equal the hash of the
   supplied `inputs.source`. Checked **first**, before any unit obligation is
   evaluated (FR-017, SC-003, D15). A mismatch is refused immediately: wrong
   source version invalidates every downstream claim the ledger makes.
2. **`ledger_structure`** — the frontmatter parses as a schema-valid coverage
   ledger (see `coverage-ledger-schema.md`): known `version`, every entry
   references a real op from the closed set, `cut` carries no destination and a
   non-empty `reason`, `merged` shares a destination with another entry, no
   entry carries both `edition_units` and `reason`. Refused **before** fidelity
   is evaluated (D20).
3. **`unit_accounting`** — re-derive source units from `inputs.source` via the
   D6 algorithm; confirm every derived source unit has **exactly one** ledger
   entry (SC-001). A missing or duplicated disposition names the offending unit
   by `(content_hash, occurrence_index)`.
4. **Per-op obligations** — for every entry, re-derive edition units from the
   artifact via D6 (frontmatter stripped first, D7) and check the entry's op
   against the table in `data-model.md` (`verbatim` exact-byte match;
   `represented`/`merged` payload survival across the destination union, plus
   `merged`'s shared-destination condition; `cut` needs no destination check).
5. **Payload checks** — `verbatim_quotes`, `citations`, `numeric_literals`,
   `lexicon` (D11–D13, R4 in research.md): unit-local, byte-exact,
   case-sensitive, multiset extraction and matching. `lexicon` is `not-run` when
   no lexicon input was declared. Every entry whose source unit yields no
   extractable payload is recorded under `uncorroborated_units` with a `reported`
   state and a count — **this never fails the run** (D12, FR-022; the spec's
   clarification session confirmed report-only, no threshold).
6. **Citation allow-list precondition** — before evaluating edition citations, the
   validator confirms every citation marker in the **source** resolves within the
   source's own frontmatter allow-list; a source failing this is refused before
   edition validation begins (D13.4, edge case).
7. **Honest boundary** — `semantic_claim_fidelity` and `voice_conformance` are
   always emitted with state `not-checkable` and a reason naming why (D4, D16).
   The validator never attempts either.

A check that **cannot be decided** (an unreadable artifact, a source that fails
UTF-8 decoding, an I/O error mid-run) causes the validator to exit non-zero and
emit **no `ValidateResponse` verdict at all** — distinct from `state: "failed"`,
which is a reached, decided verdict. See "No-verdict exit," below.

## Output

### `ValidateResponse` (stdout — the wire-contract-conformant verdict)

```json
{ "version": 1, "state": "passed" }
```

or, on any deterministic-obligation failure:

```json
{
  "version": 1,
  "state": "failed",
  "errors": [
    "unit accounting: source unit (hash sha256:9f2e…, occurrence 3) has no ledger entry",
    "op obligation: entry for source unit (sha256:9f2e…, occurrence 0), op=verbatim: destination bytes differ from source unit bytes",
    "citation preservation: marker [PB-P076] cited by source unit (sha256:a1c4…, occurrence 1) is absent from its declared destinations",
    "source hash: ledger source.hash sha256:1234… does not match supplied source hash sha256:5678…"
  ]
}
```

`errors` names the specific failing obligation and the unit/entry it belongs to —
never a vague "validation failed."

### Coverage report (stderr — the structured, first-class D15 output)

Always emitted when the validator reaches a decision (`passed` or `failed`);
best-effort partial emission (naming what ran before an abort) when it does not.
Machine-readable JSON, one object per run:

```json
{
  "verdict": "passed",
  "checks": {
    "source_hash":             { "state": "passed" },
    "ledger_structure":        { "state": "passed" },
    "unit_accounting":         { "state": "passed", "total": 57 },
    "verbatim_quotes":         { "state": "passed", "checked": 10 },
    "citations":               { "state": "passed", "mode": "multiset", "checked": 11 },
    "numeric_literals":        { "state": "passed", "checked": 8 },
    "lexicon":                 { "state": "not-run", "reason": "no lexicon declared" },
    "uncorroborated_units":    { "state": "reported", "count": 6 },
    "semantic_claim_fidelity": { "state": "not-checkable", "reason": "not provable under D4 — declared out of scope for v1" },
    "voice_conformance":       { "state": "not-checkable", "reason": "not provable under D16 — declared out of scope for v1" }
  }
}
```

- A top-level `verdict: passed` means every **applicable** deterministic
  obligation passed — never that the edition is semantically equivalent to its
  source (D15, FR-025). It NEVER appears when an applicable check's state is
  anything but `passed`/`not-run`/`reported` for the checks that legitimately
  carry those states.
- `uncorroborated_units` being non-trivial is not a failure signal by itself; it
  is a first-class quality signal a reviewer reads alongside the verdict (D12).

## No-verdict exit (FR-030, SC-006 — Fail Loud, Never False-Clean)

When the validator cannot decide an obligation — a source or edition that is
unreadable, not valid UTF-8, or an I/O failure mid-run — it exits **non-zero**
and writes **no `ValidateResponse` on stdout at all** (not even `state: "failed"`).
This is deliberately a third outcome, distinct from `passed` and `failed`:
production-control records this as **unresolved**, never a false clean and never
a claim the validator did not actually reach. A diagnostic naming what could not
be decided is written to stderr alongside whatever partial coverage-report state
had been assembled before the abort.

## Scope boundary, stated plainly (D4, D16)

This validator proves: accounting completeness (every source unit carries exactly
one disposition) and literal-payload preservation (configured literal payload
survives where an operation requires it). It does **not** prove: semantic claim
equivalence for rewritten prose, or that an edition conforms to its declared
voice. `semantic_claim_fidelity` and `voice_conformance` are always
`not-checkable` in v1 — stated in this contract, not left to be discovered by a
reader of the coverage report alone.

## Corroboration, never inference (D22)

Given a `represented` entry naming a destination, the validator checks that the
destination exists and that the source unit's payload survives within it. It
never asks whether a different edition unit would have been a better destination,
and it never attempts to discover a mapping the producer did not declare. The
ledger is the authoritative editorial declaration under review; a false entry is
a false statement made explicitly and diffably, not a silent gap the validator
tries to fill in.

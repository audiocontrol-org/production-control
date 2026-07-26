# Quickstart: Voice editions

Runnable VALIDATION scenarios that prove the capability end-to-end. Full field
definitions live in `data-model.md`; wire shapes live in `contracts/`. This file
does not duplicate either — it describes what to run and what to expect.

## Prerequisites

- Node (macOS/Linux); the new `voice-tooling` package installed
  (`node --import tsx --test` runnable — see `research.md` R1).
- For the live producer scenario only (S4): the `claude` CLI (or the configured
  `QUOTE_MINER_MODEL_CMD`-style override) on PATH. The validator (S1–S3, S5) needs
  neither a model nor a network — that is the whole point of D3/D22.
- content-zone-segregation is SHIPPED (merged 2026-07-26, PR #7); `.ai/` routing
  and `pc audit-zones` are already available with no adoption step (D19).

## Scenario S1 — The validator accepts a faithful fixture edition (US1, P1; SC-001, SC-002, SC-004)

1. A fixture source draft, a fixture voice document, and a hand-written edition
   whose frontmatter ledger accounts for every source unit, each with a
   satisfied deterministic obligation for its op (`contracts/coverage-ledger-
   schema.md`).
2. Pipe a `ValidateRequest` (`contracts/voice-fidelity-validator.md`) to
   `bin/voice-fidelity.mjs`.
3. **Expect**: `{ "state": "passed" }` on stdout, exit 0; the stderr coverage
   report lists every applicable check's state as `passed`/`not-run`/`reported`
   (e.g. `lexicon: not-run` if no lexicon fixture is declared), and
   `semantic_claim_fidelity`/`voice_conformance` as `not-checkable` — never
   silently absent from the report (SC-004).

## Scenario S2 — The validator refuses a tampered edition, naming the obligation (US1; SC-002, SC-003)

Run each of the following fixture variants (one defect per fixture, per the
design record's adversarial Testing strategy) through `bin/voice-fidelity.mjs`
and confirm a `state: "failed"` response whose `errors` names the specific
obligation, not a generic failure:

| Fixture defect | Expected named obligation in `errors` |
|---|---|
| A `verbatim` entry whose destination bytes differ from the source unit's bytes | `op obligation … op=verbatim: destination bytes differ from source unit bytes` |
| A citation marker dropped from a non-`cut` entry's destinations | `citation preservation: marker […] … is absent from its declared destinations` |
| A source unit with no ledger entry at all | `unit accounting: source unit (hash …, occurrence …) has no ledger entry` |
| A ledger whose `source.hash` does not match the supplied source draft's hash | `source hash: ledger source.hash … does not match supplied source hash …` — refused **before** any unit obligation is evaluated (Acceptance Scenario 5 of the spec) |
| A `cut` entry carrying a destination | structural refusal, before fidelity is evaluated (D20) |
| A `merged` entry with no shared destination | structural refusal, naming the entry (D8's mechanical distinction from `represented`) |
| A `cut` entry with an empty `reason` | structural refusal |

**Expect**: exit 0 (the validator reached a decided verdict — `failed` is a
decision, not an abort), `state: "failed"`, and — run under `pc validate
<target>` — a non-zero gate exit.

## Scenario S3 — A thinly-corroborated edition passes, and the report shows it (US1; D12)

1. A fixture edition where most `represented`/`merged` entries' source units
   yield no extractable payload (ordinary connective prose — no numerals,
   citations, quotes, or lexicon terms).
2. Pipe the `ValidateRequest` to `bin/voice-fidelity.mjs`.
3. **Expect**: `state: "passed"` — an empty-payload entry passes, it is never
   refused for vacuity (D12) — **and** the coverage report's
   `uncorroborated_units` check reports `state: "reported"` with a high `count`.
   Confirm the count is **not** a threshold: no fixture variant of this scenario,
   however high the count, causes a `failed` verdict (spec Clarifications: "no
   project-set threshold in v1").

## Scenario S4 — `voice revise` produces an edition that routes under `.ai/` and is gated by the validator (US2, P2)

In a proving-ground episode with a `source` input, a `voice` input, and a target
wired to `voice-revise` (provider) and `voice-fidelity` (validator):

1. `pc build <target>` (against a stubbed or live model per prerequisites).
2. **Expect**: the `BuildResponse` declares `impure: { reason: … }` and reports
   **no** `validation` field of its own (`contracts/voice-revise-provider.md`);
   the produced edition's path resolves under the episode's `.ai/` root (a
   sibling of `dist/`), confirmed both by inspecting the staged path and by
   `pc audit-zones` reporting no routing violation for this target.
3. `pc validate <target>` → the independent `voice-fidelity` validator decides.
4. **Expect**: on a faithful production, `passed` is recorded and `pc status`
   shows the edition `fresh` and `validated: passed`. Separately, confirm the
   refusal path: feed the validator a deliberately tampered edition (any S2
   fixture) in place of a real build's output and confirm the build-and-validate
   pipeline refuses to accept it — **no partial or unvalidated edition is left
   as if accepted** (Acceptance Scenario US2-2).
5. Attempt a target whose declared output resolves to a human-safe (dot-free)
   path. **Expect**: refused by the shipped segregation gate at build time, and
   `pc audit-zones` reports the violation pre-build (Acceptance Scenario US2-3) —
   with no new adoption verb involved (D19 relies entirely on the shipped
   content-zone-segregation enforcement).

## Scenario S5 — Freshness: a voice edit restales; a model-version change drifts (US3, P3; D18)

1. Build an edition from voice version A (S4).
2. Edit the voice document (produce version B).
3. **Expect**: `pc status` reports the edition `stale` — restaling only *reports*;
   no automatic rebuild occurs (Acceptance Scenario 1).
4. Revert the voice edit; instead, change only the recorded producer model
   version (e.g. re-run with a different model identity behind the same command).
5. **Expect**: `pc status` reports **producer drift**, a state distinct from
   `stale`, and the edition is **not** restaled or automatically rebuilt
   (Acceptance Scenario 2). Confirm neither S5.3 nor S5.5 triggers a rebuild —
   both stay report-only; regeneration is a deliberate `pc build` call.

## Companion lifecycle check (US2 Acceptance Scenario 4; D19)

1. Author a separate document in a human-safe area with a `follows` edge
   (`AuthoredDeclSchema.follows`) pointing at the edition's identity.
2. **Expect**: the companion is accepted as ordinary authored content; the
   edition is never marked `modified` by the companion's presence or edits, and
   the edition itself remains byte-for-byte what `voice revise` produced.

## Reproduce the checks

```
# in voice-tooling/
node --import tsx --test         # validator-first unit tests, then producer tests
# in the proving ground:
npx pc build <target>      --episode <dir>
npx pc validate <target>   --episode <dir>
npx pc status              --episode <dir>
npx pc audit-zones         --episode <dir>
```

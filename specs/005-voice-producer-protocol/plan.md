# Implementation Plan: Voice producer protocol + corpus citation support

**Branch**: `feature/voice` (single long-lived branch; spec dir via SPECKIT marker) | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature spec `specs/005-voice-producer-protocol/spec.md`

**Design record** (authoritative for HOW): `docs/superpowers/specs/2026-07-27-voice-producer-protocol-design.md`

## Summary

Formalize the real `voice revise` producer (spec 004 shipped it stubbed) and extend citation handling for real source-cited corpora. A language model cannot compute the sha256 hashes the coverage ledger keys on, so the producer uses a **model↔provider protocol**: the model returns a revised edition body plus an index-based coverage mapping; the provider derives units by the D6 algorithm and mechanically builds the hash-keyed ledger. The model command is operator-supplied via `VOICE_REVISE_MODEL` (fail-loud when unset). Separately, the citation extractor recognizes `[PB-###]` markers in addition to `[^1]` footnotes and derives the allow-list from `sources:` frontmatter. Everything lives in the `voice-tooling` craft package; **no production-control core change**. The implementation already exists and is validated on `spike/nouvelle-france-voice-lab`; execution ADOPTS and hardens it against the spec.

## Technical Context

**Language/Version**: TypeScript, `voice-tooling` package toolchain — `node --import tsx --test`, `tsc --noEmit`, strict, no `any`/`as`/`@ts-ignore`, `@/` alias.
**Primary Dependencies**: `yaml` (prompt/ledger/voice parsing), Node `crypto` (sha256), Node `child_process` (spawn the model command). Reuses spec-004 modules unchanged: `@/units/derive.ts` (`deriveUnits`), `@/schema/ledger.ts` (`CoverageLedger`/`loadLedger`), `@/schema/voice.ts` (`loadVoice`), `@/fidelity/check-ledger-structure.ts` (`extractLedgerYaml`), the provider/validator wire contracts.
**Model command**: an external CLI supplied via `VOICE_REVISE_MODEL` (e.g. `claude -p`), spawned with the prompt on stdin; capability-agnostic (never branches on which model).
**Storage**: files. The edition is a single markdown file carrying the coverage ledger under a top-level `ledger:` frontmatter key.
**Testing**: `voice-tooling` `node --import tsx --test` (protocol parsing, ledger-build round-trip, prompt shape, citation extraction, allow-list derivation) + production-control `vitest` integration (build routes to `.ai/`, validator gates; the existing `voice-revise.test.ts` stays green via the deterministic stub model).
**Target Platform**: Node CLI craft tool, orchestrated by `pc`.
**Constraints**: no production-control core change (Constitution IV); files ≤500 lines; no fallbacks outside tests (fail loud — Constitution V); the model is the only impure component and declares itself impure.
**Scale/Scope**: one source draft + one voice per target (inherited from spec 004 D5).

**Resolved decisions (no NEEDS CLARIFICATION)**: the index-mapping protocol, `VOICE_REVISE_MODEL` fail-loud, and the `[PB-###]` + `sources:`-allowlist citation extension are all settled in the design record and demonstrated by the lab.

## Constitution Check

*GATE: must pass before Phase 0; re-check after Phase 1.*

- **I. Human-Authored Narrative — PASS (by construction outside core).** The generative act is the model call inside the `voice-tooling` craft package, never production-control. production-control only orchestrates (resolve inputs → spawn subprocess → record → gate via the independent validator). The provider builds a ledger from a declared mapping; it does not itself write or judge prose.
- **II. Deterministic Production — PASS, with the declared impure exception.** The model call is non-deterministic and declares `impure: {reason}`. Everything downstream (unit derivation, hashing, ledger construction) is deterministic; the validator is deterministic. Freshness stays hash-based.
- **III. Explicit Provenance — PASS.** Build-and-record stays one act; the coverage ledger is the per-unit provenance carried in the artifact. (Model identity in `tool.version` is a named deferred boundary, TASK-31/40.)
- **IV. Crafts Remain Specialized — PASS.** Producer + citation logic live in `voice-tooling`; the package is independently runnable and imports no production-control source; the provider receives local paths and holds no credentials.
- **V. Fail Loud, Never False-Clean — PASS.** Unset `VOICE_REVISE_MODEL`, malformed model output, and an incomplete/out-of-range mapping are all named refusals with no partial edition. No fallback model, no fabricated output.
- **VI. Oracle Authoritative; Providers Disposable — PASS.** The manifest/contracts/ledger schema are untouched; `voice revise` is a swappable provider; the oracle interprets none of the model protocol.
- **VII. Subject-Agnostic — PASS.** No subject specifics in the package; the `[PB-###]` support is a general uppercase-prefix marker rule + a generic `sources:` frontmatter convention, not a corpus name.

**Overall: PASS on all seven. No Complexity Tracking entry required.**

## Project Structure

### Documentation (this feature)
```text
specs/005-voice-producer-protocol/
├── plan.md · spec.md · research.md · data-model.md · quickstart.md
├── contracts/voice-revise-protocol.md
└── checklists/requirements.md
```

### Source (as-built on the spike; execution adopts + hardens)
```text
voice-tooling/
├── src/revise/
│   ├── protocol.ts        # ModelReviseOutput/ModelCoverageEntry + parseModelOutput (robust extract + fail-loud validation)
│   ├── model.ts           # buildRevisePrompt (numbered units + directives + fidelity contract + output format); resolveModelCommand (VOICE_REVISE_MODEL, fail-loud); invokeModel (spawn, stdin prompt)
│   ├── ledger-build.ts    # buildEdition: derive units, validate mapping, resolve indices → hash-keyed CoverageLedger, serialize frontmatter+body
│   ├── request.ts · emit.ts · cli.ts
├── src/payload/extract.ts        # citation regex extended to [PB-###]; numeral masking synced
├── src/fidelity/check-ledger-structure.ts  # allow-list derived from sources: frontmatter (∪ citation_allowlist)
├── bin/voice-revise.mjs
└── test/  (revise-protocol, revise, payload-extract, check-payload, pre-checks + integration voice-revise.test.ts)
```

**Structure Decision**: extend the existing `voice-tooling` package in place; no new package, no production-control core file changed. Tests live beside the modules (package `node --test`) plus the existing production-control integration test.

## Complexity Tracking

*No entries.* Constitution Check passed all seven principles.

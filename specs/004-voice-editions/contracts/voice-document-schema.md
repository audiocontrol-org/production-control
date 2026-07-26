# Contract: voice-document-schema (the YAML voice document, D17)

A voice document is an ordinary `authored` node (`AuthoredDeclSchema`,
`src/manifest/schema.ts`) referenced by identity in a target's `inputs` — no new
manifest mechanism, no core change (D1). This file specifies the YAML shape a
voice document MUST take; the full field table lives in `../data-model.md` §
"Voice document."

## Shape

```yaml
version: 1
id: archival-restraint
label: "Archival restraint"
purpose: >
  For exposition and background — a distanced, source-anchored narration that
  states what the record shows without dramatizing it.
narrator_distance: >
  Third-person, observational; the narrator does not enter characters' interiority.
evidence_posture: >
  Every claim traces to a source; uncertainty is stated, never smoothed over.
sentence_movement: >
  Short declaratives; subordinate clauses carry qualification, not drama.
paragraph_movement: >
  One claim develops per paragraph; transitions are chronological or causal, not rhetorical.
transitions: >
  Plain connectives (then, afterward, meanwhile) — no scene-setting flourish.
emotional_temperature: >
  Restrained. Documented consequence is stated once, without repetition for effect.
quote_handling: >
  Blockquotes are preserved verbatim and introduced plainly ("The record states:").
avoid:
  - present-tense narration
  - rhetorical questions
  - unattributed emotional language ("tragically", "heartbreakingly")

# Additional keys are permitted and passed through to the producer untouched —
# production-control never interprets them (FR-003).
pacing_notes: >
  Slower than the investigative-momentum voice; this is not a defect.
```

## Field reference

See `../data-model.md` § "Voice document" for the authoritative table. In brief:

- `version` — literal `1`; unknown versions refused before any other field is
  read (matches every other versioned schema in this system:
  `EpisodeManifestSchema.version`, `ProfileSchema.version`,
  `BuildRequestSchema.version`, `LedgerSchema.version` — all `z.literal(1)`).
- Required core (all strings unless noted): `id`, `label`, `purpose`,
  `narrator_distance`, `evidence_posture`, `sentence_movement`,
  `paragraph_movement`, `transitions`, `emotional_temperature`,
  `quote_handling`, and `avoid` (a list of strings — hard, named avoids, not
  free text).
- **Additional keys are permitted.** production-control MUST NOT interpret any
  field on a voice document, required or additional — the whole document is a
  directive passed through to the `voice revise` provider's model request
  unexamined by the orchestrator. This is what keeps a voice document subject to
  Constitution VII (subject-agnostic core): the *fields* a voice document may
  carry are fixed by this schema, but their *content* is never read by
  production-control, so no subject knowledge can leak into the graph, contracts,
  or code by way of a voice's prose.

## The no-author-imitation refusal (FR-004, D17) — a documented refusal, not a mechanical check

**A voice MUST be expressed as independently-useful traits and MUST NOT be a
named living author's identity.**

This is stated here, in the schema's own documentation, and MUST be stated
again in any tooling that authors or reviews a voice document, because it is
enforced as **prose a human reads**, not as a runtime check the loader performs.
There is no `isNamedLivingAuthor(id: string): boolean` in this package, and none
should be added:

- A denylist of author names would be incomplete on day one and stale forever
  after — the exact false-precision this feature's design record avoids
  everywhere else it could have reached for a threshold or a heuristic (D6's
  rejection of sentence-level splitting, D11's rejection of a capitalized-token
  heuristic, D12's rejection of a corroboration threshold — see research.md).
- The refusal is a **content-authoring discipline**, evaluated by whoever writes
  or approves a voice document: does this document describe *traits* (distance,
  posture, movement, temperature, avoids) that would be recognizable and useful
  independent of any single author's name, or does it describe *"write like
  <named person>"*? The former is a voice; the latter is refused, by the human
  authoring or reviewing it, before it is ever committed.
- **Why this matters mechanically anyway**: a voice document that smuggled in
  "write like <named author>" as its `purpose` or an additional key would still
  pass every schema check in this file — the schema cannot see intent. The
  refusal exists precisely because the schema's permissiveness (additional keys,
  free-text required fields) cannot be closed off without losing the
  expressiveness a real voice document needs. Stating the refusal here, loudly,
  is the mitigation this design record chose over a false mechanical guard
  (D17).

## Loader

```ts
function loadVoice(yamlText: string): VoiceDocument
```

One loader, mirroring the ledger's `loadLedger` and the base contract's
`parseBuildRequest`/`parseBuildResponse` pattern — every schema refusal in this
package names the offending field, the same convention `formatSchemaIssues`
establishes for the base provider/validator contract.

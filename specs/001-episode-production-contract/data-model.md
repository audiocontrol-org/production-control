# Phase 1 Data Model: Episode Production Contract v0.1

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Contracts**: [contracts/](./contracts/)

Every shape here is parsed at the boundary through a `zod` schema (research R2). Nothing
downstream sees an unvalidated value.

## Core distinction

Every node is exactly one of two kinds. This is the model's load-bearing decision — it is
what lets narration sit on either side without the system knowing where a voice comes from.

| | Authored node | Derived node |
|---|---|---|
| Producer | none | exactly one |
| Upstream inputs | none (may declare `follows`) | one or more identities |
| Rebuildable | no — a human made it | yes |
| Drift signal | `needs-review` (advisory) | `stale` (actionable) |

## Entities

### Identity

The stable name of a role. A string key (`longform`, `spoken`, `narration`, `voiceover`,
`podcast`, `transcript`).

- Survives rebuilds; survives the file moving.
- The thing edges are drawn between. Paths are an *attribute* of a node, never its identity.
- Unique within an episode. A duplicate is a refusal (FR-005).

### EpisodeManifest — `episode.yaml`

| Field | Type | Notes |
|---|---|---|
| `version` | literal `1` | Unknown version is a refusal, not a best-effort parse |
| `id` | string | Episode identifier |
| `title` | string | Human-facing |
| `profile` | string | Names a Profile; unresolvable is a refusal |
| `authored` | map<Identity, AuthoredDecl> | Declared, never inferred (FR-001) |
| `targets` | Identity[] | Must all be produced by the named profile (FR-005) |

### AuthoredDecl

| Field | Type | Notes |
|---|---|---|
| `path` | string | Repo-relative. An attribute, not the identity |
| `follows` | Identity? | Advisory edge. Never rebuilds, never blocks alone (FR-019) |

### Profile — `profiles/<name>.yaml`

Generic and reusable; contains nothing subject-specific (FR-004, Principle VII).

| Field | Type | Notes |
|---|---|---|
| `version` | literal `1` | |
| `targets` | map<Identity, TargetDecl> | |

### TargetDecl

| Field | Type | Notes |
|---|---|---|
| `inputs` | Identity[] | Resolved against authored ∪ other targets |
| `provider` | ProviderDecl | |

### ProviderDecl

| Field | Type | Notes |
|---|---|---|
| `cmd` | string[] | argv. The system does not interpret it beyond executing it |
| `impure` | boolean? | Default `false`. Declares the tool cannot promise identical output from identical input (FR-032) |

### Ledger — `.production/ledger.yaml`

The canonical record of production state. **Committed**; `dist/` is not. Holds current
state only — git holds the history (design record).

| Field | Type | Notes |
|---|---|---|
| `version` | literal `1` | |
| `artifacts` | map<Identity, ArtifactRecord> | Derived nodes only |
| `reviews` | map<Identity, Waiver> | Authored nodes with resolved advisory drift |

### ArtifactRecord

| Field | Type | Notes |
|---|---|---|
| `producer` | `{ tool: string, version: string }` | Version drift is reported, never auto-staling (FR-016) |
| `producer_impure` | boolean? | Recorded as declared at build time |
| `inputs` | map<Identity, Hash> | Hashes **as of the build** — the comparison basis |
| `output` | `{ path: string, hash: Hash }` | |
| `built_at` | ISO-8601 UTC | Recorded, never decided on (research R7) |
| `validation` | `{ state: 'passed' \| 'failed', at: ISO-8601 }?` | Absent = not yet validated |

### Waiver

| Field | Type | Notes |
|---|---|---|
| `waived_hash` | Hash | The tracked node's hash *at the moment of waiving* |
| `reason` | string | Required — a waiver without a reason is not a decision |
| `at` | ISO-8601 UTC | |

**The `waived_hash` field is what makes FR-022 work.** A waiver applies only to the change
it was recorded against: needs-review is raised when the tracked node's current hash differs
from `waived_hash`. Storing a boolean instead would silently swallow every subsequent
revision — the exact false-clean the advisory edge exists to prevent.

### AssetPointer — `<name>.<ext>.asset`

Committed stand-in for bytes held outside version control.

| Field | Type | Notes |
|---|---|---|
| `asset` | Hash | Content address. The key **is** the hash — reference and integrity claim are one string |
| `media` | string | Media type |
| `bytes` | integer | Size, for human reading |

### Hash

`sha256:<64 lowercase hex>`. A single opaque string throughout, so the reference and the
integrity claim never diverge.

## Node state

Exactly one per node (FR-006), and every state carries its cause (FR-007).

Exactly one per node (FR-006). The available states depend on the node's kind — the two
kinds answer different questions.

**Derived** (FR-006):

| State | Meaning |
|---|---|
| `fresh` | Recorded inputs match reality |
| `stale` | A declared input's content differs from what was recorded |
| `missing` | Never built |
| `blocked` | An input is absent, so the question cannot be asked |
| `invalid` | Validation failed |

**Authored** (FR-006):

| State | Meaning |
|---|---|
| `present` | The declared path resolves |
| `absent` | The declared path does not resolve |
| `needs-review` | A followed node changed since this was made (FR-020) |

An authored node has no `stale` state: it has no producer, so staleness is not a question
that can be asked of it. This is the authored/derived distinction expressed in the state
model.

**Precedence — report the state that asserts least (FR-006a).** `blocked` outranks `stale`:
if an input is absent the system cannot know whether the output is stale, and claiming
staleness would assert something unverified. `absent` outranks `needs-review` for the same
reason (FR-022c) — drift cannot be claimed against a file that cannot be read.

**Validation is not a state (FR-006b).** It is a recorded fact, orthogonal to freshness. A
node may be `fresh` and not yet validated, and still block release under FR-012. The three
cases are distinct and must not be collapsed:

| Ledger `validation` | Meaning | Node state | Blocks release |
|---|---|---|---|
| absent | Not yet validated | `fresh` (etc.) | yes |
| `passed` | Validated, passed | `fresh` (etc.) | no |
| `failed` | Validated, failed | `invalid` | yes |

`pc next` renders the *action* ("validate"), which is why "unvalidated" appears in its
output without being a state.

## Freshness

A declarative consistency check, not a computation (design record):

```
for each declared input of a derived node:
    current  = hash(resolve(input))
    recorded = ledger.artifacts[node].inputs[input]
    if current != recorded  -> stale, cause: input changed
```

**Transitive staleness is emergent, not implemented.** Rebuilding a node changes its output
hash; that hash is a recorded input of its downstream nodes; the comparison above then
fails for them naturally. There is no propagation pass to write, and writing one would be a
bug (FR-009 is satisfied by content addressing alone).

## Relationships

```
EpisodeManifest ──names──> Profile
       │                      │
       │ authored             │ targets
       ▼                      ▼
  AuthoredDecl           TargetDecl ──> ProviderDecl
       │  │                   │
       │  │ follows           │ inputs
       │  └───(advisory)──────┼───> Identity
       │                      │
       └──path──> file  ◄─────┘
                    │
              (or) *.asset ──> Asset (content-addressed, external)

Ledger.artifacts[Identity] ──records──> what a derived node was built from
Ledger.reviews[Identity]   ──records──> a human's waiver of advisory drift
```

## Validation rules (all refusals, per FR-005)

- Unknown `version` on any document.
- Duplicate identity across `authored`.
- A `target` the profile does not produce.
- An `inputs` entry naming an identity that is neither authored nor a profile target.
- A `follows` naming a non-existent identity.
- A dependency cycle among targets.
- A `follows` declared on a *derived* node (FR-005) — `follows` is advisory precisely
  because the node cannot be rebuilt; on a derived node it is meaningless.
- An empty or whitespace-only waiver reason (FR-022b).
- An authored node whose path resolves to an untracked file over the size threshold with
  no `.asset` pointer beside it (FR-026) — the git-footgun guard, which lives here because
  there are no git hooks. The threshold is configurable with a stated default, so an
  author can predict the refusal rather than discover it.

**What is NOT validated at status time**: whether a pointer's asset actually exists in the
store. That is unknowable without contacting it, and FR-025 requires status to work
offline. It surfaces at the first operation that needs the bytes (FR-036).

## Fixture episodes

Test fixtures only — never real content (Principle VII). Each is a full episode directory
with tiny synthetic files whose hashes are stable and known.

| Fixture | Exercises |
|---|---|
| `minimal` | One authored input, one target |
| `blocked` | A declared input that does not exist |
| `advisory` | `narration` follows `spoken`; the drift + waiver flow |
| `chain` | `narration → voiceover → podcast` — transitive staleness |
| `dual-signal` | `transcript ← [narration, spoken]` where `narration follows spoken` — the case where advisory and real edges touch the same node and both must fire |
| `tree-output` | A directory-valued output |
| `cycle` | A cyclic profile; must be refused |
| `asset` | An authored input behind an `.asset` pointer |

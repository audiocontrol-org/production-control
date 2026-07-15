# Contract: Command-Line Surface

**Status**: v0.1 | **Primary caller**: an agent, not a human

`--json` is the primary interface, not a courtesy. Human-readable output is the
convenience layer over it.

## Exit-code semantics

The split is the contract, and it is what lets an agent branch without parsing prose:

| Class | Verbs | Exit |
|---|---|---|
| **Read** | `status`, `next` | Always **0**, even when reporting problems |
| **Gate** | `validate`, `release-check` | **0** if clean, **1** if not |
| **Act** | `build`, `asset add`, `review` | **0** on success, **1** on failure |
| **Any** | — | **2** on usage error |

A read verb reporting "everything is broken" has *succeeded* — it answered the question.
Conflating "the answer is bad" with "the command failed" would make `pc status` unusable
in any pipeline.

## `pc status [--json]`

Reports every node, its state, and **why**.

```
$ pc status
narration   needs-review  spoken changed since take-03 was recorded
podcast     stale         voiceover rebuilt
transcript  stale         spoken changed
epub        fresh
website     missing       never built
```

```json
{
  "episode": "port-breton-01",
  "nodes": [
    { "id": "narration", "kind": "authored", "state": "needs-review",
      "cause": { "type": "followed-changed", "followed": "spoken",
                 "waived_hash": "sha256:aa1...", "current_hash": "sha256:bb2..." } }
  ]
}
```

- **Every node carries a `cause`** (FR-007). A state without a cause makes an agent guess.
- **Zero network I/O** (FR-025, SC-001). Content addressing makes this possible: the
  pointer file already contains the hash, so nothing needs fetching to answer staleness.
- **No craft tool need be installed** (FR-010).
- **Never mutates** the episode.

## `pc next [--json]`

The actionable frontier — what a human or agent could act on *now*. Distinct from `status`
(FR-011) because "everything that is true" and "what to do next" are different questions,
and making the agent derive the second from the first is making it guess.

```
$ pc next
1. narration  needs-review  spoken changed since take-03 was recorded
2. podcast    rebuild       voiceover is newer than the recorded input
3. epub       validate      built but never validated
```

Excludes anything `blocked` — a blocked node is not actionable, its missing input is.

## `pc build <target> [--json]`

Builds **and records provenance as one indivisible act** (FR-014).

- Resolves inputs to local paths (fetching from the store as needed), invokes the provider,
  hashes the outputs, writes the ledger.
- **There is no `--no-record` flag and no separate `record` verb.** The guarantee is the
  absence of an alternative path.
- Fails and names what is absent when the provider is missing, an input is unresolvable, or
  the provider misbehaves (FR-036). Never skips, never substitutes a default.
- A failed build writes no record claiming success (FR-017).

## `pc validate [<target>] [--json]`

Runs validation and records the verdict. Exit 1 if any target is invalid.

## `pc release-check [--json]`

Answers the release question (FR-012). Exit 0 only when **every target is fresh, every
validation passed, and no unwaived review remains**.

```
$ pc release-check
not releasable:
  narration  needs-review  spoken changed since take-03 was recorded
  podcast    stale         voiceover rebuilt
```

Every negative answer names what blocks it (SC-005). Without the review condition,
"releasable" would quietly mean "the machine-checkable parts are fine".

## `pc asset add <file> [--json]`

Hashes, uploads-if-absent, writes the `.asset` pointer beside the file.

- Identical bytes are a no-op (FR-024); the content address already exists.
- Re-recorded bytes become a **new** address; the prior asset stays retrievable (FR-028).

## `pc review <node> --waive --reason "<text>"`

Records a human decision that a specific advisory drift is acceptable.

- `--reason` is **required**. A waiver without a reason is not a decision.
- Pins the tracked node's current hash. A later change raises `needs-review` again
  (FR-022) — the waiver applies to the change it was recorded against, not to the node
  forever.

## Failure discipline

Per Principle V, binding on every verb:

- Fail loud and **name what is absent** — never a fallback, never a substituted default,
  never a silently skipped target.
- A skipped target reporting green is worse than a failure: a failure gets fixed, a false
  green gets shipped.

# Quickstart: Validating Episode Production Contract v0.1

**Plan**: [plan.md](./plan.md) | **Contracts**: [cli.md](./contracts/cli.md), [provider.md](./contracts/provider.md)

Runnable scenarios that prove the feature works. Each maps to a spec success criterion and
is expected to be automated in `tests/integration/`.

## Prerequisites

```bash
npm install
npm run build
```

No craft tools. No bucket. No Docker — except for S9, which is the only scenario that needs
it. That is the point: if these scenarios required real tooling, SC-007 would be false.

## S1 — The oracle answers against a half-authored production (SC-001, US1)

```bash
pc status --json --episode tests/fixtures/blocked
```

**Expect**: exit 0. Targets depending on the absent input report `blocked`, naming it — not
`stale`, because with the input absent the system cannot know whether the output is stale,
and claiming otherwise would assert something unverified.

**Prove it needs nothing**: run with networking disabled and no craft tools on PATH. Same
answer.

## S2 — Every state carries a cause (FR-007)

```bash
pc status --json --episode tests/fixtures/chain | jq '.nodes[] | select(.cause == null)'
```

**Expect**: empty. A node without a cause is a contract violation.

## S3 — Staleness is content-based, not time-based (SC-004, FR-008)

```bash
touch tests/fixtures/minimal/article.mdx      # mtime moves; content does not
pc status --episode tests/fixtures/minimal    # -> still fresh
```

Then change the bytes:

```bash
echo " " >> tests/fixtures/minimal/article.mdx
pc status --episode tests/fixtures/minimal    # -> stale, naming longform
```

**Expect**: `touch` alone never causes staleness. This is the test that catches a
reintroduced mtime check.

## S4 — A fresh clone answers from records, not from the clock (SC-004)

Two scenarios, because a clone has two things going on and only one of them is "identical".

**S4a — mtimes are not a signal.** With the built bytes present, a clone answers identically
no matter what the filesystem says about when anything happened:

```bash
git clone . /tmp/pc-clone
cp -R tests/fixtures/chain/dist /tmp/pc-clone/tests/fixtures/chain/dist   # artifacts present
find /tmp/pc-clone/tests/fixtures/chain -exec touch {} +                  # every mtime rewritten
pc status --episode /tmp/pc-clone/tests/fixtures/chain
```

**Expect**: state-for-state identical to the original working copy, with no rebuild. Every
mtime in the clone is new and not one answer moves — the content and the records are the
only things read.

**S4b — the chain stays answerable with the artifacts gone.** `dist/` is not committed, so
this is what a real clone looks like:

```bash
git clone . /tmp/pc-clone            # ledger present; dist/ absent, as gitignored
pc status --episode /tmp/pc-clone/tests/fixtures/chain
```

**Expect**: every derived node reports that it needs building, **on its own account** —
`voiceover` because `voiceover`'s bytes are not here, `podcast` because `podcast`'s are not.
And critically: **no node reports `blocked`** naming another node's missing artifact.
`podcast` is not blocked on `voiceover`; nothing about `voiceover` is podcast's problem.

Do **not** expect the states to match S4a — they must not. A clone has no built artifacts, so
reporting them fresh would be a lie about bytes nobody has. What is identical is the
*provenance*: each node still knows exactly what it was built from, because the ledger is
committed and `dist/` is not (FR-015). Provenance is the product; the artifacts are
reproducible from it.

A node here reports `blocked` only when an input genuinely has no answer — an authored file
that is missing, or an upstream target that has never been built at all and so has no record
to inherit. An artifact that was built, recorded, and simply is not present in this working
tree is not that: its record answers for it.

## S5 — Transitive staleness is emergent (SC-003)

```bash
pc build voiceover --episode tests/fixtures/chain   # changes voiceover's hash
pc status --episode tests/fixtures/chain
```

**Expect**: `podcast` reports `stale`, naming `voiceover`. Nothing in the code propagates
this — the podcast's recorded input hash simply no longer matches. If a propagation pass
was written, it is a bug.

## S6 — Advisory drift raises review, never a rebuild (SC-006, US3)

```bash
echo " " >> tests/fixtures/advisory/script.md     # revise the script
pc status --episode tests/fixtures/advisory
```

**Expect**: `narration` reports `needs-review`, naming `spoken`. It does **not** report
`stale`, and `pc build` never attempts to rebuild it — a human made it.

```bash
pc release-check --episode tests/fixtures/advisory   # exit 1, names narration
pc review narration --waive --reason "delivery unchanged; wording fix only"
pc release-check --episode tests/fixtures/advisory   # now passes
echo " " >> tests/fixtures/advisory/script.md        # revise again
pc status --episode tests/fixtures/advisory          # needs-review AGAIN
```

**Expect**: the waiver applies only to the change it was recorded against. This is what
`waived_hash` buys; a boolean would swallow every later revision.

## S7 — Advisory and real edges both fire on the same node (spec Edge Cases)

```bash
echo " " >> tests/fixtures/dual-signal/script.md
pc status --episode tests/fixtures/dual-signal
```

**Expect both, independently**:
- `narration` → `needs-review` (a human must decide)
- `transcript` → `stale` (a machine can rebuild it)

Then:

```bash
pc build transcript --episode tests/fixtures/dual-signal
pc status --episode tests/fixtures/dual-signal
```

**Expect**: `transcript` is now `fresh`, and `narration` **still** reports `needs-review`.
Rebuilding the machine-made artifact must not clear the human's question. This is the
scenario where one signal most easily swallows the other.

## S8 — Build and record are inseparable (SC-009, FR-014)

```bash
pc build epub --episode tests/fixtures/minimal
git diff --stat    # ledger changed; dist/ is untracked
```

**Expect**: the ledger entry names each input hash, the tool, and its version. Then confirm
no path exists to avoid it:

```bash
pc build --help | grep -i "no-record"   # expect: nothing
pc --help | grep -iE "^\s*record"       # expect: nothing
```

**Expect**: no flag and no verb. The guarantee is the absence of an alternative.

## S9 — The store adapter really speaks S3 (FR-027, SC-010)

Requires Docker; this is the only scenario that does.

```bash
npm run test:integration:store    # MinIO via testcontainers
```

**Expect**: pass against a real S3-compatible server. If Docker is unavailable the suite
**announces the skip loudly** — a silent skip would be a false-clean.

## S10 — Status never touches the network (SC-001, FR-025)

```bash
npm run test:offline    # runs the full status suite with network access denied
```

**Expect**: pass. Content addressing is what makes this possible — the pointer already
holds the hash, so nothing needs fetching to answer staleness.

## S11 — A provider runs by hand (SC-008, FR-031)

```bash
echo '{"version":1,"target":"podcast","inputs":{"voiceover":{"path":"/tmp/v.wav","hash":"sha256:..."}},"output_dir":"/tmp/out"}' \
  | ./tests/fixtures/fake-provider
```

**Expect**: it produces its outputs and returns a `BuildResponse`, with no
production-control present and no credentials. If this fails, the boundary is drawn wrong.

## S12 — Refusals are refusals (FR-005)

```bash
pc status --episode tests/fixtures/cycle       # exit non-zero, names the cycle
```

**Expect**: refusal naming the offending declaration — never a partial graph, never a
best-effort parse.

# Execution ledger — a note on `reviewRecorded`

`001-episode-production-contract.ledger.jsonl` records, per task, the resolved model
tier, the model, and the commit range — the resume-safety and observability record the
`/stack-control:execute` skill asks for.

## Why the field is `reviewRecorded: false`, not `reviewClean: true`

The ledger originally carried `reviewClean: true` on every one of its 78 rows. Governance
finding **AUDIT-20260716-20** correctly rejected that as either false or unfalsifiable:

- **False** for at least T078, whose closing commit (`7d2a0ba`) exists *because* its review
  was not clean — it fixed a directory-input build bug the review found.
- **Unfalsifiable** in general, because a fix-then-ledger loop makes every row green by
  construction. A field whose only possible value is `true` carries no information, and a
  downstream governance consumer reading 78 green rows would over-weight it.

The root defect is that per-task review outcomes were **not captured live** while the
tasks ran — the rows were stamped uniformly after the fact. Rather than fabricate
findings-counts I did not record at the time, the field now states the truth:
`reviewRecorded: false` — no per-task review outcome was captured. This is honest about
the limitation instead of asserting a clean review that cannot be substantiated.

## Evidence that reviews DID find real defects

So no reader concludes "no reviews happened," these commits in the audited range are the
review record that the ledger failed to capture per-row:

- `1edfc7a` — "Fix the @/ alias shipping broken output" — a review-round fix (typecheck +
  build passed while the shipped output was unloadable at runtime).
- `552e21f` (and its family) — "Apply architecture review" — findings applied.
- The graph tasks (T015/T016) — two vacuous/unsatisfiable tests caught and rewritten
  during review before the tasks were ledgered.
- T001 — a review round pinned `typescript` back from an unapproved major and removed a
  lint script that passed while checking nothing.
- `7d2a0ba` — "fix the directory-input build bug it found" — T078's review.

## Going forward

A future execution should record the real per-task outcome — findings count, disposition,
and whether re-review was required — so a row like T078's reads as
`{ findings: 1, resolvedIn: "7d2a0ba" }` rather than as clean. This note stands in for that
schema until it exists.

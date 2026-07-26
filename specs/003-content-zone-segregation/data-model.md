# Data model: Content zone segregation (Phase 1)

This feature adds **no new persisted schema** and **no new node kind** (FR-018). The "entities" below
are in-memory value types and the existing structures they read. Nothing here changes the ledger,
manifest, or graph schemas.

## Zone (new value type)

A closed enum, the result of classification.

```
Zone = 'human-safe' | 'ai-permitted'
```

- **`human-safe`** — no impure output may occupy it (INV-1); authored content belongs here.
- **`ai-permitted`** — impure output belongs here; pure/operational files may also live here.

Derivation (pure, total — `src/zoning/classify.ts`):

> `classifyZone(relPath)` = `'ai-permitted'` iff at least one **parent directory** segment of
> `relPath` begins with `.`; otherwise `'human-safe'`. `relPath` is POSIX, relative to the
> production root. The **basename does not participate**. Segments above the production root do not
> participate (the caller passes a production-root-relative path).

Properties: deterministic; requires no configuration; total over all relative paths; independent of
filesystem access (classification is lexical over the *resolved* path the caller supplies — see the
enforcement note on `realpath`).

## ContentClass (existing — read, not added)

The existing node/provider distinction, read to enforce INV-3:

- **authored** — `graph` node kind `authored` (`src/graph/build.ts`).
- **pure-derived** — a `derived` node whose provider declares no impurity (`ProviderDecl.impure` absent
  and `BuildResponse.impure` absent).
- **impure-derived** — impurity present (statically declared; corroborated, never introduced, at
  runtime per FR-012).

Agreement rule (INV-3), enforced, not stored:

| ContentClass | Required Zone |
| --- | --- |
| authored | `human-safe` |
| impure-derived | `ai-permitted` |
| pure-derived | either |

## RoutingDecision (existing — refined)

The assigned output root for a build, chosen so class and zone agree by construction.

- Existing: `outputRoot = impurityOf(decl, response) ? 'ai-generated' : 'dist'` (`build.ts:112`).
- Refined: the impure root string `'ai-generated'` becomes **`'.ai'`** (R2); the pure root `'dist'` is
  unchanged. `impurityOf` gains a **refusal** when `decl` is pure and `response` is impure (R5, FR-012)
  rather than coalescing.

## OutputResolution (enforcement pipeline — refined, not a stored entity)

Per declared output, in fixed order (R4, FR-009/010/011):

1. resolve the declared path against the assigned output dir;
2. reject traversal/escape (existing lexical guard, retained);
3. `fs.realpath` the destination and confirm it is **contained** within the assigned output dir
   (new — closes the symlink/real-path hole, D5c);
4. `classifyZone` the resolved, contained destination and refuse if the class↔zone rule is violated,
   **naming the path** (FR-011/FR-022);
5. stage (existing atomic stage-then-rename).

## AuditReport (new — emitted by the audit verb, not persisted)

Read-only routing-policy report (R7, FR-013/014/015):

- per offending target: `{ id, class, assignedRoot, expectedZone, actualZone }`;
- a scope statement present in **every** run: runtime filenames and provider escape are checked only at
  build time, not by the audit;
- exit 0 when clean, non-zero when any violation is present; `--json` available.

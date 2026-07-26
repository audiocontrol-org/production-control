# Contract: Zone classifier

The pure classification function at the heart of the feature. No I/O; deterministic; total.

## Signature (conceptual)

```
classifyZone(relPath: string): 'human-safe' | 'ai-permitted'
```

- **Input**: a POSIX path **relative to the production root**. The caller is responsible for making it
  production-root-relative and, in the enforcement path, for passing the **`realpath`-resolved**
  destination (so a symlink cannot be classified by a lexical name — FR-010).
- **Output**: exactly one `Zone`.

## Rules (normative)

1. **Any-dot-wins over parent directories** — result is `ai-permitted` iff at least one directory
   segment of `relPath` (i.e. every segment except the basename) begins with `.`.
2. **Basename excluded** — a dot-prefixed file in an otherwise non-dot directory is `human-safe`
   (`dist/.draft.md` → human-safe). (FR-002)
3. **Total & fail-safe** — a path with no dot-prefixed directory segment is `human-safe` (FR-004).
4. **No configuration** — the function reads nothing but its argument.
5. **Above-root exclusion is the caller's** — the function sees only a relative path; segments above
   the production root are never in it (FR-003).

## Golden cases (must be tests)

| relPath | Zone | Rule |
| --- | --- | --- |
| `ch01.md` | human-safe | 3 |
| `dist/ep01/out.wav` | human-safe | 3 (no dot dir) |
| `.ai/ep01/ch01.md` | ai-permitted | 1 |
| `dist/.ai/ch01.md` | ai-permitted | 1 |
| `dist/target/.ai/out.md` | ai-permitted | 1 (nested dot) |
| `dist/.draft.md` | human-safe | 2 (basename only) |
| `.cache/x` / `.tmp/x` | ai-permitted | 1 (identical to `.ai`) |
| `` (root) / `a/b/c.md` | human-safe | 3 |

## Non-goals

- Does not resolve symlinks itself (caller passes the resolved path).
- Does not read the graph or provenance (that is the enforcement/audit layer's join).
- Does not know `.ai` is "special" — it is not; only the leading dot matters (FR-016).

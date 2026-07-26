# Contract: Zone classifier

The pure classification function at the heart of the feature. No I/O; deterministic; total.

## Signature (conceptual)

```
classifyZone(relPath: string, kind: 'file' | 'directory'): 'human-safe' | 'ai-permitted'
```

- **Input**: a POSIX path **relative to the production root**, plus a REQUIRED `kind` stating whether
  the path names a `file` or a `directory`. The caller is responsible for making it
  production-root-relative and, in the enforcement path, for passing the **`realpath`-resolved**
  destination (so a symlink cannot be classified by a lexical name — FR-010).
- **Output**: exactly one `Zone`.

## Rules (normative)

1. **Any-dot-wins over directory segments** — result is `ai-permitted` iff at least one directory
   segment begins with `.`. Which segments count as directory segments is decided by `kind`, never by
   a trailing `/`: `kind: 'directory'` counts EVERY segment (so the bare root `.ai` is `ai-permitted`);
   `kind: 'file'` excludes the basename.

   **The rule is deliberately unbounded, not `.ai`-specific (ratified — FR-016, AUDIT-19):** ANY
   dot-prefixed directory segment is AI-permitted — `.ai`, `.cache`, `.tmp`, and equally any other
   dotted directory. `.ai` is the *convention* the build writes to, not a privileged name; a
   dot-prefixed directory universally signals "not a human-safe authoring area." This is intentional:
   the zone is a legibility signal about human-safety, not a whitelist of one root. Note the scope —
   `classifyZone` is only ever handed a path **relative to a production/episode root** (a build output
   destination or a declared manifest node path); it is never fed the repository tree, so top-level
   tool/VCS directories (`.git/`, `.github/`, `.stack-control/`) are outside its inputs by
   construction and are not "zoned" by it.
2. **Basename excluded (files only)** — under `kind: 'file'` a dot-prefixed file in an otherwise
   non-dot directory is `human-safe` (`dist/.draft.md` → human-safe; a file literally named `.ai` →
   human-safe). (FR-002)
3. **Total-WITH-REFUSAL** — a well-formed path with no dot-prefixed directory segment is `human-safe`
   (FR-004); an ABSOLUTE path, or one that NORMALIZES to a climb above the root (`..`), is REFUSED
   (throws `ClassifyZoneInputError`) rather than resolving to the permissive verdict (AUDIT-01).
4. **No configuration** — the function reads nothing but its arguments.
5. **`kind` is compiler-enforced** — the earlier `(string) => Zone` shape let a directory path passed
   without a trailing slash (e.g. the `.ai` root) silently classify `human-safe`; requiring `kind`
   closes that false-safe structurally (AUDIT-14/15).

## Golden cases (must be tests)

| relPath | kind | Zone | Rule |
| --- | --- | --- | --- |
| `ch01.md` | file | human-safe | 3 |
| `dist/ep01/out.wav` | file | human-safe | 3 (no dot dir) |
| `.ai/ep01/ch01.md` | file | ai-permitted | 1 |
| `dist/.ai/ch01.md` | file | ai-permitted | 1 |
| `dist/target/.ai/out.md` | file | ai-permitted | 1 (nested dot) |
| `dist/.draft.md` | file | human-safe | 2 (basename only) |
| `.cache/x` / `.tmp/x` | file | ai-permitted | 1 (identical to `.ai`) |
| `a/b/c.md` | file | human-safe | 3 |
| `.ai` / `.cache` / `dist/.ai` | directory | ai-permitted | 1 (root itself, AUDIT-14/15) |
| `.ai` | file | human-safe | 2 (a dotfile named `.ai`) |
| `../x` / `/abs/x` | file | REFUSED | 3 (throws, AUDIT-01) |

## Non-goals

- Does not resolve symlinks itself (caller passes the resolved path).
- Does not read the graph or provenance (that is the enforcement/audit layer's join).
- Does not know `.ai` is "special" — it is not; only the leading dot matters (FR-016).

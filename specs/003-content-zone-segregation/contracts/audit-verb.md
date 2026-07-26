# Contract: Routing-audit CLI verb

A new read-only `pc` verb that audits **routing policy** over the manifest/graph. It is not an
artifact audit — it cannot know provider-chosen runtime filenames or a runtime escape (those are the
build's job) and MUST say so in every run (FR-014, Principle V).

## Invocation

```
pc <audit-verb> [--episode <path>] [--json]
```

(Concrete verb name settled in tasks; e.g. `pc audit-zones`. It follows the existing CLI conventions
in `src/cli/index.ts`.)

## Behavior

- **Reads** the resolved manifest/graph; writes nothing.
- For every **impure** target, checks that its assigned output root would be dot-zoned (`.ai/`).
- For every **authored** node, checks that its declared path is `human-safe` (FR-006/D2b).
- Reports each violation, **naming the target** and stating class, assigned/declared root, expected and
  actual zone.
- Emits, in **every** run (clean or not), the scope statement: runtime filenames and provider escape
  are verified only at build time, not by this audit.

## Exit codes (gate semantics)

- **0** — no routing violation found (clean). `--json` still emitted.
- **non-zero** — at least one violation; each is named. (Constitution: read verbs `--json` + exit 0;
  gates exit non-zero — the audit is a gate.)

## Output

- Human-readable by default; `--json` for the agent (a machine-readable `AuditReport`, see
  `data-model.md`).
- Every reported state names its cause (no state without a cause).

## Non-goals

- Does not build, resolve provider outputs, or touch object storage.
- Does not claim to have verified artifacts on disk — only routing policy.

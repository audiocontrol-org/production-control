---
doc-grammar: design-inbox
---

# Design Inbox

A governed, low-friction parking lot for out-of-sequence design ideas. Capture
and triage with `stackctl inbox` (`capture` / `promote` / `drop` / `list`) —
do not hand-edit.

### declarative-production-with-deterministic-corroboration
- **Surfaced:** Third-party review of the voice-editions design record, 2026-07-25. The reviewer observed that quote-bank, voice-editions and artifact-adoption have each independently converged on this shape and predicted it would keep being rediscovered.
- **Context:** Instances so far: quote-bank (impure miner, verbatim fidelity validator, mining report); voice-editions (impure revise provider, coverage ledger, fidelity validator, structured coverage report with not-run and not-checkable states); artifact-adoption (human as the impure producer, declared adoption provenance, the same validators re-run). Candidate home is a governing document rather than any single feature spec, since its value is that the next feature does not have to rediscover it. Would also give a shared vocabulary for the trust-boundary question every one of these features has had to argue from scratch: what is declared versus what is proved.
- **Idea:** Name and document the recurring architectural pattern: impure producer -> declarative metadata -> deterministic corroboration -> structured coverage report. The producer may be impure (a language model) and is never permitted to certify itself; it emits declarative metadata describing what it did; an independent deterministic validator corroborates those declarations rather than inferring them; and the verdict is accompanied by a structured report naming every check performed, skipped, and not-checkable, so the system never claims to have proved something it did not prove.
- **Status:** **captured**

### machine-operational-storage-zone
- **Surfaced:** Third-party final review of the content-zone-segregation design record, 2026-07-25; reviewer approved and flagged this only as something to watch, explicitly not to add now.
- **Context:** Relates to D5b (a dot-zone means AI-permitted / not human-safe, not 'definitely AI' - pure and operational files already legitimately live in dot-zones). The distinction would be human-facing (a third answer to 'is it safe for me to author here, and what is this') rather than a graph node-kind change. Home: a future roadmap item if it earns one.
- **Idea:** A possible future FOURTH storage category (not a fourth node kind): machine-operational state - .production/, .cache/, .work/ - that is neither human-authored nor an AI/pure build artifact, but system scratch/state. Today it falls naturally under any-dot-wins as AI-permitted (dot-zoned), which is fine. It may eventually deserve to be named as its own zone so the human-legibility story distinguishes 'AI-permitted output' from 'operational state a human should also not treat as authored'. Watch as the repo grows; do NOT add now.
- **Status:** **captured**
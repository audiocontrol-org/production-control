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
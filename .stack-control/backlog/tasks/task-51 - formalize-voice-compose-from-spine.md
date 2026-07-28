---
id: TASK-51
title: formalize-voice-compose-from-spine
status: To Do
assignee: []
created_date: '2026-07-28 19:27'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - prototype validated 2026-07-28
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compose mode (expand a source-cited spine into a chapter; forbid verbatim; enforce spine fidelity discipline -- no invention, claims-as-assertions, open-question preserved) is prototyped env-gated in model.ts and empirically fidelity-passes on Ep1. Formalize as a governed increment: make mode a first-class request/target field (not an env var), have buildEdition defensively reject verbatim in compose mode, spec the spine-fidelity requirements + tests, and fold in TASK-50 (verbatim-drift). design -> define -> execute -> govern -> ship.
<!-- SECTION:DESCRIPTION:END -->

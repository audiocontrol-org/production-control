---
id: TASK-50
title: voice-revise-alters-verbatim-declared-units
status: To Do
assignee: []
created_date: '2026-07-28 06:15'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - 'empirical: full-ebook 8-voice run'
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Empirical shake-out (56 editions): 2 refused by voice fidelity, both same mode -- the model declared a source unit op=verbatim but altered its bytes (ch04/investigative-momentum, ch06/intimate-witness). Producer prompt should more strongly enforce that a verbatim disposition reproduces the unit's bytes EXACTLY (or the producer could validate verbatim-declared units against the source before emitting and downgrade/refuse). Not a tooling defect -- the gate correctly refused -- but a prompt-discipline refinement. 54/56 (96%) faithful.
<!-- SECTION:DESCRIPTION:END -->

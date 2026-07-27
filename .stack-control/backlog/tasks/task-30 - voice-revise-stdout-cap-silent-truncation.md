---
id: TASK-30
title: voice-revise-stdout-cap-silent-truncation
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-28
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
model.ts 32MiB stdout cap drops the crossing chunk and resolves the accumulated prefix as a complete edition with exit 0 (contradicts never-partial-output). On crossing the cap child.kill()+reject naming the limit and byte count.
<!-- SECTION:DESCRIPTION:END -->

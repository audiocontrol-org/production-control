---
id: TASK-21
title: unit-accounting-no-double-disposition-test
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-04
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
unit-accounting.test.ts never tests two entries for the same source unit (the exactly-once direction that fails open). Add a double-disposition test asserting ok=false naming the double-counted unit.
<!-- SECTION:DESCRIPTION:END -->

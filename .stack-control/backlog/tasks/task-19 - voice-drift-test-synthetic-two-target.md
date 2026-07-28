---
id: TASK-19
title: voice-drift-test-synthetic-two-target
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-02
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-freshness.test.ts proves producer-drift only via a synthetic two-target fixture; the real single-edition upgrade path (build, bump tool, pc status) reports no drift. Add a same-target rebuild-at-new-version leg or state the single-artifact limitation.
<!-- SECTION:DESCRIPTION:END -->

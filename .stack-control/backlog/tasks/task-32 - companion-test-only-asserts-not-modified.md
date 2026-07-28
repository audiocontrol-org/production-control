---
id: TASK-32
title: companion-test-only-asserts-not-modified
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-30
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-inputs.test.ts only asserts edition state !== modified; a regression to stale would still pass though follows is advisory-not-input. Assert state === fresh and that no cause names companion.
<!-- SECTION:DESCRIPTION:END -->

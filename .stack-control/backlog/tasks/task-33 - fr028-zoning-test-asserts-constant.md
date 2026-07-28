---
id: TASK-33
title: fr028-zoning-test-asserts-constant
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-31
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-zoning.test.ts FR-028 block copies a fixture, discards it, and asserts impureOutputRoot() === '.ai' (tautology); it never routes an edition. Build the edition target and assert the produced path is under .ai/, plus the negative refusal case, or delete the block and name where FR-028 build-gate coverage lives.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-34
title: node20-test-discovery-zero-ts
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-01
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Node 20 the built-in test runner default glob may not match .ts files, so npm test (node --import tsx --test) could discover zero tests and pass green having run nothing. Pin an explicit test-file glob or a min-count assertion; verify on the repo's declared Node floor.
<!-- SECTION:DESCRIPTION:END -->

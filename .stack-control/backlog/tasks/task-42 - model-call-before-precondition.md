---
id: TASK-42
title: model-call-before-precondition
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260727-17
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-revise runs the expensive impure model call before the cheap readPackageVersion precondition it depends on; a missing package version wastes the model call. Check preconditions first.
<!-- SECTION:DESCRIPTION:END -->

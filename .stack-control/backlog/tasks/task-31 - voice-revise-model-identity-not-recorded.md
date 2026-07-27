---
id: TASK-31
title: voice-revise-model-identity-not-recorded
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-29
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
revise records tool.version only from package.json, so a model swap behind a fixed command is invisible to producer-drift. Resolve a model identity from the adapter and include it in tool.version, or refuse when identity is unavailable.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-22
title: voice-tooling-excluded-from-repo-gates
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-05
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-tooling is in eslint ignores and its node --test + tsc gates are not wired into any repo/CI entry point; a change under voice-tooling/src can break the validator and repo verification stays green. Add a root script running npm --prefix voice-tooling test && typecheck into CI.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-23
title: voice-tooling-typing-not-mechanically-gated
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-06
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
eslint.config.mjs comment claims voice-tooling typing (no any/as/ts-ignore) is still enforced, but node --test + tsc --noEmit cannot enforce it. Give voice-tooling a minimal eslint config carrying no-explicit-any/no-unnecessary-type-assertion/ban-ts-comment, or correct the comment.
<!-- SECTION:DESCRIPTION:END -->

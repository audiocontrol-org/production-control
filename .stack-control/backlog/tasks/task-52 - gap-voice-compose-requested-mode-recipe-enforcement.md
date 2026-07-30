---
id: TASK-52
title: gap/voice-compose-requested-mode-recipe-enforcement
status: To Do
assignee: []
created_date: '2026-07-30 01:09'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/006-voice-compose-from-spine/audit-log.md AUDIT-20260730-07
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Govern round-2 disposition (AUDIT-07): voice-tooling wire validator contract is requested_mode OPTIONAL (supplied->compared; absent->disclosed as none-supplied). The guarantee that a GOVERNED build supplies requested_mode belongs to the provider recipe / orchestration layer (root package), NOT the subject-agnostic wire validator. Follow-up: enforce recipe-side that a governed ValidateRequest carries requested_mode so a dropped/misspelled key cannot silently degrade mode-agreement to a no-op.
<!-- SECTION:DESCRIPTION:END -->

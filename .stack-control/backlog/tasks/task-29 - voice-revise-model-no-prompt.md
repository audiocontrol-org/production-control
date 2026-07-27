---
id: TASK-29
title: voice-revise-model-no-prompt
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-27
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
invokeModel sends only JSON {version,target,source,voice} with no task instruction/prompt/ledger-schema, so only the deterministic stub can satisfy the documented output contract; a real claude -p emits prose not a ledgered edition. Construct the model prompt in model.ts and pin it with a test.
<!-- SECTION:DESCRIPTION:END -->

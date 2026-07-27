---
id: TASK-40
title: validator-request-hash-unverified
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-27
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ValidateRequest declared input hashes are shape-checked but never verified against the bytes actually read by the validator (the validator-side analogue of the provider-side AUDIT-20260726-12 fix). Verify or refuse.
<!-- SECTION:DESCRIPTION:END -->

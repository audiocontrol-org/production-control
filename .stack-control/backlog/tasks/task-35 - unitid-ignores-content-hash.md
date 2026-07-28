---
id: TASK-35
title: unitid-ignores-content-hash
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-10
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
unitId test set is satisfied by an implementation that ignores content_hash, so a colliding durable identity would ship green. Add a test where two units differ only by content_hash and assert distinct unitId.
<!-- SECTION:DESCRIPTION:END -->

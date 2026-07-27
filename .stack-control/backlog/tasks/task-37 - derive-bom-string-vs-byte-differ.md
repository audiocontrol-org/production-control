---
id: TASK-37
title: derive-bom-string-vs-byte-differ
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-32
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
deriveUnits(string) and deriveUnits(bytes) derive different units for a BOM-prefixed source (byte path strips/handles BOM differently than the string path). Normalize both paths and add a BOM fixture (SC-007 reproducibility).
<!-- SECTION:DESCRIPTION:END -->

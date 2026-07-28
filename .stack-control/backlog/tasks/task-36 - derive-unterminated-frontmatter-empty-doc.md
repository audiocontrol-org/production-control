---
id: TASK-36
title: derive-unterminated-frontmatter-empty-doc
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260727-11
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No fixture pins deriveUnits on an unterminated frontmatter block or an empty document; a silent zero-unit result makes unit_accounting vacuously pass. Add golden fixtures + an empty/zero-unit guard.
<!-- SECTION:DESCRIPTION:END -->

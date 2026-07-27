---
id: TASK-41
title: required-key-guard-incomplete
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260727-22
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The AUDIT-13/16 required-key guard is satisfied by emitting an applicable check as not-run (unconditionally non-blocking), and its regression test covers only 2 of 10 required checks. Make inapplicability explicit and test all 10 keys. (also AUDIT-20260727-23)
<!-- SECTION:DESCRIPTION:END -->

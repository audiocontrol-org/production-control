---
id: TASK-38
title: derive-fenced-code-same-char-prefix
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-33
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fenced-code matching closes on any same-character fence prefix (a shorter/longer run of the same char), diverging from CommonMark close rules; can mis-split units inside code. Tighten the close rule + fixture.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-39
title: emit-target-into-filename-unvalidated
status: To Do
assignee: []
created_date: '2026-07-27 17:49'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260727-16
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-revise emit interpolates the wire-supplied target straight into the output filename with no validation; an agent/attacker-controlled target string is an unaudited value channel (path traversal). Validate/sanitize target before it reaches the path + refusal fixture.
<!-- SECTION:DESCRIPTION:END -->

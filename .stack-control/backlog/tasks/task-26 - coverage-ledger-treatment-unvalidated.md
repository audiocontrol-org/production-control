---
id: TASK-26
title: coverage-ledger-treatment-unvalidated
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-24
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CoverageEntry.treatment has zero validation coverage and D21 unknown-key acceptance swallows a typo (treatement) or omission silently. Add treatment tests mirroring the reason set and make near-miss spellings of known keys a named refusal or pin a closed treatment value set.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-20
title: fidelity-refuse-tests-break-reference-not-obligation
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-03
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fidelity-refuse.test.ts mutates edition body bytes; edition_units are hash-keyed so the reference dangles before the obligation fails, so verbatim/citation refusal tests may certify reference-resolution not byte-equality/citation-preservation. Update the ledger edition_units hash to the mutated unit and assert no reference-resolution failure fired.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-27
title: lexicon-obligation-test-asserts-only-flag
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-25
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
op-obligations.test.ts lexicon test asserts only lexiconApplicable=true on a fixture whose lexicon term (Gamma vs lowercase gamma) does not survive case-exactly; it blesses a validator that reports lexiconApplicable while performing no lexicon obligation. Assert ok=false with the shortfall, plus a positive fixture where the term survives.
<!-- SECTION:DESCRIPTION:END -->

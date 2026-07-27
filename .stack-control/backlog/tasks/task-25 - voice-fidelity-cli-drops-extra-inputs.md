---
id: TASK-25
title: voice-fidelity-cli-drops-extra-inputs
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - AUDIT-20260726-22
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-fidelity CLI reads only source+lexicon and hardcodes quoteBankDeclared=false; any other declared input (e.g. quote_bank) is silently dropped so the D14 conditional is unreachable and unrun with a passed verdict. Refuse unrecognized input keys by name, or thread quote_bank through.
<!-- SECTION:DESCRIPTION:END -->

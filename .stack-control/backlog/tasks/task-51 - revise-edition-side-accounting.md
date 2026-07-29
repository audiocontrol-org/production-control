---
id: TASK-51
title: revise-edition-side-accounting
status: To Do
assignee: []
created_date: '2026-07-29 01:45'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - 'design:feature/voice-compose-from-spine'
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compose-from-spine adds edition-side grounding accounting (every edition unit declares its origin: grounded/connective/framing) so undeclared invented prose fails the gate. revise mode has the same source-directed gap (check-unit-accounting accounts source units only), but applying reverse accounting to revise now would invalidate the 54 already-shipped editions (no grounding records). Deferred to a follow-up: extend edition-side grounding accounting to revise mode, with a migration/regeneration path for existing editions. Not urgent -- revise transforms existing prose so the invention risk is lower than compose, and TASK-50 verbatim-drift is already handled.
<!-- SECTION:DESCRIPTION:END -->

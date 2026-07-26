---
id: TASK-16
title: gap/adopter-migration-ai-generated-to-dot-ai
status: To Do
assignee: []
created_date: '2026-07-26 13:18'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/003-content-zone-segregation/audit-log.md AUDIT-20260726-04
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
content-zone-segregation renames the impure output root ai-generated to .ai. An adopter episode that already has artifacts on disk and committed ledger records under ai-generated/ has no upgrade path: no migration verb, no doctor rule, no legacy-read compatibility. Post-upgrade the first build writes .ai/ while old records/README point at ai-generated/ (provenance-vs-artifact drift). No external adopters exist yet (greenfield), so dispositioned out of feature 003 scope. Follow-on: a pc verb or doctor rule that detects ai-generated on disk or in records and relocates+rewrites or refuses with instructions, plus an upgrade note.
<!-- SECTION:DESCRIPTION:END -->

---
id: TASK-9
title: gap/miner-never-proposes-ocr-fix
status: To Do
assignee: []
created_date: '2026-07-25 01:31'
updated_date: '2026-07-25 01:31'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-corpus validation finding. Across 207 quotes mined from real OCR sources, the miner emitted ZERO ocr-fix edits (every quote had edits: []). The schema, the deterministic reconstruction, and the validator all fully support disclosed ocr-fix (and it is where most of the audit fixes landed), but the miner has no path to propose one, so on a corpus that is largely OCR damage the corruption flows verbatim into the bank and into anything downstream (e.g. 'etplus digne', 'sought. to make', 'exclue de cette'). Give the miner a way to propose disclosed closed-set ocr-fix edits for obvious OCR corruption. Authoring-boundary risk is real but bounded: an ocr-fix is anchored (before must occur in the raw), disclosed, and independently validated, so cleanup still cannot become authoring.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

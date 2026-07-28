---
id: TASK-28
title: voice-revise-lexicon-input-misdiagnosed-as-source
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-26
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
parseReviseRequest buckets everything non-voice as source and refuses !=1 as more-than-one-source; a contract-legal source+voice+lexicon/quote-bank is refused with a misleading source-count diagnosis. Classify voice/lexicon/source by type so a lexicon is bucketed out before the source-count check.
<!-- SECTION:DESCRIPTION:END -->

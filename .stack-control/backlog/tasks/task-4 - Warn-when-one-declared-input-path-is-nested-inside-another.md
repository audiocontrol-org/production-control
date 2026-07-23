---
id: TASK-4
title: Warn when one declared input path is nested inside another
status: To Do
assignee: []
created_date: '2026-07-22 23:34'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - src/graph/validate.ts
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Modeling the Nouvelle-France Ep 1 episode, I declared assets -> assets/ (a directory input) and narration -> assets/narration/take-01.wav (a file inside that same directory). The two inputs overlap: changing narration also changes the assets tree hash, coupling two nodes that should be independent, and a narration edit would spuriously restale everything built from assets. production-control accepts this silently. It should detect and refuse (or at least warn) when one authored input's path is nested inside another's, the same way it refuses cycles and dangling refs -- a real modeling footgun a first-time consumer hits. Found in the nouvelle-france forcing-function trial.
<!-- SECTION:DESCRIPTION:END -->

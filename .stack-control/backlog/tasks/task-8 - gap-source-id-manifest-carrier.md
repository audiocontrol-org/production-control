---
id: TASK-8
title: gap/source-id-manifest-carrier
status: To Do
assignee: []
created_date: '2026-07-25 01:31'
updated_date: '2026-07-25 01:31'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-corpus validation finding. The v1 source-id rule (id = filename stem) fails on first contact with a real archive: all 4545 documents in the port-breton archive are named issue.txt, so the whole corpus is one FR-018 duplicate-id collision and cannot be mined at all without renaming files. Worse, the project ALREADY has canonical stable source ids (PB-P001..PB-P094 in colony-cults/bibliography/sources) which are not filenames and are the ids used by the [PB-P###] citation scheme everywhere else. data-model.md anticipated this: 'A manifest carrier may be added later without changing the fidelity model; the filename-stem rule is v1.' Add an optional manifest (e.g. sources.yaml in the sources dir) mapping stable source id -> relative path, used by BOTH miner and validator; keep filename-stem as the fallback when no manifest is present. Does NOT change the fidelity model.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

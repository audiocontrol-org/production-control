---
id: TASK-2
title: Quickstart build scenarios cannot run as written
status: To Do
assignee: []
created_date: '2026-07-15 21:04'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - specs/001-episode-production-contract/quickstart.md
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
S5/S7/S8 resolve the committed profiles/editorial-audio.yaml and try 'npx audio-tooling', which does not exist and reaches the NETWORK to discover that. No fixture profile points at tests/fixtures/fake-provider. The doc's Prerequisites claim 'No craft tools. No bucket. No Docker except S9' and explicitly stake SC-007 on it: 'if these scenarios required real tooling, SC-007 would be false'. As committed, they do. Either wire a fixture profile at the fake provider or state the setup step honestly. Found by the T078 quickstart walk.
<!-- SECTION:DESCRIPTION:END -->

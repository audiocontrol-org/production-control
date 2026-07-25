---
id: TASK-10
title: bug/miner-opaque-and-aborts-on-one-bad-source
status: To Do
assignee: []
created_date: '2026-07-25 01:31'
updated_date: '2026-07-25 01:31'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two real-corpus validation findings in the miner's operator experience. (1) OPAQUE LONG RUNS: the mining report is only written at the end, so a long multi-source run emits nothing until it finishes; two killed full-corpus runs produced zero diagnostics and no way to tell how far they got. Stream per-source progress to stderr as each source completes. (2) ONE BAD BYTE KILLS THE RUN: a single non-UTF-8 source aborts the whole build (FR-015b, by design) but only names the FIRST bad source, so an operator fixing a 122-source corpus discovers them one run at a time; two such files exist in the real archive. Keep failing loud (do not silently skip - that is the false-clean the spec forbids) but pre-scan and name EVERY unreadable/non-UTF-8 source in one refusal so the corpus can be fixed in a single pass.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

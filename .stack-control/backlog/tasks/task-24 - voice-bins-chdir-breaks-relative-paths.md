---
id: TASK-24
title: voice-bins-chdir-breaks-relative-paths
status: To Do
assignee: []
created_date: '2026-07-26 23:23'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260726-20
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice-revise.mjs and voice-fidelity.mjs process.chdir into the package before resolving argv, so relative operator paths resolve against voice-tooling/ and any spawned model inherits the wrong cwd. Set TSX_TSCONFIG_PATH instead of chdir, or resolve all argv paths absolute (against original cwd) before chdir and refuse relative. (also AUDIT-20260726-09)
<!-- SECTION:DESCRIPTION:END -->

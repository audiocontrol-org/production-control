---
id: TASK-1
title: Directory-valued outputs unsupported end-to-end
status: To Do
assignee: []
created_date: '2026-07-15 21:04'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/001-episode-production-contract/spec.md
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
run.ts refuses a directory output before invoke.ts/ingest could mishandle it, so nothing is broken today. But spec.md:206 and data-model.md:308 both describe directory outputs as real, the tree-output fixture exists for it and is NEVER BUILT, and identity.ts already handles it for status. inputs.ts:265, invoke.ts:78 and providers/build.ts:132 all hash or copy outputs as files. Fixing any one alone would half-implement it and manufacture the illusion of support. Found by the T078 quickstart walk - the same 'no test builds it' gap that hid the directory-INPUT bug (which was real and is now fixed).
<!-- SECTION:DESCRIPTION:END -->

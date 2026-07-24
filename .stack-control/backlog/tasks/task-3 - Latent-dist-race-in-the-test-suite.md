---
id: TASK-3
title: Latent dist race in the test suite
status: To Do
assignee: []
created_date: '2026-07-15 21:04'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - tests/integration/support.ts
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
build-emit.test.ts runs 'npm run build' twice while the integration project concurrently copies the node_modules/.cache/pc-cli-under-test snapshot. Documented in support.ts's own comments. A lazy-import fix to the S3 adapter (static import put the whole AWS SDK on pc status's startup path, ~42ms/invocation for a client it structurally cannot use) stopped PROVOKING it - suite went 120s -> 55s - but the race is still there and resurfaces whenever the suite slows again.
<!-- SECTION:DESCRIPTION:END -->

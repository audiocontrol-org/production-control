---
id: TASK-17
title: bug/govern-empty-diff-chunk-dispatch
status: To Do
assignee: []
created_date: '2026-07-26 13:18'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - specs/003-content-zone-segregation/audit-log.md AUDIT-20260726-09
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During end-govern-after_implement on content-zone-segregation, chunk ecfb4e19fe0283f1 (declared file tests/integration/zoning.test.ts) was dispatched to the audit fleet with an EMPTY diff payload (a Diffs heading with zero hunks). The audit lane returned nothing, which is indistinguishable from a clean pass, so the feature's single highest-value integration-test surface went effectively unaudited that round while being counted toward convergence. Fleet-degradation pricing says a round computed over a zero-payload lane is weaker cross-model agreement than the count implies. Fix on the govern/chunker side: fail loud when a chunk's rendered diff body is empty (an empty body is a chunking bug, likely a path/rename mismatch, not a legitimate no-change state since the chunk would not exist otherwise), and mark the lane degraded in the run record so the tally prices it as a missing model. This is govern tooling, not feature-003 code.
<!-- SECTION:DESCRIPTION:END -->

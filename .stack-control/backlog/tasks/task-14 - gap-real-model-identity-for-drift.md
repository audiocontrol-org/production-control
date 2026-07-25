---
id: TASK-14
title: gap/real-model-identity-for-drift
status: To Do
assignee: []
created_date: '2026-07-25 05:42'
updated_date: '2026-07-25 05:42'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-on to AUDIT-21, now actually solvable. The miner's tool.version currently encodes only the resolved command basename ('claude'), so swapping the underlying model (Opus vs Sonnet vs Haiku) behind a fixed claude command is invisible to production-control's producer-drift reporting - the one thing FR-020 asks that string to detect. The AUDIT-21 fix added a QUOTE_MINER_MODEL_ID override, but that requires the operator to know and set it. Now verified: running the claude CLI with --output-format json returns a modelUsage object naming the real model (observed: canonicalModel 'claude-opus-5'). The adapter should read the actual model identity out of that response and carry it into tool.version, so a model change surfaces as producer drift automatically with no operator action and no production-control core change. Keep the explicit override as a manual escape hatch, and fail loud rather than silently degrading if the identity cannot be resolved.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

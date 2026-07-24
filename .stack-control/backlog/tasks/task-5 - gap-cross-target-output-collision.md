---
id: TASK-5
title: gap/cross-target-output-collision
status: To Do
assignee: []
created_date: '2026-07-24 01:56'
updated_date: '2026-07-24 01:56'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
T018 proving-ground observation surfaced this. editorial-tooling/bin/quote-miner.mjs declares its output filename as a hardcoded quote-bank.yaml regardless of which target invoked it, and production-control's buildTarget commits to ai-generated/<declared-relpath> with no cross-target output-collision check. So two derived targets in one episode that share the quote-miner provider silently overwrite each other's artifact (ai-generated/quote-bank.yaml); pc then correctly classifies the clobbered node as modified (output-edited tamper), never stale and never an auto-rebuild. This is NOT a freshness/drift-logic flaw (drift stayed advisory throughout) and NOT a normal-use bug (one quote-bank target per episode is fine). Harden either by (a) production-control detecting/refusing cross-target output-path collisions at build time, or (b) the provider deriving its output name from the target/request instead of hardcoding. A production-control core concern, out of scope for quote-bank v1.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

---
id: TASK-15
title: build-destroys-hand-edits-without-refusing
status: To Do
assignee: []
created_date: '2026-07-25 20:59'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pc build has no state guard: src/cli/build.ts checks nothing about the node's current state before rebuilding, so building a node whose state is 'modified' overwrites the human edit with no refusal and no warning. The protection around hand edits today is purely advisory - 'modified' is a distinct state (state/resolve.ts), the frontier maps it to 'resolve-edit' and explicitly not 'rebuild' (state/frontier.ts:30), and it blocks release (state/release.ts, FR-017b) - but nothing actually prevents the destructive rebuild. Two paths reach the loss. Direct: pc build on a node reporting 'modified'. Silent: freshness precedence reports 'stale' over 'modified' (state/resolve.ts:136), so editing a derived output and then changing any of its inputs makes the node report 'stale', the edit becomes invisible to status, and an ordinary rebuild destroys it with nothing ever having mentioned an edit existed. The second path is the dangerous one because the operator has no signal at all. Candidate fix: build refuses on 'modified' unless an explicit override is passed, and the stale-and-also-edited case is surfaced rather than collapsed. Surfaced while designing design:feature/artifact-adoption; related but separable - adoption gives the edit a resolution path, this gap is that the edit is not protected in the meantime. Note also a stale comment: providers/build.ts:44 references src/state/modified.ts, which does not exist.
<!-- SECTION:DESCRIPTION:END -->

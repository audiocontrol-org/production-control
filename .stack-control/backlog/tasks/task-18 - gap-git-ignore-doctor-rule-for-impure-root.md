---
id: TASK-18
title: gap/git-ignore-doctor-rule-for-impure-root
status: To Do
assignee: []
created_date: '2026-07-26 13:18'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/003-content-zone-segregation/audit-log.md AUDIT-20260726-02
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The feature's central guarantee is that impure bytes are recoverable because .ai/ is COMMITTED. Feature 003 now gates the IN-REPO property (tests/integration/ai-zone-tracked.test.ts asserts git check-ignore --no-index leaves .ai unignored and dist ignored). NOT covered: the adopter-environment risk that .ai is a common entry in a global gitignore (core.excludesFile / ~/.config/git/ignore alongside .aider .cursor .claude), which silently converts the durable-record guarantee into data loss on a clean checkout, invisible to git add. Also: dot-directories are skipped by default by glob/fast-glob without dot:true, npm pack, Jekyll/Pages, rsync filters. Follow-on: a doctor or pc audit-zones rule that runs git check-ignore across global and core.excludesFile sources for impureOutputRoot() and refuses loudly when the impure root is ignored (and asserts the pure root IS). Invariant: impure root must be trackable; the in-repo case is gated, the cross-source case is the follow-on.
<!-- SECTION:DESCRIPTION:END -->

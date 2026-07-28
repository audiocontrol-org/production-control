---
id: TASK-45
title: check-source-citation-allowlist-throws
status: To Do
assignee: []
created_date: '2026-07-28 03:56'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260728-33
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
checkSourceCitationAllowlist calls parseCitationAllowlist unguarded, so malformed source frontmatter (bad YAML, scalar citation_allowlist/sources, non-string or object-shaped sources entry) THROWS instead of returning a named refusal. Wrap in try/catch -> {ok:false,failure}.
<!-- SECTION:DESCRIPTION:END -->

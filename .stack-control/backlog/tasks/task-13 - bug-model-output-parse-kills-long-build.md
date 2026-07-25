---
id: TASK-13
title: bug/model-output-parse-kills-long-build
status: To Do
assignee: []
created_date: '2026-07-25 05:42'
updated_date: '2026-07-25 05:42'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-corpus finding, highest-value of the session. pc build quote-bank over 123 sources ran 58 sources successfully (~35 minutes of model calls) and then FAILED, discarding all of it, because source 59's model response was malformed JSON. Root cause: the miner asks the model to hand-write a JSON array in prose, and on French text dense with guillemets and typographic quotes the model emitted a text value it never closed - '... espoir plus que jamais », "corrections": []}' - missing the closing quote before the comma, so JSON.parse threw at position 1516 and src/claude.mjs threw immediately with no retry. THREE separable fixes: (1) STRUCTURED OUTPUT - the claude CLI supports --json-schema <inline schema> with --output-format json and returns a guaranteed schema-valid structured_output field. Using it eliminates this entire failure class at the source rather than parsing prose and hoping. Verified working by hand. (2) RETRY - the model is stochastic, so an unparseable or failed response should be retried a bounded number of times before failing loud; today a single transient hiccup is fatal. (3) RESUMABILITY - even with 1 and 2, an atomic all-or-nothing multi-hour build means any failure discards every completed source. Consider caching per-source model responses keyed by source content hash so a re-run resumes instead of restarting. Note (3) is the one that actually made this expensive; (1) and (2) reduce how often it triggers.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

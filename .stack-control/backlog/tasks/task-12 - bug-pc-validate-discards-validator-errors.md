---
id: TASK-12
title: bug/pc-validate-discards-validator-errors
status: To Do
assignee: []
created_date: '2026-07-25 05:20'
updated_date: '2026-07-25 05:20'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-corpus finding, same family as TASK-11. pc validate renders only the verdict word (passed/failed) and DISCARDS ValidateResponse.errors, which the contract defines as the list naming every violation by quote id. Observed live: pc validate quote-bank on the real corpus printed 'quote-bank  failed' and exit 1 with no indication of WHY. The entire value of an independent deterministic validator is that it names each defect - quote-validator.md specifies errors like "quote 'q-076-3' (source PB-P076): span 1 raw is not a substring of the source" - and the operator cannot see any of it through the real interface. They must re-run the validator by hand with a hand-built ValidateRequest to learn what failed. This is adjacent to a false-clean: a failed verdict with no reasons is nearly as unactionable as no verdict. Fix: render the recorded errors (and the non-blocking advisories) in pc validate's human output, and include them in the --json output. Note TASK-11 (tee provider stderr) does NOT cover this: errors arrive on the validator's STDOUT as structured ValidateResponse data that pc parses and then drops, not on stderr.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

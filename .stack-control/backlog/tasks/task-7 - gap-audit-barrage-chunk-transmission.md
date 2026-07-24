---
id: TASK-7
title: gap/audit-barrage-chunk-transmission
status: To Do
assignee: []
created_date: '2026-07-24 04:46'
updated_date: '2026-07-24 04:46'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The stack-control audit-barrage TOOL (not this repo's code) has findings surfaced during the 002-quote-bank govern. Most important: the chunk renderer advertised 48 files in scope but transmitted diff bodies for only 4 (AUDIT-03/05) — so the quote-bank fixture corpus (test/fixtures/banks/*.yaml + expected.json + sources) was audited by NOBODY in its chunk, and a 0-HIGH verdict could be priced over untransmitted content. Also: liveness_window is a fixed constant while timeout scales per-KB, so the watchdog tightens as payloads grow, re-creating the false-kill class (AUDIT-04). These belong upstream in stack-control (the deskwork plugin), not production-control. See specs/002-quote-bank/audit-log.md AUDIT-20260724-03,04,05. Raise upstream.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

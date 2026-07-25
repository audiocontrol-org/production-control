---
id: TASK-11
title: bug/provider-stderr-discarded-on-success
status: To Do
assignee: []
created_date: '2026-07-25 04:58'
updated_date: '2026-07-25 04:58'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-corpus finding via pc build on a 123-source quote-bank. src/providers/run.ts (~91-106, 142-159) captures the provider subprocess's stderr into a Buffer and surfaces it ONLY on failure (formatStderr is called just in the non-zero-exit / signal-death paths). On a successful build the stderr is discarded. Two consequences, both observed live: (1) LONG BUILDS ARE SILENT - the quote-miner streams per-source progress lines to stderr specifically so a multi-hour corpus build is observable, and pc shows the operator absolutely nothing until the whole build ends. (2) THE MINING REPORT IS LOST - quote-miner.md FR-017 requires a machine-readable mining report (selected/grounded/omitted/corrections) on stderr, and its own contract says 'a bank may pass fidelity while the report reveals weak selection; the two are separate'. Because pc drops stderr on success, the operator can never see it through the real interface; it is only visible when running the provider by hand. Suggested fix: TEE rather than buffer - forward each stderr chunk to pc's own stderr as it arrives AND keep accumulating it for the failure message. That preserves the verbatim-on-failure behavior, keeps pc's stdout clean/parseable (diagnostics go to diagnostics), and makes long builds observable. Consider whether it should be unconditional or behind a verbosity flag.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

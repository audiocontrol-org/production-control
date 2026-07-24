---
id: TASK-6
title: gap/pc-core-hardening-audit-backlog
status: To Do
assignee: []
created_date: '2026-07-24 04:46'
updated_date: '2026-07-24 04:46'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 002-quote-bank whole-branch govern (audited main...002-quote-bank) surfaced ~36 HIGH findings in production-control CORE that PREDATE quote-bank — they belong to the earlier episode/asset work that was never merged to main, so the whole-branch diff re-surfaced them. NOT a quote-bank regression (quote-bank touches only editorial-tooling/, specs/, and test/eslint config). Representative: symlink-following stat in outputs reconciliation (AUDIT-01/47), non-strict zod schemas silently dropping impure/validator keys (AUDIT-07/45), unsynchronized ledger read-modify-write losing records (AUDIT-44), fs.rm recursive without containment (AUDIT-35), pc validate recording a verdict without reading the artifact on disk (AUDIT-24), unconstrained IdentitySchema interpolated into an rm -rf path (AUDIT-42), release-gate gaps (AUDIT-28/29/36), build rename stranding the ledger (AUDIT-43), and many test-quality gaps. Full detail: specs/002-quote-bank/audit-log.md finding IDs AUDIT-20260724-01,02,06,07,10,11,12,13,15,16,18,22,23,24,25,26,27,28,29,30,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49. Dispositioned OUT OF SCOPE for quote-bank v1 via govern --override; this is the tracked follow-up to triage and fix them as production-control core hardening.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** design:feature/quote-bank
<!-- SECTION:NOTES:END -->

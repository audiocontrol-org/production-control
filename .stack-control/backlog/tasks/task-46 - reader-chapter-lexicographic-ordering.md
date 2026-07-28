---
id: TASK-46
title: reader-chapter-lexicographic-ordering
status: Done
assignee: []
created_date: '2026-07-28 03:56'
updated_date: '2026-07-28 06:15'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - AUDIT-20260728-29
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
voice reader orders chapters lexicographically by dir slug, so numbered chapters read out of order. Sort by a chapter order key (frontmatter order / numeric prefix). [future 006 reader]
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: Fixed in 4e071ac: subject-agnostic chapterOrderKey + unit test; verified on the full ebook reader (prologue->ch01..ch06->epilogue).
<!-- SECTION:NOTES:END -->

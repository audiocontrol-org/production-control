# Tooling Feedback


## session-end 2026-07-26
- The Skill tool did not inline the SKILL.md bodies for /stack-control:define and /stack-control:execute (it returned only 'Launching skill: ...' plus a re-invocation notice); I had to read each SKILL.md manually from the plugin cache to follow the procedure. Upstream stack-control/plugin behavior worth a deskwork GitHub issue.
- check-prerequisites.sh / setup-plan branch validation rejects the long-lived branch name (feature/voice) with 'Not on a feature branch' (TF-09). Known; the CLAUDE.md SPECKIT marker + feature.json resolve the active spec, but the RED exit during /speckit-analyze is noise the operator must know to ignore.

## session-end 2026-07-26
- govern empty-diff chunk dispatch: a chunk with a declared file but zero-hunk diff body was counted as a participating audit lane (AUDIT-09/12, recurred every round on tests/integration/zoning.test.ts). Filed upstream: audiocontrol-org/deskwork#532; local TASK-17.
- govern is long (10-40 min); the background --status poll loop was externally killed ~3x mid-run and had to be manually restarted. A resumable/notify-on-complete poll would help.

## session-end 2026-07-27
- audit-barrage repeatedly emits false-positive 'fixtures/editions not committed' findings (AUDIT-20260726-01/-15, -20260727-04/-20) because lane agents see only the chunked diff and cannot run git to verify tracking; wasted review effort across two govern rounds. Consider surfacing tracked-file state in chunk metadata, or letting a lane verify git ls-files.

## session-end 2026-07-29
- Git-backed backlog sequential ids are not branch-aware: authoring feature/voice off main (which lacked the spike branch's TASK-51) meant 'stackctl backlog capture' reused id 51 for a different item, colliding cross-branch with spike's TASK-51 (formalize-voice-compose-from-spine). Navigable but a real gotcha -- divergent branches both assign the same next id with no coordination. Consider branch-aware id allocation or a collision warning on capture.

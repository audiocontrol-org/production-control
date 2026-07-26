# Tooling Feedback


## session-end 2026-07-26
- The Skill tool did not inline the SKILL.md bodies for /stack-control:define and /stack-control:execute (it returned only 'Launching skill: ...' plus a re-invocation notice); I had to read each SKILL.md manually from the plugin cache to follow the procedure. Upstream stack-control/plugin behavior worth a deskwork GitHub issue.
- check-prerequisites.sh / setup-plan branch validation rejects the long-lived branch name (feature/voice) with 'Not on a feature branch' (TF-09). Known; the CLAUDE.md SPECKIT marker + feature.json resolve the active spec, but the RED exit during /speckit-analyze is noise the operator must know to ignore.

## session-end 2026-07-26
- govern empty-diff chunk dispatch: a chunk with a declared file but zero-hunk diff body was counted as a participating audit lane (AUDIT-09/12, recurred every round on tests/integration/zoning.test.ts). Filed upstream: audiocontrol-org/deskwork#532; local TASK-17.
- govern is long (10-40 min); the background --status poll loop was externally killed ~3x mid-run and had to be manually restarted. A resumable/notify-on-complete poll would help.

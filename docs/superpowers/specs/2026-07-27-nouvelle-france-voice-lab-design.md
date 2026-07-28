Nouvelle-France Voice Lab — design (lab spike)

Status: approved 2026-07-27. This is an exploratory LAB SPIKE, not a governed feature ship.
If the enabling tooling changes prove out, the producer-prompt work is formalized separately
via the governed flow (promote backlog TASK-29).

Goal

Author a starting catalog of reusable narration voices for the Nouvelle-France ebook and try
four of them on one source-locked passage through the real voice-editions pipeline
(voice revise -> voice fidelity), so we can compare re-voiced editions and see the fidelity
gate judge them on real, citation-heavy prose.

Part 1 — The voice catalog (content, in nouvelle-france)

Author eight schema-valid voice documents under nouvelle-france/content/voices/<slug>.yaml,
each transcribing an operator-authored trait profile (never a named-author impersonation,
per FR-004/D17). The eight: archival-restraint, investigative-momentum, intimate-witness,
forensic-clarity, narrative-current, dry-institutional-irony, reflective-historical-essay,
oral-documentary. Fields map 1:1 to the schema: narrator_distance, evidence_posture,
sentence_movement, paragraph_movement, transitions, emotional_temperature, quote_handling,
avoid (plus purpose carrying the "best for"/"effect" intent). The initial lab runs four:
archival-restraint, investigative-momentum, intimate-witness, dry-institutional-irony.

Part 2 — Enabling tooling (voice-tooling, on a spike branch, with tests)

Two changes, without which the lab cannot run for real:
- Producer model prompt (backlog TASK-29): revise/model.ts constructs the model instruction —
  source text + the voice's directives + the fidelity contract (exactly one disposition per
  source unit; preserve every quoted span, citation marker, and numeral verbatim; emit the
  ledger: frontmatter). Makes voice revise work with real `claude -p`, not only the stub.
  The prompt is a reviewable artifact pinned by a test.
- Citation extraction for [PB-###] markers: extend payload/extract.ts to recognize the ebook's
  bracketed source markers (e.g. [PB-P056]) in addition to footnote [^1] markers, and treat the
  source chapter's frontmatter `sources:` list as the citation allow-list. Otherwise citation
  fidelity is silently a no-op on this corpus. FR-020 permits evolving the citation
  representation, so this is in-bounds.

Part 3 — The lab run

Source-locked passage: epilogue.md "What Had Been Sold to Them" section (blockquote-, citation-,
and numeral-dense — a strict fidelity test). For each of the four lab voices, run voice revise
(real claude) -> an impure edition in an .ai/-zoned lab dir -> voice fidelity -> coverage report.
Present the four re-voiced passages side by side with their verdicts. Some editions are EXPECTED
to fail fidelity (a model drops a citation or mis-writes the ledger); that is the lab working,
not a defect. Run by hand (voice revise / voice fidelity bins directly), not yet a wired pc build
target — fastest path to first results; a proper pc target follows if the lab is compelling.

Out of scope for the spike: governance ship of the producer-prompt change; wiring a pc build
target in nouvelle-france; the rest of the voice-editions backlog.

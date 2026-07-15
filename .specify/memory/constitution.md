<!--
Sync Impact Report
==================
Version change: (uninitialized template) → 1.0.0
Rationale: Initial ratification. MINOR/PATCH inapplicable; first concrete constitution.

Source of truth: MANIFESTO.md. This constitution RESTATES the manifesto's principles as
testable gates for the Spec Kit chain. It does not invent governance of its own. Where the
two ever disagree, MANIFESTO.md wins and this file is the thing that must change.

Principles defined (7; template shipped 5 slots — expanded, all seven are load-bearing gates):
  I.   Human-Authored Narrative        ← manifesto "Human creativity is the source of truth"
  II.  Deterministic Production        ← manifesto "Deterministic production"
  III. Explicit Provenance             ← manifesto "Explicit provenance" + "Agent-driven, human-governed"
  IV.  Crafts Remain Specialized       ← manifesto "Crafts remain specialized" + "Composable tools"
  V.   Fail Loud, Never False-Clean    ← manifesto "Fail loud; never report false-clean"
  VI.  The Oracle Is Authoritative     ← design record invariant; manifesto "Stable contracts"
  VII. Subject-Agnostic                ← manifesto "Subject-agnostic"

Added sections:
  - Technology and Architecture Constraints (SECTION_2)
  - Development Workflow and Quality Gates (SECTION_3)

Templates requiring updates:
  ✅ .specify/templates/plan-template.md   — Constitution Check gate reads this file by reference; no edit needed
  ✅ .specify/templates/spec-template.md   — no constitution-driven mandatory sections added
  ✅ .specify/templates/tasks-template.md  — no new principle-driven task categories
  ✅ CLAUDE.md                             — named as GUIDANCE_FILE below

Deferred TODOs: none.
-->

# production-control Constitution

This constitution restates [MANIFESTO.md](../../MANIFESTO.md) as gates the Spec Kit chain can
check. The manifesto is the source of truth and the better place to understand *why*; this file
exists so a plan can be tested against those principles rather than merely admire them.

## Core Principles

### I. Human-Authored Narrative (NON-NEGOTIABLE)

production-control MUST NOT write, edit, improve, or restructure creative work. It MUST NOT
generate prose, scripts, narrative structure, or editorial judgment, and MUST NOT acquire the
capability later.

The system answers what exists, what is stale, what is missing, what needs review, and what
blocks release. It never answers what should happen next in the story.

*Gate*: any feature that would have the system produce or alter authored content fails this
check outright. This is the design, not a limitation to be relaxed.

### II. Deterministic Production

The same inputs MUST yield the same outputs wherever practical. Freshness MUST be computed from
content hashes, never from timestamps — timestamps lie, especially after a clone.

Where a provider cannot be deterministic (a model call, a network fetch), it MUST declare itself
impure. The ledger then records the output hash actually produced, so everything downstream stays
deterministic even when the producer is not.

*Gate*: a plan that reads mtime for freshness, or that assumes purity without declaring it, fails.

### III. Explicit Provenance

Every derived artifact MUST record its inputs (by content hash), its producing tool, and that
tool's version. Provenance is not metadata about the product; provenance IS the product.

Building an artifact and recording where it came from MUST be one indivisible act. An agent
drives this system, and any step that CAN be skipped eventually will be. A ledger that is wrong
is worse than no ledger.

*Gate*: a plan that lets a build succeed without recording provenance — or that records it in a
separate, skippable step — fails.

### IV. Crafts Remain Specialized

production-control is not where media expertise accumulates. Editorial remains editorial; audio
remains audio; video remains video; publishing remains publishing.

Craft tools MUST remain independently useful outside production-control. Providers receive local
input paths and emit local output files; they MUST NOT hold credentials or touch object storage.

*Gate*: if a production concern can be solved by improving a specialized tool rather than
expanding the orchestration layer, the specialized tool MUST change instead. A plan that teaches
the orchestrator a craft fails, regardless of what it buys.

### V. Fail Loud, Never False-Clean

Missing tools, unresolvable assets, and unimplemented paths MUST raise errors naming what is
absent. There MUST be no fallbacks, no mock data outside test code, and no silent skips.

A skipped step that reports success is worse than a failure: a failure gets fixed, a false green
gets shipped. Where the machine cannot decide, it MUST surface the question and stop rather than
guess.

*Gate*: a plan containing a fallback path, a default that masks absence, or a target that can be
silently skipped fails.

### VI. The Oracle Is Authoritative; Providers Are Disposable

The artifact graph, contracts, manifests, and ledger MUST stay valid when any tool around them is
replaced — the EPUB tool, the audio tooling, videocontrol, the static-site generator, even the
execution layer.

*Gate*: a plan that makes the graph depend on a particular provider's behavior fails. So does one
that teaches the oracle a craft in order to keep a provider simple. The center of gravity stays
put while the tools evolve.

### VII. Subject-Agnostic

The first subject is not the domain. Contracts, schemas, profiles, and code MUST NOT encode
anything about any particular story, publication, or research archive.

Authored content MUST NOT live in this repository. `examples/` holds fixtures only. Reuse across
subjects lives in profiles; subject specifics live in content repos that depend on this package.

*Gate*: a plan that names a subject anywhere outside a fixture fails.

## Technology and Architecture Constraints

- **TypeScript**, distributed as an installable package. Content repos depend on it the way a
  site depends on a build tool.
- **Imports use the `@/` pattern.**
- **Composition over inheritance.** Interface-first design across boundaries; constructor
  dependency injection with interface types. Avoid class inheritance.
- **Never bypass typing**: no `any`, no `as Type` escapes, no `@ts-ignore`.
- **Files stay under 500 lines.** A file that outgrows this is doing too much and MUST be
  decomposed.
- **Object storage speaks the S3 API.** The backend (B2, R2, S3, MinIO) is a configuration value,
  never an architectural commitment. The private working store is content-addressed: the key IS
  the hash.
- **Providers are subprocesses speaking JSON over stdio**, never in-process plugins. A plugin API
  would force every craft tool to become a Node module and would violate Principle IV.
- **The agent is the primary caller.** Read verbs MUST offer `--json` and MUST exit 0; gates exit
  non-zero. Every reported state MUST name its cause — a state without a cause makes an agent
  guess.

## Development Workflow and Quality Gates

- **stack-control governs this repository.** Work is a roadmap DAG of items. The chain is: design
  record → `/stack-control:define` (spec) → `/stack-control:execute` (implementation).
- **Design precedes spec.** An item MUST carry `design-approved` before its spec is authored.
- **Test-driven.** Tests are written before implementation. The graph and freshness logic MUST be
  testable in-memory, with no bucket and no craft tools installed — a fake provider emitting
  deterministic bytes is the standard harness.
- **No git hooks, ever.** Enforcement lives in skills, CLI verbs, code review, and CI — never in
  a local, machine-inconsistent, review-invisible side-channel.
- **Commit and push early and often.** Uncommitted work is the dangerous state. Branch first when
  on the default branch.

## Governance

This constitution derives its authority from [MANIFESTO.md](../../MANIFESTO.md) and supersedes
other practices for the Spec Kit chain. Where constitution and manifesto conflict, the manifesto
wins and this file MUST be amended to match — never the reverse.

**Amendment procedure**: amend the manifesto first when the change is philosophical; amend this
file alone only when the change is a matter of how a principle is checked. Every amendment
records a version bump, a rationale, and a Sync Impact Report at the head of this file.

**Versioning policy**: MAJOR for a principle removed or redefined incompatibly; MINOR for a
principle added or materially expanded; PATCH for clarification and wording.

**Compliance review**: every plan MUST pass the Constitution Check against these principles.
Complexity MUST be justified against them rather than assumed. Use `CLAUDE.md` for runtime
development guidance.

**Version**: 1.0.0 | **Ratified**: 2026-07-15 | **Last Amended**: 2026-07-15

# Feature Specification: Episode Production Contract v0.1

**Feature Branch**: `001-episode-production-contract`

**Created**: 2026-07-15

**Status**: Draft

**Design record**: `docs/superpowers/specs/2026-07-14-episode-production-contract-design.md`

**Roadmap item**: `design:feature/episode-production-contract`

**Input**: User description: "Episode Production Contract v0.1 — the orchestration core of production-control: an agent-driven oracle that answers what is true about a multimedia production, plus a deliberately dumb execution layer that builds artifacts and records provenance as one indivisible act."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know the true state of a production (Priority: P1)

An agent is driving the production of a publication. Some inputs are authored, some
outputs are built, and the author has been editing. The agent asks the system what is
true right now and receives, for every part of the production: what exists, what is
missing, what is stale and *why* it is stale, what has been validated, what needs a
human decision, and whether the production can be released.

The agent never has to infer any of this from file timestamps, directory listings, or
guesswork.

**Why this priority**: This is the feature's reason for being and the vision's stated
primary interface. It is the part no general-purpose tool provides, because none of
them know what a production is. It delivers value against a production that is only
half-authored and has never been built even once — nothing else needs to exist first.

**Independent Test**: Point the system at a fixture production whose inputs are partly
present and partly absent. Confirm it reports each part's state and the cause of that
state, with no craft tools installed and no network reachable.

**Acceptance Scenarios**:

1. **Given** a production with a declared input that does not exist, **When** the agent
   asks for state, **Then** the dependent outputs report blocked, naming the absent
   input.
2. **Given** a production where every declared input exists but nothing has been built,
   **When** the agent asks for state, **Then** every target reports missing.
3. **Given** a production where an output was built and no input has changed since,
   **When** the agent asks for state, **Then** that output reports fresh.
4. **Given** a production where an authored input's content changed after an output was
   built, **When** the agent asks for state, **Then** that output reports stale and
   names the input that changed.
5. **Given** the same production cloned fresh with no build outputs present, **When** the
   agent asks for state, **Then** it reports the identical staleness answer as the
   original working copy, without rebuilding anything.
6. **Given** any reported state, **When** the agent reads it, **Then** that state carries
   a cause.

---

### User Story 2 - Build an output and have its origin recorded inseparably (Priority: P2)

The agent builds one of the production's outputs. The system hands the work to the
specialized tool responsible for that craft, and when the tool succeeds the system
records what was built, what it was built from, and which tool version built it — as
part of the same action, not as a follow-up step the agent could skip.

**Why this priority**: Without this, the state reported by User Story 1 is a claim
nobody checked. An agent drives this system, and any step that can be skipped
eventually is; a record that is wrong is worse than no record.

**Independent Test**: Build one target using a stand-in craft tool that emits known
bytes. Confirm the output exists, its origin record names the exact inputs used, and
that no sequence of calls produces an output without a matching record.

**Acceptance Scenarios**:

1. **Given** a target whose inputs are all present, **When** the agent builds it,
   **Then** the output is produced and its origin record names each input, the
   producing tool, and that tool's version.
2. **Given** a build that fails, **When** the agent builds it, **Then** the command
   reports failure and no origin record is written claiming success.
3. **Given** an output built from another output, **When** the upstream output is
   rebuilt with different content, **Then** the downstream output reports stale.
4. **Given** a target whose producing tool is not available, **When** the agent builds
   it, **Then** the system fails and names the missing tool, and does not skip the
   target or substitute a default.
5. **Given** a successful build, **When** the agent inspects the record, **Then** the
   record is durable across a fresh clone without the built bytes being present.

---

### User Story 3 - Surface drift between authored work and a human-made recording of it (Priority: P3)

An author records a performance of a script. Later, the author revises the script. The
recording cannot be rebuilt — a human made it — but it no longer matches the words it
came from. The system surfaces this as something a human must decide, rather than
reporting that everything is fine. The human either replaces the recording or waives
the concern with a reason, and the waiver is recorded.

**Why this priority**: This is the failure the system exists to catch. Without it,
"releasable" quietly means "the machine-checkable parts are fine" while the voice and
the words have silently diverged.

**Independent Test**: Declare a human-authored artifact that tracks another authored
input. Change the tracked input. Confirm the artifact reports needs-review rather than
stale or fresh, that it never triggers a rebuild, and that waiving it with a reason
clears it durably.

**Acceptance Scenarios**:

1. **Given** an authored artifact declared to track another input, **When** the tracked
   input's content changes, **Then** the artifact reports needs-review and names what
   changed.
2. **Given** an artifact reporting needs-review, **When** the agent builds the
   production, **Then** the system does not attempt to rebuild that artifact.
3. **Given** an artifact reporting needs-review, **When** a human waives it with a
   reason, **Then** it stops reporting needs-review and the reason is recorded.
4. **Given** a waived artifact, **When** the tracked input changes *again*, **Then** it
   reports needs-review once more.
5. **Given** an outstanding, unwaived needs-review, **When** the agent asks whether the
   production can be released, **Then** the answer is no, naming the artifact.

---

### User Story 4 - Work with large assets without putting them in version control (Priority: P4)

The production includes assets too large to commit — recorded audio, raw video,
expensive renders. The author adds them to the production; the system stores the bytes
externally and keeps a small, readable stand-in under version control. Asking for state
remains fast and works offline.

**Why this priority**: Without it, either the repository becomes unusable or the large
inputs cannot participate in the production graph at all. It is behind the first three
because the graph's correctness does not depend on where bytes live.

**Independent Test**: Add a large asset, confirm a small stand-in is what gets committed,
confirm state can be reported with the external store unreachable, and confirm that
adding identical bytes twice does not store them twice.

**Acceptance Scenarios**:

1. **Given** a large file, **When** the author adds it as an asset, **Then** the bytes
   are stored externally and a small stand-in is what appears in version control.
2. **Given** a production whose assets are stored externally, **When** the agent asks
   for state, **Then** it answers without contacting the external store.
3. **Given** an asset already stored, **When** identical bytes are added again, **Then**
   no duplicate is stored.
4. **Given** a re-recorded asset with different bytes, **When** it is added, **Then** it
   is stored as a distinct asset and the prior one remains retrievable.
5. **Given** an authored input pointing at large raw bytes with no stand-in beside it,
   **When** the agent asks for state, **Then** the system fails loud rather than
   committing the bytes or ignoring them.
6. **Given** a build needing an external asset, **When** the build runs, **Then** the
   system provides the bytes locally to the craft tool, which never contacts the store
   itself.

---

### User Story 5 - Replace a craft tool without invalidating the production (Priority: P5)

A craft tool is swapped for a different one that produces the same kind of output. The
production's structure, its records, and its history remain valid and meaningful.

**Why this priority**: This is the architecture's central invariant, and it is what
keeps the system from becoming a monolith. It is last because it is proven by the
others rather than built separately.

**Independent Test**: Point a target at a different producing tool. Confirm the
production's structure and prior records remain readable and valid, and that the change
is reported rather than silently ignored.

**Acceptance Scenarios**:

1. **Given** a target bound to one producing tool, **When** it is bound to a different
   tool, **Then** the production's structure and existing records remain valid.
2. **Given** a producing tool whose version changed since an output was built, **When**
   the agent asks for state, **Then** the version change is reported and does not by
   itself mark the output stale.
3. **Given** any producing tool, **When** it is run outside the system by hand with the
   same local inputs, **Then** it produces its outputs without the system present.

---

### Edge Cases

- **A declared input is absent.** Dependent outputs report blocked and name it. The
  system does not treat absence as an empty input.
- **An input changes while a build is running.** The record names the input content the
  build actually consumed, not what is on disk afterward.
- **A production declares a target its recipe does not know how to produce.** The
  system fails loud naming the unknown target rather than skipping it.
- **A recipe declares a cycle** (a target that transitively depends on itself). The
  system refuses the production and names the cycle.
- **Two authored inputs declare the same identity.** The system refuses rather than
  choosing one.
- **An authored input tracks an identity that does not exist.** The system refuses and
  names the dangling reference.
- **A producing tool succeeds but emits nothing**, or emits something it did not
  declare. The system treats this as failure rather than recording an empty success.
- **A producing tool cannot be deterministic** (it calls a model, or fetches over the
  network). It must declare itself as such; an undeclared one turns reproducibility
  into a claim nobody checked.
- **An output is a directory rather than a single file.** Its content is characterized as
  a whole; adding, removing, or changing any file within it changes its state.
- **The external asset store is unreachable.** Reporting state still works; only
  operations that genuinely need bytes fail, and they name why.
- **A stand-in references an asset absent from the store.** The system fails loud rather
  than reporting the input as present.

## Requirements *(mandatory)*

### Functional Requirements

**Declaring a production**

- **FR-001**: A production MUST declare its own identity, the recipe it follows, its
  authored inputs, and its intended outputs. The system MUST NOT assume any fixed set of
  inputs.
- **FR-002**: Every part of a production MUST be exactly one of: *authored* (no producer;
  a human made it) or *derived* (has a producer and named upstream inputs).
- **FR-003**: Each part MUST be named by a stable identity. Identity MUST survive
  rebuilds and MUST NOT change when the underlying file moves. Location MUST be an
  attribute of a part, not its identity.
- **FR-004**: Recipes MUST be reusable across unrelated productions and MUST NOT contain
  anything specific to any subject, story, or publication.
- **FR-005**: The system MUST refuse a production that declares a dependency cycle, a
  duplicate identity, an unknown target, or a reference to an identity that does not
  exist — naming the offending declaration in each case.

**Knowing what is true**

- **FR-006**: The system MUST report, for every part, exactly one state: fresh, stale,
  missing, blocked, invalid, or needs-review.
- **FR-007**: Every reported state MUST carry its cause. A state without a cause is not
  a valid report.
- **FR-008**: Staleness MUST be determined by comparing the *content* of declared inputs
  against the content recorded when the output was built. The system MUST NOT use
  modification times, and its answers MUST be identical in a fresh clone.
- **FR-009**: Staleness MUST propagate transitively: if an output's input is itself an
  output whose content changed, the downstream output MUST report stale.
- **FR-010**: Reporting state MUST NOT require network access, MUST NOT require any
  craft tool to be installed, and MUST NOT modify the production.
- **FR-011**: The system MUST report the actionable frontier — the set of parts a human
  or agent could act on now — as a distinct query from full state.
- **FR-012**: The system MUST answer whether the production can be released. It MUST
  answer yes only when every target is fresh, every validation has passed, and no
  outstanding review remains unwaived. When the answer is no, it MUST name what blocks.

**Recording origin**

- **FR-013**: For every derived output the system MUST record: the content of each input
  it was built from, the producing tool, that tool's version, when it was built, its
  output location and content, and its validation state.
- **FR-014**: Building an output and recording its origin MUST be a single indivisible
  action. The system MUST NOT offer a path that produces an output without a
  corresponding record.
- **FR-015**: Origin records MUST be durable in version control and MUST remain
  meaningful when the built bytes are absent.
- **FR-016**: The system MUST report when a producing tool's version has changed since an
  output was built, and MUST NOT treat that alone as making the output stale.
- **FR-017**: A failed build MUST NOT produce a record claiming success.

**Human-made artifacts and review**

- **FR-018**: An authored part MUST be able to declare that it tracks another part.
- **FR-019**: A tracking declaration MUST NEVER cause a rebuild and MUST NEVER block on
  its own.
- **FR-020**: When a tracked part's content changes, the tracking part MUST report
  needs-review, naming what changed.
- **FR-021**: A human MUST be able to waive a needs-review with a recorded reason. The
  waiver MUST be durable and MUST NOT be re-litigated on every run.
- **FR-022**: A waiver MUST apply only to the change it was recorded against; a
  subsequent change to the tracked part MUST raise needs-review again.

**Large assets**

- **FR-023**: The system MUST store large assets outside version control while keeping a
  small, human-readable stand-in under version control.
- **FR-024**: An asset MUST be identified by its own content, so that identical bytes are
  never stored twice and altered bytes are always a distinct asset.
- **FR-025**: The system MUST NOT require contacting the asset store in order to report
  state.
- **FR-026**: The system MUST fail loud when an authored part references large raw bytes
  with no stand-in, rather than committing the bytes or ignoring the part.
- **FR-027**: The asset store MUST be replaceable by configuration, without code change.
- **FR-028**: Assets MUST be immutable once stored; a revision MUST be a new asset rather
  than an overwrite.

**Delegating craft work**

- **FR-029**: The system MUST delegate all media production to specialized tools and MUST
  NOT implement media processing itself.
- **FR-030**: The system MUST resolve every input to a local location before invoking a
  producing tool. Producing tools MUST NOT contact the asset store and MUST NOT hold
  credentials for it.
- **FR-031**: A producing tool MUST remain runnable by hand, outside the system, with
  local inputs and no system present.
- **FR-032**: A producing tool that cannot produce identical output from identical input
  MUST declare itself as such. The system MUST record the output content actually
  produced, so that everything downstream remains reproducible regardless.
- **FR-033**: The system MUST treat a producing tool as failed when it exits with an
  error, produces nothing, or produces something it did not declare.
- **FR-034**: The production's structure and records MUST remain valid when any producing
  tool is replaced.

**Interface and failure**

- **FR-035**: Every read operation MUST offer machine-readable output and MUST succeed
  even when it reports problems. Operations that gate MUST fail distinguishably.
- **FR-036**: The system MUST fail loud and name what is absent when a tool, an asset, or
  a declared path cannot be resolved. It MUST NOT provide fallbacks, substitute
  defaults, or silently skip a target.
- **FR-037**: The system MUST NOT generate, edit, or alter authored creative content
  under any circumstance.

### Key Entities

- **Production**: A unit of publishable work. Declares its identity, its recipe, its
  authored inputs, and its intended outputs.
- **Part**: A named element of a production, identified by a stable identity. Either
  authored or derived. Has exactly one state at any moment.
- **Identity**: The stable name of a role in a production. Survives rebuilds and
  relocation; the thing edges are drawn between.
- **Recipe**: A generic, reusable description of which outputs are produced from which
  inputs, by which producing tool. Contains nothing subject-specific.
- **Origin record**: The durable statement of what a derived output was built from, by
  what, when, and whether it validated. The canonical record of production state.
- **Tracking declaration**: An advisory relationship from an authored part to another
  part. Detects drift; never rebuilds.
- **Waiver**: A recorded human decision that a specific drift is acceptable.
- **Asset**: Large content stored outside version control, identified by its own content,
  represented in the repository by a stand-in.
- **Producing tool**: An external, independently useful program that turns local inputs
  into local outputs and reports what it produced.
- **Validation report**: A statement about whether a produced output meets its
  requirements.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can determine the complete state of a production — every part, its
  state, and the cause of that state — with no network access and no craft tools
  installed.
- **SC-002**: Every derived output in a built production can be traced to the exact
  authored inputs it came from and the tool that made it, reading only what is in version
  control.
- **SC-003**: Changing any authored input causes every affected output, at any depth, to
  report stale — with no propagation rules written by hand.
- **SC-004**: A freshly cloned production reports the identical state as the original
  working copy, without rebuilding anything and regardless of file timestamps.
- **SC-005**: A production reports releasable only when every target is fresh, every
  validation passed, and no unwaived review remains. Every negative answer names what
  blocks it.
- **SC-006**: Revising a script after its performance was recorded causes the recording to
  require human review, and the production is not releasable until a human decides.
- **SC-007**: The complete state and staleness behavior is exercisable in tests with no
  craft tools installed and no asset store reachable.
- **SC-008**: Every producing tool used by the system can be run by hand, outside the
  system, with no credentials.
- **SC-009**: No sequence of operations produces a derived output without a corresponding
  origin record.
- **SC-010**: Changing the asset store backend requires only configuration.
- **SC-011**: No part of the system, its recipes, or its schemas contains anything
  specific to any subject, story, or publication.

## Assumptions

- **Authored content never lives in this repository.** Each subject keeps its own content
  repository which depends on this system. Any production directory in this repository is
  a test fixture.
- **Validation is binary for this version.** A validation either passes or fails; there is
  no severity gradation and no non-blocking warning. Severity is deferred.
- **A production is a single directory.** Cross-production dependencies are not modeled.
- **One recipe per production.** A production names exactly one recipe; composing recipes
  is not modeled.
- **The initial outputs are editorial and audio** — a website, an ebook, a voice-over, and
  a podcast. This exercises two genuinely different crafts without depending on the
  maturity of the video tooling.
- **Building is single-target and sequential.** Scheduling, parallelism, caching, and
  remote execution are not part of this version.
- **Producing tools are trusted.** The system does not enforce that a tool touches only
  its declared inputs; an undeclared input surfaces later as a build that will not
  reproduce.
- **Release readiness stops at "can this be released?"** Distribution — public locations,
  content delivery, rights gating, and feed generation — is a separate concern with its
  own decisions and is not part of this version.
- **A stand-in for an asset is committed alongside the production**, so the production
  directory stays readable and complete in version control.

## Out of Scope

These are deliberate, operator-decided boundaries recorded in the design record. They are
not oversights and should not be re-litigated during planning.

- **Video, vlog, and promotional clips.** These arrive against contracts proven by the
  audio craft first.
- **Publishing and distribution.** Public locations, content delivery, immutable citable
  addresses, rights gating, and feed generation are a separate concern.
- **Producing-tool sandboxing.** Not enforcing that tools touch only declared inputs.
- **PDF, print, and hardcover.** Additional outputs, not architecture.
- **Scheduling, caching, parallelism, remote execution.** The execution layer stays
  deliberately dumb.

## Dependencies

- **Craft tools are external and independently developed.** This system delegates to them
  and does not vendor them. For this version they can be stood in for by a test double
  that emits deterministic content.
- **An asset store reachable by a widely-implemented object-storage interface**, so the
  backend remains a configuration choice.

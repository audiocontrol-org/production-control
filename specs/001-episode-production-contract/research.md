# Phase 0 Research: Episode Production Contract v0.1

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

Most of the solution space was settled in the design record
(`docs/superpowers/specs/2026-07-14-episode-production-contract-design.md`), which is
operator-approved and authoritative for mechanism. This document resolves only what the
design left open, and records library choices against existing house precedent rather
than inventing them.

## R1: Library selections — follow house precedent

**Decision**: Adopt the choices already proven in the two sibling governed repos.

| Concern | Choice | Precedent |
|---|---|---|
| S3-compatible client | `@aws-sdk/client-s3` | colony-cults (same B2 target) |
| YAML | `yaml` | colony-cults |
| CLI framework | `commander` | video-control |
| Schema validation | `zod` | video-control |
| Test runner | `vitest` | colony-cults |
| TS execution | `tsx` | both (and the operator's standing rule) |

**Rationale**: Three governed repos in one ecosystem should not have three answers to the
same question. `@aws-sdk/client-s3` matters most — colony-cults already points it at
Cloudflare-fronted B2, which is our exact target, so the endpoint configuration pattern is
proven rather than theoretical.

**Alternatives considered**: `js-yaml` (video-control uses it, but colony-cults uses
`yaml`, which has the better API and preserves comments — relevant because operators
hand-write `episode.yaml`). Split precedent resolved toward `yaml`. `oclif`/`yargs` for
CLI rejected: `commander` is already in the house and is sufficient for a verb-and-flag
surface.

## R2: `zod` is load-bearing, not decoration

**Decision**: Every external document — `episode.yaml`, `profiles/*.yaml`,
`.production/ledger.yaml`, `*.asset` pointers, and every provider's JSON response — is
parsed through a `zod` schema at the boundary. Nothing downstream accepts unvalidated
shapes.

**Rationale**: The constitution forbids `any`, `as Type`, and `@ts-ignore` (Technology
constraints) and requires failing loud naming what is absent (Principle V). Hand-parsing
YAML into typed structures requires exactly the casts the constitution bans. `zod` gives
a parse that either produces a fully-typed value or throws naming the offending path —
the constitution's two requirements satisfied by one mechanism.

**Alternatives considered**: hand-written type guards (verbose, and the error messages
would be ours to get right); JSON Schema + ajv (another vocabulary to maintain when `zod`
already infers the TypeScript types).

## R3: Deterministic tree hash for directory outputs

**Decision**: A directory's content hash is computed as: walk all files recursively; for
each, take its POSIX-normalized path relative to the directory root and its sha256
content hash; sort the pairs by that path using byte ordering; hash the concatenation of
`<relative-path>` `NUL` `<content-hash>` `NUL` for each pair in order. Empty directories
are not represented. Symlinks are an error rather than followed.

**Rationale**: The spec requires identical answers across a fresh clone (FR-008, SC-004),
so the hash cannot depend on inode order, filesystem iteration order, or platform path
separators. Byte-ordering the normalized relative path fixes all three. The NUL delimiter
prevents an ambiguity where different path/hash splits could produce the same byte
stream.

Symlinks are an error rather than a silent follow-or-skip: either behavior would be a
fallback, which Principle V forbids, and a followed symlink can escape the directory
entirely.

**Alternatives considered**: reusing git's tree hashing (couples artifact identity to git's
object model and to file modes we do not care about); hashing a tar stream (tar embeds
mtimes and ordering, which is exactly what we are trying to exclude).

## R4: The oracle is schema-agnostic about artifact *contents*

**Decision**: The oracle treats every artifact's bytes as opaque. It hashes them; it does
not parse them. No artifact's internal schema — including the timed transcript's — is
required by Milestone 1.

**Rationale**: This resolves the design's open question about the timed transcript's
schema without deferring anything that blocks work. The transcript's shape is a contract
between its *producer* and its *consumers*; the oracle sits between them and needs only
its hash. Requiring the oracle to know the shape would violate Principle IV (crafts remain
specialized) by teaching the orchestration layer an audio concern.

**Consequence**: The transcript's schema is genuinely deferrable to the point where a real
aligner informs it, and that deferral costs Milestone 1 nothing. What Milestone 2 needs is
only that a provider *declares* what it produced — not what is inside it.

## R5: Testing the store without depending on a bucket

**Decision**: Two layers.

1. An `AssetStore` interface with an in-memory implementation used by every graph,
   freshness, and CLI test. This is a test double in test code, which the constitution
   permits (and Principle V's ban on mock data explicitly scopes to non-test code).
2. A contract test suite run against a real S3-compatible server (MinIO via
   testcontainers), exercising the `@aws-sdk/client-s3` adapter itself. It is tagged as an
   integration test and skipped when Docker is unavailable, with the skip **reported
   loudly** rather than passing silently.

**Rationale**: SC-007 requires the complete state and staleness behavior to be exercisable
with no asset store reachable — layer 1 delivers that. But an adapter that is only ever
tested against a double proves nothing about S3 compatibility, and FR-027 promises the
backend is swappable by configuration. Layer 2 is what makes that promise checkable.

A silently-skipped integration test is a false-clean (Principle V), so the skip must
announce itself.

**Alternatives considered**: `s3rver` in-process (unmaintained; an S3 emulator that drifts
from real S3 is worse than none); mocking the AWS SDK client (tests the mock, not the
protocol); requiring a live B2 bucket in CI (credentials in CI, slow, and it makes the
test suite depend on a network the design deliberately keeps off the read path).

## R6: Milestone 1 must not import the provider layer

**Decision**: The oracle's modules take no dependency on any execution or store-network
code. Enforced structurally — `pc status`, `pc next`, and `pc release-check` resolve
through interfaces whose Milestone 1 implementations read only the local filesystem.

**Rationale**: The design's central risk decision is that the graph is the novel part and
execution is commodity, sequenced so the novel part lands first. That sequencing is only
real if Milestone 1 genuinely stands alone; if the oracle imports the provider runner "just
for types," the milestone boundary is decorative and the de-risking is imaginary.

This is also what makes FR-010 (reporting state requires no network and no craft tools)
testable rather than aspirational: it holds by construction, not by discipline.

## R7: Recording `built_at` without breaking determinism

**Decision**: `built_at` is recorded as an ISO-8601 UTC timestamp and is **never an input
to any decision**. Freshness, release-check, and staleness read hashes only.

**Rationale**: The constitution forbids timestamps for freshness (Principle II) because
they lie after a clone. But a human reading the ledger reasonably wants to know when
something was built. Recording it is useful; *deciding* on it is the banned thing. Making
the distinction explicit here prevents a later reader from either stripping a useful field
or quietly reintroducing mtime logic.

## R8: What "indivisible" means mechanically

**Decision**: `pc build` writes the ledger entry in the same process invocation that runs
the provider, after hashing the produced outputs and before exiting successfully. If the
ledger write fails, the command exits non-zero. There is no separate `pc record` verb, and
no flag that suppresses recording.

**Rationale**: FR-014 requires build-and-record to be one action, and the manifesto's
reasoning is that an agent drives this and any skippable step eventually gets skipped. The
mechanical guarantee is the *absence of an alternative path*, not a transaction: there is
simply no way to express "build without recording" in the CLI surface.

Full atomicity against process kill is not attempted — a killed build leaves outputs
without a record, which the oracle then correctly reports as stale or missing rather than
as a false success. The failure mode is safe by construction.

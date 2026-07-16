---
slug: 001-episode-production-contract
targetVersion: ""
---

# Audit log — 001-episode-production-contract

## 2026-07-16 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260716-01 — examples/minimal-podcast is missing the authored files its own manifest and comments require

Finding-ID: AUDIT-20260716-01
Status:     acknowledged-2026-07-16 (false-positive)
Disposition: FALSE POSITIVE. Commit 9c0f853 adds outline.md (8 lines) and script.md (4 lines) together with take-01.wav — both ARE committed, non-empty, and `pc status --episode examples/minimal-podcast` reports outline/spoken `present` and narration `needs-review`, exactly as the manifest comment promises. The barrage chunks the feature diff; the single-model (claude=high, no cross-model confirmation) chunk that raised this did not contain those two files, and its "not a chunk-boundary artifact" reasoning was mistaken. Verified via `git show 9c0f853 --stat` and a live status run.
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    examples/minimal-podcast/episode.yaml:11-24 (plus the absent examples/minimal-podcast/outline.md and examples/minimal-podcast/script.md)

The example's `episode.yaml` declares three authored nodes: `outline.path: outline.md`, `spoken.path: script.md`, and `narration.path: assets/narration/take-01.wav`. This chunk adds only `take-01.wav` (and it is a text placeholder, not audio). Neither `outline.md` nor `script.md` is committed anywhere in the diff, and the example's files sort contiguously, so their absence here is not a chunk-boundary artifact. The manifest's own inline comment asserts a falsifiable behavior — "`pc status` reports it `present`, because an authored file nobody builds from is still an authored file" — which cannot hold when `outline.md` does not exist on disk. Worse, `narration` declares `follows: spoken`, so the advisory `needs-review` relation (FR-018/FR-019) the comment advertises points at a `script.md` that isn't there.

Blast radius: this is the shipped, README-referenced starter example. An adopter who runs `pc status` / `pc build` against `minimal-podcast` as their first contact with the tool will get `missing` on `outline`/`spoken` (or an outright resolution failure), directly contradicting the walkthrough the comments promise — the worst first-run impression, and exactly the kind of break the T078 quickstart pass was meant to catch. A reasonable fix is to commit `outline.md` and `script.md` (even one-line placeholders) alongside `take-01.wav`, or delete the `outline`/`spoken` nodes from the manifest if the example is intended to be narration-only.

### AUDIT-20260716-02 — The production resolver never wires the new git tracking check

Finding-ID: AUDIT-20260716-02
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    missing production wiring for src/assets/git-tracked.ts; current callers are src/state/identity.ts:144 and src/providers/inputs.ts:130

The diff adds `src/assets/git-tracked.ts`, but the production resolution paths still call `resolveAuthored(...)` without `opts.tracked`. Per `src/assets/pointer.ts`, omitted tracking means every file is treated as untracked. As a result, the FR-026 exception for large files already tracked by git is not active in `pc status` or provider input resolution.

The blast radius is high because a consumer running the feature as shipped will hit false failures for legitimate tracked files over the inline threshold: the code has the checker, but the actual read/build paths do not use it. A reasonable fix is to inject `gitTrackedCheck()` at the CLI/application boundary for production resolution while preserving explicit test seams for stubs and no-repo callers.

### AUDIT-20260716-03 — Freshness never notices an input REMOVED from the manifest, so a producer whose input list shrank reports `fresh`

Finding-ID: AUDIT-20260716-03
Status:     fixed-168f94a
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/freshness.ts:~166-188 (`findMovedInput`), called from `assessFreshness`

The consistency check iterates over the node's *declared* inputs only, and looks each one up in the ledger record: `const recordedHash = recorded[identity] ?? null; if (recordedHash !== resolution.hash) {...}`. It never iterates the other direction — over `record.inputs` — so an identity that was recorded at build time but is no longer declared is invisible to the check. Delete an input from a producer's `inputs` list in the manifest and every remaining declared input still matches its recorded hash, the output bytes still match `output.hash`, and `assessFreshness` returns `{kind: 'consistent'}`. The node reports `fresh` and the frontier gives it no action, even though the artifact on disk was demonstrably built from material the manifest no longer says it is built from.

The asymmetry is easy to miss because the added-input case *is* handled — `recorded[identity] ?? null` yields `null` for a newly declared input and correctly reports `input-changed` with `recorded: null`, and the doc comment at the type explicitly reasons about it ("the input was declared after the fact, so this node was never built from it"). Removal is the exact mirror of that case and gets the opposite treatment silently. The header pseudocode ("for each declared input") is faithfully implemented; the defect is that the pseudocode itself only closes one side.

Blast radius: this is a false-clean on the surface whose entire stated purpose is "is reality still consistent with what we recorded?" (file header). A consumer — human or an unattended agent running `pc status` / `pc release-check` before shipping — is told the episode is consistent when the recorded provenance and the declared provenance disagree. It is quiet, plausible, and survives to release. A reasonable fix: after the declared-input loop, compare the key sets — `for (const recordedId of Object.keys(recorded)) if (!inputs.includes(recordedId)) return {kind: 'input-removed', identity: recordedId, recorded: recorded[recordedId]}` — with a distinct assessment kind so `resolve.ts` can name the cause honestly ("built from an input this node no longer declares") rather than folding it into `input-changed`.

### AUDIT-20260716-04 — Case 5 cannot discriminate record-based from disk-based input resolution — the property it claims to prove is untestable as written

Finding-ID: AUDIT-20260716-04
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/state/freshness.test.ts:190-286

Case 5's own comment makes the contract explicit: "what resolving the identity `voiceover` means for a downstream consumer: the bytes voiceover's own ledger record currently points at." That distinction is load-bearing — commit `ff0d45e` ("Resolve the SC-004 conflict: derived inputs resolve from records") exists precisely to settle whether a derived input resolves from the upstream's ledger `output.hash` or from hashing the file on disk at `output.path`. But the fixture writes `dist/voiceover.wav` with bytes whose hash is `currentVoiceoverOutputHash` **and** records that same hash in `ledger.artifacts.voiceover.output.hash` (lines 200-204, 244). The two candidate resolution strategies produce identical answers, so the assertion at lines 279-281 passes under either implementation.

The blast radius: an agent refactoring `src/state/resolve.ts` to re-hash the file on disk (the naive, arguably more obvious implementation) would break the SC-004 resolution and this suite would stay green. The one test that names the invariant in its comment is the one that cannot detect its violation. This is worse than no test, because the comment tells the next reader the property is covered.

The fix is to break the tie deliberately: write `dist/voiceover.wav` with bytes that hash to something *other* than the recorded `output.hash`, then assert `podcast`'s state follows the recorded hash rather than the on-disk bytes. Two fixtures — one where record-resolution says fresh but disk-resolution says stale, and the mirror — pin the invariant in a way a refactor cannot slip past.

### AUDIT-20260716-05 — `follows` can point at an unreachable catalogue target that is not a graph node

Finding-ID: AUDIT-20260716-05
Status:     fixed-168f94a
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/graph/validate.ts:74-82

`validateGraph` defines `knownIds` as all authored ids plus all profile target ids, then accepts `follows` if it appears anywhere in that set. But `buildGraph` intentionally includes only authored nodes plus reachable profile targets (`src/graph/build.ts:74-85`). That means an authored node can `follows: website` where `website` exists in the profile catalogue but is unreachable from `manifest.targets`; validation passes, but the followed identity is not a node in this episode graph.

This leaks into runtime: `resolveAuthoredNode` calls `resolver.resolve(followed)` for every authored `follows` (`src/state/resolve.ts:286-304`), and the resolver throws if the id is not in `graph.nodes` (`src/state/identity.ts:119-124`). `pc explain` has the same assumption through `lookup(byId, followed)` (`src/cli/chain.ts:186-204`). Blast radius is high because a manifest accepted by graph validation can make ordinary read operations fail as an internal graph/status disagreement. A reasonable fix is to validate `follows` against episode graph nodes, or explicitly include followed profile targets in the graph and status model if that is the intended invariant.

### AUDIT-20260716-06 — `src/cli/index.ts` self-executes at import time while also exporting `createProgram`/`run`

Finding-ID: AUDIT-20260716-06
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/index.ts:1-2, 46, 219

The last line of the module is a bare top-level `await run(process.argv, createDefaultDeps());`, with no entrypoint guard (no `import.meta.url === process.argv[1]` check, no separate `bin.ts`). The same module exports `createProgram` (line 46) and `run` — exports that exist only to be imported. Any importer therefore gets the entire CLI executed against *the host process's* argv as an import side effect, plus a `createDefaultDeps()` construction it never asked for.

The blast radius is concrete and self-inflicted. If any test or tool does `import { createProgram } from '@/cli/index.js'`, `run` fires with vitest's argv (`['node', '.../vitest.mjs', 'run', ...]`). That is length ≥ 3, so it skips the help branch, reaches `program.parseAsync`, and commander rejects `run` as an unknown command. `exitOverride` turns that into a `CommanderError` with a non-zero `exitCode`, which the catch block maps to `EXIT_USAGE` and assigns to `globalThis.process.exitCode`. The test runner then exits 2 with every test passing — a green suite reporting failure, with the cause several files away from anything the developer touched. The `deps` parameter makes this worse, not better: the module advertises injectability while hard-wiring `createDefaultDeps()` into an unconditional call.

The fix is the standard split: keep `createProgram`/`run` in a pure module and move the `#!/usr/bin/env node` shebang plus the single `await run(process.argv, createDefaultDeps())` into a separate `src/cli/bin.ts` that `package.json`'s `bin` points at. That preserves both the exports and the entrypoint without one being a landmine for the other.

---

### AUDIT-20260716-07 — Provider output paths can escape `output_dir`

Finding-ID: AUDIT-20260716-07
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/run.ts:225-254

`BuildOutput.path` is described as relative to `output_dir`, but the runner accepts any non-empty string and then resolves it with `path.resolve(request.output_dir, output.path)` at lines 228-230. A provider can declare `../outside.txt` or an absolute path, write that file outside the scratch directory, and the runner will accept it as an existing declared output. The undeclared-file check at lines 241-242 only walks `request.output_dir`, so it never catches the escaped file.

The downstream blast radius is high because `invokeProvider` will then hash and ingest bytes from outside the owned scratch directory, breaking the contract boundary that provider outputs are contained under `output_dir`. A reasonable fix is to reject absolute paths and any normalized path that is empty, `..`, or starts with `../` before resolving or comparing outputs, ideally in the schema/parser so every caller gets the same invariant.

### AUDIT-20260716-08 — `loadProfile` joins an unvalidated profile name into a path, so a profile name with separators escapes the search-dir contract

Finding-ID: AUDIT-20260716-08 (claude-04 + codex-02; cross-model)
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/manifest/load.ts:55-68, src/manifest/schema.ts:60 (`profile: z.string()`)

`EpisodeManifestSchema` declares `profile: z.string()` with no constraint, and `loadProfile` turns it straight into a path: `const fileName = \`${profileName}.yaml\`` (line 55) then `path.join(dir, fileName)` (line 59). A manifest declaring `profile: ../../../other-repo/secret` resolves and loads a file entirely outside every directory in `searchDirs`, and the function's own doc comment — "Resolves `<name>.yaml` by searching `searchDirs` in order" — is then false. Less exotically, `profile: shared/editorial-audio` silently reads from a subdirectory, which no reader of the manifest would predict from the documented contract.

The blast radius is bounded by the fact that `episode.yaml` is repo-committed and read by the same human who wrote it, so this is not a meaningful attack surface for the current single-repo, single-operator flow — that is why it is low, not high. It matters as a contract defect: the searched-directories guarantee is the thing `loadProfile` exists to provide, and it is unenforced. It also produces a confusing failure mode, since a traversing name that misses reports "Profile ... not found. Searched: `<dirs>`" while listing directories that were never actually the ones consulted.

The fix belongs in the schema, where the rest of this feature's refusals live: constrain `profile` to a bare name (e.g. `.regex(/^[a-z0-9][a-z0-9-]*$/)` matching the existing `editorial-audio` convention) so a path-shaped profile name is refused at manifest-load time with a message naming the field, consistent with how `version` and `HashSchema` already refuse.

### AUDIT-20260716-09 — Manifest-authored paths can escape the episode directory

Finding-ID: AUDIT-20260716-09
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/manifest/schema.ts:24-26

`AuthoredDeclSchema` accepts `path: z.string()` with no non-empty or relative-path constraint. Downstream code treats authored paths as episode-relative, but `../outside.md` survives schema parsing and will be joined against `episodeDir`, allowing status/build/review resolution to hash or pass files outside the episode boundary. The blast radius is high because this is a persisted manifest contract: an unattended consumer will parse the manifest as valid and then operate on the wrong filesystem surface.

A reasonable fix is to introduce a shared relative path schema for manifest-authored paths, rejecting empty strings, absolute paths, and any path that normalizes outside the episode root.

### AUDIT-20260716-10 — Shipped `pc status` path is not checked because `src/cli/index.ts` is excluded

Finding-ID: AUDIT-20260716-10
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/architecture.test.ts:45-50, tests/unit/architecture.test.ts:63-68, tests/unit/architecture.test.ts:511-540

The comments correctly say SC-001 is about the shipped `pc` surface, but the roots are narrowed to individual read verb files (`lines 63-68`) specifically because `src/cli/index.ts` wires `pc build` and therefore reaches `child_process` (`lines 45-50`). The actual command a user runs is still dispatched through `src/cli/index.ts`; excluding that module means the test proves only that the command implementation files are clean, not that invoking `pc status`, `pc next`, `pc explain`, or `pc release-check` through the shipped CLI avoids loading execution/network surfaces.

The blast radius is high because downstream consumers can rely on “reporting state is offline BY CONSTRUCTION” (`lines 511-540`) while the shipped entrypoint has an unchecked import path to build/validate/provider code. A reasonable fix is to make the CLI entrypoint lazy-load command modules or otherwise isolate read-command registration, then root the architecture check at the actual shipped dispatch path for each read verb.

### AUDIT-20260716-11 — `assessRelease` is never tested against the `invalid` state its own sibling test proves is reachable

Finding-ID: AUDIT-20260716-11
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/state/release.test.ts:79-86 (cross-referenced against tests/unit/state/resolve.test.ts:189-196)

```

`resolve.test.ts:189-196` asserts that a ledger validation of `failed` resolves to `state: 'invalid'`, `validated: 'failed'`, `cause.code: 'validation-failed'` — so `invalid` is a reachable node state produced by the real resolver. But `release.test.ts:79-86`, the test that claims to cover the failed-validation path ("a fresh target with a FAILED validation blocks release"), constructs `node('epub', 'derived', 'fresh', { validated: 'failed' })`. Per its own sibling test, `resolveStatus` never emits that combination — `fresh` + `failed` is unreachable. The release suite therefore proves the gate blocks a state that cannot occur, and never proves it blocks the state that actually does.

The blast radius: if `assessRelease` gates on `validated !== 'passed'` this happens to still block, but if it gates on `state !== 'fresh' || validated === 'failed'`-style logic with an `invalid` branch missing from the blocker set, a genuinely invalid target ships as releasable and every test here stays green. `pc release-check` returning clean on an artifact whose validation failed is exactly the false-clean FR-006b exists to prevent, and the suite's own docblock (`release.test.ts:8-14`) claims the dedicated subtle-case test is "the one place a lazy implementation would quietly ship a false-clean" — it guards the wrong cell.

A fix: add `node('epub', 'derived', 'invalid', { validated: 'failed' })` as the failed-validation blocker case, and either drop the `fresh`+`failed` test or keep it explicitly labelled as a defense-in-depth check against an unreachable combination. The same gap applies to `blocked` and `absent` targets — neither state appears anywhere in `release.test.ts`, despite `resolve.test.ts:57-108` proving `blocked` is reachable for a target node.

### AUDIT-20260716-12 — No coverage for a `follows` node with no `reviews` entry — the fresh-install baseline

Finding-ID: AUDIT-20260716-12
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/state/resolve.test.ts:299-341 (Case 11), 110-159 (Case 8)

```

Both tests that exercise `follows` seed `ledger.reviews[id].waived_hash` with a baseline (`resolve.test.ts:325-331` and `:141-147`). Every `follows` scenario in this chunk is the *upgrade* path — a human has already recorded a review at some point. The *fresh install* path is untested: an author declares `narration: { path: 'narration.wav', follows: 'spoken' }`, has never run `pc review`, and `ledger.reviews` is `{}`. What state does `narration` resolve to?

Both readings are plausible and the tests disambiguate neither. If the implementation compares `spoken`'s current hash against `reviews.narration?.waived_hash`, then `undefined !== <hash>` is true and *every* newly-declared `follows` node reports `needs-review` from the moment it is authored, with nothing having drifted. Per `release.test.ts:88-101`, an unwaived `needs-review` anywhere blocks release — so a fresh episode is unreleasable on day one until the author waives a drift that never happened. The opposite reading (no baseline ⇒ `present`) means the very first real drift after authoring goes unreported. The suite's own docblock (`resolve.test.ts:14-24`) concedes the semantics are an interpretation of an underspecified schema, which makes the untested branch more dangerous, not less: an unattended agent implementing against this suite picks whichever branch it reaches first and the tests stay green either way.

A fix: add a Case 11b — `follows` declared, both paths present on disk, `ledger.reviews` empty — and assert the intended state explicitly, with the FR/data-model line that justifies it cited in the assertion message. Whichever way it resolves, it needs to be pinned by a test rather than left to the implementation.

### AUDIT-20260716-13 — Importing every emitted `.js` includes the CLI entry point, whose top-level side effects run inside the vitest worker

Finding-ID: AUDIT-20260716-13
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/build-emit.test.ts:53-80

The second test walks all of `dist/` and does `await expect(import(file)).resolves.toBeDefined()` for every emitted `.js`. That set necessarily includes `dist/cli/index.js` — the file `package.json` `bin` ships, per this test's own header comment (lines 12-22). A CLI entry point is exactly the kind of module that does work at import time: parse `process.argv`, dispatch a command, `process.exit()` on unknown args. Imported inside the vitest worker, `process.argv` is vitest's own argv, so the module either throws (test fails for a reason unrelated to specifier resolution), writes usage text to the test output, or calls `process.exit` and tears down the worker mid-run — a failure mode that reads as a flaky/hung suite rather than a build defect.

Blast radius: the test is a gate, so the consequence lands on contributors, not users — but a gate that dies opaquely on the worker is a gate people disable. It is also self-defeating: the module most important to prove loadable is the one most likely to make the proof unusable. The comment on lines 65-66 ("Importing every emitted module proves the specifiers resolve for real") is the right instinct; the mechanism is wrong. A reasonable fix is to resolve rather than execute — spawn `node --input-type=module -e 'import("file:///…")'` per file in a child process so side effects and `process.exit` are contained, or (cheaper) keep the in-process import for library modules and prove the real entry point with a single `node dist/cli/index.js --help` subprocess assertion, which is what actually needs to hold.

### AUDIT-20260716-14 — An ingest that has already overwritten `dist/` is not rolled back when the record write fails, leaving the ledger's hash and the file on disk disagreeing

Finding-ID: AUDIT-20260716-14
Status:     fixed-168f94a
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/build.ts:31-38, 76-79, 108-121

The header comment claims the indivisible act's failure semantics: "A failure at any step throws, and the ledger is written only at step 5 — so a failed build writes no record claiming success and leaves any previous record untouched (FR-017)." That is true of the *record*, but step 4 (`ingest`, lines 114-119) has already `copyFile`'d the new bytes over the artifact's final `dist/` location before step 5 runs. If `record` throws — `readLedger` fails on a concurrently-corrupted file, `writeLedger` hits ENOSPC/EPERM, or the process is interrupted between the copy and the write — the previous record survives naming hash `H_old` while `dist/<path>` now holds bytes hashing to `H_new`.

The blast radius is precisely the state this system exists to make impossible: the ledger asserts an origin for bytes that are not the bytes on disk. The system's own modified-detection (`src/state/modified.ts`) will report the artifact as externally modified, and the operator has no way to distinguish "someone hand-edited the artifact" from "a build died halfway." The build is also not idempotent-safe on retry: a rerun that produces the same bytes will silently repair the divergence, so the evidence of the failed write disappears.

A reasonable fix is to make the visible state change last and atomic: copy to a sibling temp path under `dist/`, write the ledger, then `rename` into place — or, if the record must be written last, write it to a temp file and `rename` both, so the only interruptible window is between two renames rather than spanning a full copy plus a full ledger serialize. At minimum the header comment must stop claiming a failure leaves the prior state untouched, because for the artifact bytes it does not.

### AUDIT-20260716-15 — `BuildOutputSchema.path` accepts any non-empty string, so a provider-declared `../` output escapes `dist/` at ingest

Finding-ID: AUDIT-20260716-15
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/contract.ts:38-40; src/providers/build.ts:113-119

`BuildOutputSchema` constrains `path` only to `z.string().min(1, 'must be a non-empty path relative to output_dir')` — the message asserts relativity but the schema does not check it. The module doc on lines 5-11 states these schemas "are the whole of what crosses that boundary," which sets the expectation that the boundary check lives here. Downstream, `ingest` composes the path without validating it: `path.posix.join('dist', output.relPath)` then `path.join(episodeDir, recordedPath)` (lines 114-115), followed by `mkdir -p` and `copyFile` (lines 117-118). A provider declaring `{"path": "../../../.ssh/authorized_keys"}` or an absolute `/etc/...` yields a `destination` outside `dist/` and outside `episodeDir`, and the recorded `output.path` in the ledger becomes a `../`-prefixed string that every downstream reader (freshness, modified detection, release-check) will resolve back out of the episode.

I cannot see `src/providers/invoke.ts` (chunk 93e2aa5) from this lane, so it is possible `ProducedOutput.relPath` is normalized there. That possibility does not retire the finding: the traversal constraint belongs on the wire schema that the doc claims is the boundary, and `ingest` is exported-adjacent logic that trusts its input unconditionally. If invoke.ts does guard it, this is a defense-in-depth gap plus a misleading doc; if it does not, an untrusted-or-buggy subprocess writes arbitrary files with the operator's privileges, and providers are explicitly third-party programs "not aware of production-control."

The fix is a refinement on `BuildOutputSchema.path` — reject absolute paths and any normalized path whose first segment is `..` — mirrored by an assertion in `ingest` that `path.relative(path.join(episodeDir, 'dist'), destination)` neither starts with `..` nor is absolute, throwing and naming the offending field per FR-036.

### AUDIT-20260716-16 — Provider outputs can escape `dist/` and be recorded as legitimate artifacts

Finding-ID: AUDIT-20260716-16
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/contract.ts:39-42, src/providers/build.ts:127-134

`BuildOutputSchema` says the provider output path is relative to `output_dir`, but it only checks for a non-empty string. `ingest()` then trusts `output.relPath`: `path.posix.join('dist', output.relPath)` and `path.join(episodeDir, recordedPath)` allow paths like `../article.mdx` or `../../outside` to normalize outside `dist/`, and the record will still claim whatever normalized path was produced. The adjacent runner also resolves declared outputs with `path.resolve(output_dir, output.path)`, so an absolute or `..` path can pass the existence check if that file exists.

Blast radius is high because a provider contract consumer can ship an output path that overwrites authored episode files or writes outside the expected artifact area, while production-control records it as the build result. The fix should enforce provider-declared output paths as clean relative paths under `output_dir` before hashing or ingesting, rejecting absolute paths, `..` traversal, and normalized paths that leave the intended directory.

### AUDIT-20260716-17 — Impure declarations can still carry an empty reason

Finding-ID: AUDIT-20260716-17
Status:     fixed-168f94a
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/manifest/schema.test.ts:242-253, tests/unit/manifest/schema.test.ts:273-339

The tests assert that `ProviderDeclSchema` accepts an `impure` object with a reason and rejects a bare boolean, but they never exercise the in-scope failure mode where `impure.reason` is empty or whitespace-only. The same gap exists for `ArtifactRecordSchema`: the tested records omit `producer_impure` entirely, so there is no coverage that a recorded impure producer must preserve a meaningful reason.

This matters because FR-032/T060 require the reason, not just the object shape. The implementation currently uses `z.string()` for both `ProviderDeclSchema.impure.reason` and `ArtifactRecordSchema.producer_impure.reason`, so `{ impure: { reason: "" } }` and `{ producer_impure: { reason: "" } }` parse successfully. A downstream consumer acting on the schema as written can record an impurity flag with no explanation, losing the provenance distinction the contract relies on. Blast radius is high because this weakens the ledger/profile contract for any impure provider and can ship false-complete provenance without an obvious runtime failure.

A reasonable fix is to add refusal cases here for empty and whitespace-only impurity reasons on both provider declarations and ledger artifact records, then make the schemas use the same trimmed non-empty refinement already used for waiver reasons.

### AUDIT-20260716-18 — Docker-absent is a permanently green skip: FR-027's only real proof can go unexecuted forever with no gate

Finding-ID: AUDIT-20260716-18
Status:     fixed-9744520
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/s3-store.test.ts:35-55

`const dockerAvailable = await isDockerAvailable()` (line 35) drives `describe.skipIf(!dockerAvailable)` (line 55), with a `console.warn` banner (lines 37-48) as the only signal. The docblock argues that "a silently-skipped integration test is a false-clean (research R5)" and claims the suite therefore "SKIPS LOUDLY." But loudness is not enforcement: a `console.warn` plus a vitest skip marker still produces **exit code 0**. On any runner without Docker — most default CI images, a container-less sandbox, an agent host — this suite is skipped on every run forever and the board stays green, which is precisely the false-clean the file names as its own motivation.

The gap is that there is no way to declare "Docker is required here." The suite treats Docker's absence as always-acceptable, so environment configuration cannot distinguish "a developer's laptop without Docker, skip is fine" from "CI, where a skip means the S3 contract went unproven and the run must fail." Since the docblock states this suite is the *only* thing standing between `s3AssetStore` and an adapter that "never touched the network correctly," a permanent skip means FR-027 has no proof at all while reporting as satisfied.

Blast radius: an adopter running the test suite and seeing green would reasonably conclude the S3 adapter is proven against a real S3-compatible server; it may never have been executed once. A reasonable fix is an opt-in hard requirement — e.g. read a `PC_REQUIRE_DOCKER` (or equivalent) env var, and when it is set, make the missing-Docker branch a **failing** test rather than a skip, then set it in CI. That keeps the developer-laptop ergonomics while making the skip impossible to normalize where it matters. This also fits the project's stated stance against fallbacks that hide failure modes.

### AUDIT-20260716-19 — Fetched asset bytes are handed to the provider under a *claimed* hash, never an observed one — breaking the module's own stated invariant

Finding-ID: AUDIT-20260716-19 (claude-01 + claude-02 + codex-02; cross-model)
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/inputs.ts — the `resolution.kind === 'pointer'` fetch branch (`return { path: localPath, hash: address };`)

The file header states the invariant plainly: *"The hash supplied alongside each path is the hash of THE BYTES BEING HANDED OVER, computed here from those bytes."* Every other path in the module honors it — the beside-the-stand-in branch does `const actual = await hashFile(fullPath)` and refuses on mismatch; `resolveDerivedInput` returns `hash: await hashFile(fullPath)` and its doc-comment explains at length why it must not record the upstream's *recorded* `output.hash`. The fetch branch alone returns `hash: address`, where `address` is `resolution.pointer.asset` — the value the `.asset` stand-in *claims*, propagated without ever touching the fetched bytes. `invoke.ts` makes the same principle explicit for the other side of the boundary: *"A hash a provider reported would be a claim; a hash computed here from the bytes on disk is an observation. Only one of those belongs in a ledger."* The input half of the boundary does not follow its own rule.

Blast radius: `pc build` records this value as the build's input hash. If `InputResolver.resolveToLocalPath` returns bytes that do not hash to the requested address — a truncated download, a partially-written cache entry from an interrupted earlier run, a store that indexes by key rather than content, or any resolver implementation that does not itself verify — the ledger states the build consumed content it did not consume, and the freshness/`modified` machinery downstream compares against an address nothing on disk matches. This is silent: no error, no divergence signal, just a record that is wrong in exactly the way the module was written to prevent. It is the quietly-plausible wrong reading the rubric ranks above an alarming-but-obvious one, and it is the kind of defect an unattended agent building on this record will not catch. Whether `storeBackedResolver` verifies is out of this chunk and I could not read it — but that is precisely the problem: the guarantee is asserted here in prose and delegated to an injected interface whose contract, as declared in `InputContext.assets: InputResolver`, does not promise it.

A reasonable fix is symmetry with the branch immediately above it: after `fetchAsset` returns, compute `const actual = await hashFile(localPath)` and refuse when `actual !== address`, naming both the address the stand-in requested and what the store actually produced — the store returned bytes that are not the asset. Return `{ path: localPath, hash: actual }`. If the intent is instead that the resolver is contractually required to verify, that requirement belongs in the `InputResolver` type's doc-comment and needs a fixture proving a lying resolver is refused; the assertion cannot live only in this file's prose while this file trusts.

---

### AUDIT-20260716-20 — The execution ledger records 78/78 `reviewClean: true`, which the audited commit history directly contradicts

Finding-ID: AUDIT-20260716-20
Status:     fixed-9744520
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    .stack-control/execute/001-episode-production-contract.ledger.jsonl:1-78

Every one of the 78 ledger rows carries `"reviewClean": true`. No row records a finding, a re-review, or a dissent. But the commit subjects in the audited range record defects found during execution of these very tasks: `7d2a0ba` says outright "T078 quickstart walk: **fix the directory-input build bug it found**"; `1edfc7a` is "Fix the @/ alias shipping broken output"; `c001f54` is "Repair execution ledger ids"; `552e21f` is "Apply architecture review". T078's own row (line 78) claims `reviewClean: true` while the commit that closed T078 exists specifically because its review was not clean.

The field has no definition anywhere in the diff, and that is the root of it: `reviewClean` could mean "no findings were ever raised" or "the review was clean by the time the row was written." Under the first reading the ledger is false for at least T078. Under the second it is true but carries zero information, because a fix-then-ledger loop makes every row green by construction — an unfalsifiable field. Neither reading survives, and nothing in the artifact disambiguates.

Blast radius: this ledger is the evidence artifact downstream governance prices. The audit-barrage prompt I am running under instructs reviewers to price a round's "0 HIGH" by the health of the fleet that produced it. A consumer — human or an unattended governance agent — reading 78 consecutive green rows concludes every task passed first-pass review, and weights the convergence claim accordingly, when the true signal is "green is the only value this field takes." The fix is to define the field in the ledger schema and make it carry the actual review outcome: findings count, disposition, and whether re-review was required, so that a row like T078's reads as `findings: 1, resolved-in: 7d2a0ba` rather than as clean.

### AUDIT-20260716-21 — The cycle test's "names the offending declaration" assertions (`/a/`, `/b/`, `/c/`) match essentially any prose

Finding-ID: AUDIT-20260716-21
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/cli.test.ts:120-125

Lines 122-124 assert `expect(result.stderr).toMatch(/a/)`, `/b/`, `/c/` under the comment "The offending declaration is NAMED (FR-036) — not merely 'a cycle exists'." These are unanchored single-character regexes against free-form stderr. A message reading `cycle detected in the build graph` satisfies `/a/` (in "graph") and `/b/` (in "build"); nearly any English error string containing the word "because" satisfies all three at once. The assertions therefore pass whether or not the cycle members are named, which is precisely the thing FR-036 requires and precisely the thing the comment claims is being enforced.

Blast radius: this is a test that does not test the contract it claims. The FR-036 requirement — that a refusal names the offending declaration rather than merely asserting a cycle exists — has no real coverage here despite the file presenting itself as the CLI contract suite. If `pc status` regresses to emitting a bare `cycle detected`, this test stays green and the operator loses the one signal that would have caught it. The severity is high rather than medium because the failure is silent and the surrounding comments actively assert the opposite, so a reviewer reading this file for coverage gaps will skip past it.

The fix is word-boundary-anchored assertions against the actual node identities in `tests/fixtures/cycle/episode.yaml` — e.g. `expect(result.stderr).toMatch(/\ba\b/)` — or, better, an assertion on the cycle path as a unit (`expect(result.stderr).toMatch(/a\s*(→|->)\s*b\s*(→|->)\s*c/)`), which is what actually distinguishes "names the cycle" from "mentions some letters." Single-letter fixture node names are themselves the root cause of the untestability; renaming the cycle fixture's nodes to distinctive identifiers (`alpha`, `beta`, `gamma`) would make the assertion both meaningful and readable.

### AUDIT-20260716-22 — `pc asset add` leaves the original bytes in place

Finding-ID: AUDIT-20260716-22
Status:     fixed-168f94a
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/asset.ts:16-17, src/cli/asset.ts:214-228

The verb’s stated contract is to move bytes into the content-addressed store and leave “the stand-in” as the committable half, but the implementation only writes `<file>.asset` and never removes or replaces the original file. Lines 214-228 create the pointer and write the stand-in; there is no `unlink`, rename, or other step that makes the original bytes stop living beside it. That means an operator can run `pc asset add assets/narration/take-01.wav`, get a success, and still commit both the large binary and the stand-in.

The blast radius is high because this defeats the asset-store goal in the normal success path: downstream users are told the bytes “do not” live in git, but the command leaves them exactly where git can still pick them up. A reasonable fix would make the post-store filesystem transition explicit and tested: after the store has accepted the bytes and the stand-in has been written, remove or replace the original file according to the intended contract, and assert that only the stand-in remains as the committable artifact.

### AUDIT-20260716-23 — `visit()` halts on any `needs-review` node, but its own contract says the rule is for AUTHORED nodes only

Finding-ID: AUDIT-20260716-23
Status:     fixed-168f94a
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/chain.ts:124-152

The doc comment above `visit` states the rule as "An AUTHORED node awaiting a human decision (`needs-review`) HALTS the walk (FR-011a)", and the halt text asserts a fact about authored nodes specifically: "Its own bytes have not changed, so nothing propagates past it — only a human revising this node would carry the change downstream." But the implementation keys on state alone — `const isPendingDecision = descent.status.state === 'needs-review';` (line 138) — and never consults whether the node is authored or derived. `node.inputs` is right there on line 165 and is the discriminator the rest of the function uses, but it is only read *after* the halt branch has already returned.

The consequence if `resolveStatus` can put a derived node into `needs-review` by any route: `pc explain` silently truncates the chain at that node, reports zero of its declared `inputs`, and prints a halt message that asserts an unverified claim about the node's bytes. Then `descendObservation` is called with a derived node's `follows` (line 158), which is presumably `undefined`, so the walk returns a single-link chain that names no cause upstream at all. Blast radius: the verb whose entire stated purpose is "walks the causal chain back to the authored inputs responsible" would answer with a confident, exit-0, fabricated-looking chain that omits the responsible inputs — exactly the FR-036 failure mode the module's own comments say it exists to prevent. A reader (or an unattended agent acting on the JSON) has no signal that anything was dropped.

If derived nodes provably cannot reach `needs-review`, the guard is still worth writing, because the invariant is currently enforced nowhere and the code already carries a defensive throw (lines 127-132) for exactly the class of "the status report and the graph disagree" mismatch. A reasonable fix: compute `isAuthored` from the node (no `inputs`), gate the halt on `isAuthored && state === 'needs-review'`, and throw naming the node if a derived node arrives in `needs-review` — that turns a silent truncation into the loud refusal the rest of this codebase prefers.

### AUDIT-20260716-24 — Derived explanations report every input as causal, including unrelated fresh branches

Finding-ID: AUDIT-20260716-24
Status:     fixed-168f94a
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/chain.ts:149-156

`visit()` descends into every declared `node.inputs` for any non-`needs-review` node, without checking whether that input actually contributed to the root node’s current state. For a derived node with multiple inputs, `pc explain <node>` will present unrelated fresh inputs as part of the causal chain behind a stale/blocked/modified state.

That matters because this command is the user-facing oracle for “why is this node in this state?” A downstream operator or unattended consumer can reasonably treat every rendered link as causal, since the comments and JSON shape describe the list as “authored inputs responsible.” The blast radius is high: the tool can confidently point users at the wrong branch of the production graph. A reasonable fix is to make the traversal cause-aware, following only dependencies implicated by the resolved cause/state, or to explicitly label non-causal context separately so the chain does not overclaim causality.

### AUDIT-20260716-25 — Content-addressed destination is written non-atomically, so a concurrent resolve can hand a provider a truncated file

Finding-ID: AUDIT-20260716-25
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/resolve.ts:64-71

`resolveToLocalPath` computes `destination = path.join(destDir, addressLayout(address).digest)` and then does a bare `await fs.writeFile(destination, bytes)`. The doc comment on those lines states the destination is content-addressed precisely "so that two inputs that ARE the same asset land on one file" — which means the collision-on-purpose case is the *designed* case, not a rare one. Two inputs in one episode that reference the same asset, resolved concurrently (the natural shape for a fan-out over a manifest's inputs), both target that same path and both call `writeFile` on it. `fs.writeFile` opens with `O_TRUNC` and streams the buffer in chunks; there is no lock, no temp-file-plus-rename, and no existence short-circuit. A reader (or the second writer's own consumer) can observe the file at zero length or at a partial length while the other write is in flight.

The blast radius is exactly the corruption this module says it exists to prevent. The two `assertAddressMatches` calls guard the bytes *in memory*, before they are written; nothing re-verifies the bytes at `destination` after the write. So a provider is handed a path to a truncated file, produces output from partial input, and that output gets recorded as the derivation of the full asset — a fabricated record with no symptom at the point it happens, which is the failure mode `store.ts:30-43` argues is intolerable. The same hazard exists on a re-run: a second `pc build` truncating a file a first provider is mid-read on.

A reasonable fix is write-to-temp-then-`rename` within `destDir` (rename is atomic on the same filesystem, so a reader sees either the old complete file or the new complete file, never a partial one), plus a short-circuit that skips the write when `destination` already exists and hashes to `address`. The temp name must be unique per call, not per address, or two concurrent resolves just move the race to the temp file.

### AUDIT-20260716-26 — Tracked large authored files are still refused in production paths

Finding-ID: AUDIT-20260716-26
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/pointer.ts:108-111; missing production wiring at src/state/identity.ts:144 and src/providers/inputs.ts:130

`resolveAuthored` only honors the FR-026 tracked-file exception when a `TrackedCheck` is passed, but the production callers invoke it with no options. Lines 108-111 therefore set `isTracked` to `false` for every large plain file, so a git-tracked authored file over 5 MiB is treated as untracked and refused.

That breaks the stated boundary: FR-026 targets authored paths that are both over the size threshold and not tracked. The blast radius is high because `pc status` and `pc build` will reject valid tracked media on real episodes. A reasonable fix is to wire `gitTrackedCheck()` into the build path and an architecture-appropriate tracked check into the status/oracle path, with a fixture proving a tracked oversized file passes while an untracked one refuses.

### AUDIT-20260716-27 — Fetched asset inputs lose their declared file type at the provider boundary

Finding-ID: AUDIT-20260716-27
Status:     fixed-3f07ca0
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/resolve.ts:66-71

`storeBackedResolver` materializes fetched assets as `.production/assets/<sha256-digest>` with no extension or declared basename. When the same authored input exists locally, `src/providers/inputs.ts` hands the provider the original declared path, such as `assets/narration/take-01.wav`; on a fresh clone it hands over an extensionless digest path instead.

That makes provider behavior depend on whether the source bytes happened to be present beside the stand-in. For multimedia tools, extension is commonly part of format detection or output routing, and the provider request has only `path` and `hash`, not `media`, so the lost type information is not recoverable at the boundary. The blast radius is high because a fresh clone can fail builds that work on the author’s machine. A fix should preserve a stable type-bearing filename when materializing the asset, for example by passing the declared path/basename into the resolver or deriving a safe suffix from the pointer’s media type.

### AUDIT-20260716-28 — `cachedStore.has` is not covered by the cache-integrity contract

Finding-ID: AUDIT-20260716-28
Status:     fixed-bbc4c02
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/assets/store.test.ts:103-136

The corruption test proves `cachedStore.get()` rejects a mismatched cache entry by fetching authoritative bytes from the inner store, but it does not exercise `cachedStore.has()` under the same corrupted-cache condition. That leaves the `AssetStore` existence contract only partially tested: a cache entry filed under an address is not proof that the addressed bytes exist, because the bytes may hash to a different address.

This matters because downstream code can reasonably use `has(address)` as the availability check before deciding whether an asset exists in the store. If `has()` treats any cache file as present without validating its content address, a corrupted local cache can produce a false positive while a later `get()` fails or returns only after contacting an inner store the caller believed was unnecessary. The reasonable fix is to extend the corrupted-cache fixture in lines 103-136 with `has()` assertions, including the case where the inner store does not contain the address, so `has()` and `get()` share the same integrity boundary.

### AUDIT-20260716-29 — Release becomes falsely clean when a followed node is deleted

Finding-ID: AUDIT-20260716-29
Status:     fixed-168f94a
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/state/release.ts:52-57 (with src/state/resolve.ts, `resolveAuthoredNode` followed-absent branch)

`assessRelease` blocks release on `needs-review` and `modified` only. In `resolveAuthoredNode`, an authored node whose own content resolves but whose *followed* node does not resolve is reported as `absent`, not `needs-review` — the FR-022c precedence quoted in the doc comment ("absence outranks needs-review"). `absent` is not in either release-blocking check, and such a node is normally not a declared target (it is an authored script, not a shipped artifact). The composition of those two rules is an escape hatch: an authored node sitting at `needs-review` because a human never accepted the followed node's current content silently stops blocking release the moment the followed node's file is deleted or moved.

The blast radius is exactly the false-clean this module's own comments say it exists to refuse. An unattended agent that finds `pc release-check` blocked by a `needs-review` on `narration` following `outline.md` has a mechanical way to turn the light green that does not involve a human: remove `outline.md`. Nothing else in `resolveStatus` re-raises the question — the tracking node's own bytes are fine, so it is not `absent` for any reason a reader would notice, and `release.ts` never inspects `cause.code`.

A reasonable fix is for `assessRelease` to block on the absence too, since `path-absent` on an authored node with a `follows` is an unanswered human question rather than a benign state; or to distinguish the two absences structurally (the node's own absence vs. its followed node's absence) and block on the latter. Either way, the invariant `release.ts` should encode is "no node carries an unresolved human question," and a followed node that cannot be read is one — the current code encodes "no node is literally in state `needs-review`," which is not the same thing.

### AUDIT-20260716-30 — An authored node whose followed node is missing is reported as `absent` — a claim about the wrong file

Finding-ID: AUDIT-20260716-30
Status:     fixed-168f94a
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/resolve.ts, `resolveAuthoredNode` followed-absent branch (`return report('absent', { code: 'path-absent', message: message.followedAbsent(...) })`)

Control only reaches this branch after `own.kind !== 'absent'` — the node's own declared content resolved. Yet it reports `state: 'absent'` and `code: 'path-absent'` for `node.id`. The state and code describe the *followed* node's condition while being carried on the *tracking* node's status. The `identity` field carries `followed`, and the prose in `message.followedAbsent` names the right file, but a consumer keying on `state`/`code` — which is the entire point of having a machine-readable state alongside FR-007's prose — reads "authored node X is absent" about a node whose bytes are present and readable.

This is the quietly-plausible wrong reading, not an obvious contradiction: `pc status` renders `X: absent`, an agent concludes X needs to be authored, and re-authors or regenerates a file that already exists and is correct. It also directly contradicts the doc comment two lines above it — "`follows` is an OBSERVATION ('is a response to')… It draws no edge, contributes to no staleness" — since here the followed node's absence is the sole determinant of the tracking node's reported state. And it is inconsistent with how the same module treats derived nodes: an input's absence yields `blocked` on the consumer, a state that names the consumer's *situation* rather than borrowing the input's state word.

The fix is to give this case a state that describes the tracking node's actual situation rather than the followed node's — `needs-review` (a human must supply or restore the followed node before the review question can be answered) or a `blocked`-shaped authored state — and a cause code distinct from `path-absent`, which should stay reserved for "this node's own file is not there." That also removes the release escape in AUDIT-BARRAGE-claude-01 as a side effect.

### AUDIT-20260716-31 — `follows` can resolve a graph-valid identity that `resolveStatus` omitted

Finding-ID: AUDIT-20260716-31
Status:     fixed-168f94a
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/state/resolve.ts:291-304

`resolveAuthoredNode` calls `resolver.resolve(followed)` for every authored `follows` edge, assuming the followed identity is present in the built graph. That is not guaranteed by the existing graph contract: validation allows `follows` to name any known identity, while `buildGraph` includes all authored nodes plus only profile targets reachable from `manifest.targets`. A valid authored node can therefore follow a profile target that is known but not in the target closure; `resolver.resolve()` then throws “not a node in this episode's graph” instead of reporting state.

The blast radius is high because a valid production can make `pc status` fail hard from an advisory edge alone. A reasonable fix is to align the boundary: either include `follows` targets in the graph closure used for status, or make graph validation reject `follows` targets that will not be resolvable by this graph.

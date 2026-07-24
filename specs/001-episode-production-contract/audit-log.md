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

## 2026-07-17 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260717-01 — `Case 11b` pins `followed-changed` as the cause for a node where nothing has changed

Finding-ID: AUDIT-20260717-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/state/resolve-validation.test.ts:246-300 (Case 11b), cross-referenced against tests/unit/state/resolve-precedence.test.ts:180-196 (Case 8b)

Case 11b constructs the fresh-install scenario explicitly: both `script.md` and `narration.wav` are written and never touched, `ledger.reviews` is `{}`, and the test's own comment says "nothing has drifted since authoring, because there is no recorded baseline to have drifted FROM." It then asserts `node.cause.code === 'followed-changed'` (line ~298). That cause is factually false in the scenario the test itself describes — `spoken` did not change, and the resolver has no baseline against which it could have observed a change. The `state` verdict of `needs-review` is well-argued and I have no quarrel with it; the *cause* is the defect.

This matters because the cause is the operator-facing explanation surface, not an internal enum — FR-007 requires every node to carry one precisely so `pc explain` can tell an operator *why* a node is in the state it's in. On a fresh install with a `follows` edge, this contract makes the tool say "the node you follow changed" to an operator who has never edited anything. The natural response is to go diffing `script.md` against a prior version that does not exist. This is the quietly-plausible wrong reading the rubric calls out: an unattended agent implementing `resolve.ts` against this test will hardcode `followed-changed` on the no-baseline branch and the wrong message ships without anyone noticing, because the state is right and only the sentence is a lie.

The diff already establishes the right precedent for this exact problem. Case 8b (resolve-precedence.test.ts:180-196) refused to reuse `path-absent` for the "followed node is missing" situation on the grounds that it would be "a claim about `spoken`'s file carried on `tracker`" — and minted a distinct `followed-absent` code instead. The same reasoning applies here: the never-reviewed case is a distinct situation from the drifted case and deserves a distinct code (`never-reviewed` / `no-baseline`). The fix is to add that code to the cause union, assert it in Case 11b, and leave `followed-changed` to Case 11, which genuinely earns it (a recorded `waived_hash` that the current content diverges from).

### AUDIT-20260717-02 — `addressLayout` accepts any digest, including `../` — adapters turn it straight into a path

Finding-ID: AUDIT-20260717-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=reachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/assets/store.ts:64-77

`addressLayout` is documented as the single place the sharding convention lives — "Shared by every `AssetStore` adapter that needs to lay an address out as a path or object key". It validates exactly two things: that a `:` is present, and that the digest is at least two characters. It never checks that the digest is a hex digest, or even that it is free of path separators and dot segments. So `addressLayout('sha256:../../../../etc/passwd')` returns `{ algorithm: 'sha256', digest: '../../../../etc/passwd', shardPrefix: '..' }` and every adapter that joins `shardPrefix` and `digest` into a filesystem path or an object key inherits a traversal.

This is reachable from untrusted input, which is what makes it more than theoretical. Addresses arrive from `.asset` stand-ins, and stand-ins are the half of an asset that is *committed to git* — a cloned repo can carry an attacker-authored stand-in whose `asset:` field is any string that passes the pointer schema. `pc status` resolving that stand-in through the local cache decorator, or `pc build` fetching it, hands the digest to whatever adapter lays out paths. The feature already treats this class as load-bearing (`tests/integration/path-safety.test.ts` exists in a sibling chunk), but the check lives downstream of the one function that is supposed to own the layout.

The fix belongs here rather than in each adapter, since centralizing the convention is the function's stated reason to exist: validate the digest against `/^[0-9a-f]{2,}$/` (and the algorithm against a known-algorithms list) and throw naming the address when it fails, the same way the missing-prefix and short-digest cases already do. Blast radius if shipped as-is: an adopter who clones a repo containing a hostile stand-in gets file reads or writes outside the cache root, from a verb the design explicitly advertises as safe to run offline against untrusted content.

### AUDIT-20260717-03 — The `unlink` gate trusts `store.has()`, but the interface never says `has` means "durably held"

Finding-ID: AUDIT-20260717-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/asset.ts:243-252; src/assets/store.ts:38

`assetAddCommand` removes the user's only local copy of the bytes on the strength of one predicate: `if (!(await store.has(address))) { throw }` then `await fs.unlink(file)`. The comment above it claims this makes the delete "provably a move into the store and never a delete-before-confirm." That proof holds only if `has` means "this store durably holds these bytes." The `AssetStore` interface documents `has` as, in full, "Whether the address exists in the store" (`store.ts:38`) — which is precisely the ambiguity that matters for the decorator this codebase actually ships.

For `cachedStore`, "exists in the store" has two defensible readings: the address is in the local cache, or the address is in the backing remote. If `has` short-circuits on a local cache hit — the obvious implementation, and the one that makes the cache worth having — then `pc asset add` against a cache whose backing S3 write silently failed will see `has → true` from the local copy and `fs.unlink` the original. The bytes now live only in a cache directory, which is by definition prunable, and the stand-in in git points at an address the remote does not hold. That is the exact "fabricated record" failure `reAddOrMissing` is written to catch, arrived at from the other direction. `store.ts:24-26` even acknowledges the cache decorator as a first-class implementation that must satisfy "this exact shape," so the shape is where the durability semantics have to be stated.

The fix is to make the contract say what the delete gate needs: either document `has` as "the address is durably held by the backing store, not merely cached locally" and require decorators to honor that (a cache `has` then consults the remote, or is bypassed on this path), or give the interface a distinct durability predicate and have `asset.ts` call that one before unlinking. Either way the invariant should be written down in `store.ts`, not inferred by a caller. Blast radius: irrecoverable loss of the source bytes for a large binary asset, with a committed stand-in that looks correct and only fails at a later `pc build` on a different machine.

### AUDIT-20260717-04 — `asset add` can delete the only good local copy based on key existence, not byte integrity

Finding-ID: AUDIT-20260717-04
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/asset.ts:230-270

`assetAddCommand` treats `store.has(address)` as durable proof that the store holds the exact bytes before removing the local original. On the already-present path, lines 230-241 skip `put()` entirely when `has(address)` returns true, and lines 263-270 then check `has(address)` again before `fs.unlink(file)`. The real S3 adapter’s `has()` is a HEAD-style existence check, while byte verification is only performed by `get()`, so a corrupted/truncated object at the content-address key still causes this command to remove the local source bytes.

The blast radius is high because this is a data-loss path a normal operator can hit: if the remote store reports the key exists but the object content is bad, `pc asset add` deletes the only known-good working-tree file and leaves a stand-in pointing at unusable bytes. A reasonable fix is to require content verification before unlinking on the `alreadyStored` path, e.g. fetch and `assertAddressMatches(address, fetched)` before removing the original, or strengthen the store contract so `has()` means verified availability rather than key presence.

### AUDIT-20260717-05 — `PC_REQUIRE_DOCKER=0` turns the gate ON, not off

Finding-ID: AUDIT-20260717-05
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/s3-store.test.ts:35-36

The gate reads `process.env.PC_REQUIRE_DOCKER !== undefined && process.env.PC_REQUIRE_DOCKER !== ''`. Every non-empty value enables it, including the values an operator reaches for first to *disable* a boolean env flag: `PC_REQUIRE_DOCKER=0`, `=false`, `=no`. A developer on a Docker-less laptop who reads the banner ("Set PC_REQUIRE_DOCKER=1 (CI does) to turn this skip into a hard failure") and reasonably infers the inverse — export `PC_REQUIRE_DOCKER=0` in their shell profile to opt out — gets the opposite: a hard red suite on every run, with an error message that says the environment demanded the proof. The failure text ("unset PC_REQUIRE_DOCKER if this environment genuinely cannot run it") is the only place the truth is stated, and it is buried inside the failure it causes.

Blast radius: a consumer acting on the surface as written gets an inverted control. The likely reaction to a mystery red suite is to stop running the contract tests, or to delete the gate — which reopens exactly the false-clean the gate exists to close. A fix is to parse the value rather than test emptiness: treat `1`/`true`/`yes` (case-insensitive) as on, `0`/`false`/`no`/`''` as off, and throw on an unrecognized value so a typo is loud rather than silently-on.

### AUDIT-20260717-06 — Escape-channel enumeration is incomplete: only `../` is fixtured, and the two channels that defeat naive containment are not

Finding-ID: AUDIT-20260717-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/path-safety.test.ts:70-99 (`runnerEmitting`, the escaping-output test)

This file exists to be the defense-in-depth guard for the `ingest` containment assertion (AUDIT-20260716-15/-16, FR-036) — its own header says the schema guards the wire and "the assertion guards the composition." But the suite exercises exactly one escape channel: `runnerEmitting('../evil.txt')`, a plain parent traversal. That is the one channel that *every* plausible containment implementation catches. The channels that actually defeat the common wrong implementations are absent:

The **prefix-sibling channel**: a containment check written as `full.startsWith(path.join(episodeDir, 'dist'))` — the single most common way this is gotten wrong — returns `true` for `<dir>/dist-evil/x.txt`. A runner declaring `../dist-evil/x.txt` escapes `dist/` while passing that check, and passes this test file too, because this file never sends that input. The correct implementation (`path.relative(distDir, full)` not starting with `..` and not absolute, or comparing against `distDir + path.sep`) and the broken one are indistinguishable under the current fixtures. The **symlink channel**: if `dist/link` is a symlink out of the episode, `path.join(episodeDir,'dist','link/evil.txt')` is textually contained, every string-level check passes, and the write follows the link out of the tree. The **absolute-path channel** is also unfixtured: `outputs: [{path: '/tmp/evil.txt'}]` is neutralized by `path.join` but escapes entirely under `path.resolve`, and nothing here pins which one `ingest` uses.

Blast radius: this is the test that licenses the claim "ingest cannot write outside dist even when a runner hands it a traversing path." As written it licenses a weaker claim — "ingest catches a leading `..`." A future refactor of the containment check to a `startsWith` form ships green with a live path-traversal write primitive, which is precisely the finding this file was added to close. The fix is three more `runnerEmitting` cases in the existing `describe`: `'../dist-evil/x.txt'`, an absolute path, and a case where `dist/link` is pre-created as a symlink to a directory outside `dir`, each asserting the same refuse-and-no-file-written triple.

### AUDIT-20260717-07 — Ingest escape test leaves the runner-side escape unasserted

Finding-ID: AUDIT-20260717-07
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/path-safety.test.ts:55-57, tests/integration/path-safety.test.ts:125-127

`runnerEmitting('../evil.txt')` resolves the declared path against `request.output_dir`, so with `output_dir = <episode>/dist/.pc-build-voiceover`, the fake runner writes `<episode>/dist/evil.txt` before `buildTarget` reaches the ingest guard. The test then checks only `<episode>/evil.txt`, which is the would-be final destination if `stage()` copied the output, not the file the runner already escaped into `dist/`.

That means the test can pass while the build leaves an unrecorded visible file under `dist/`, exactly the kind of half-produced artifact the build path says it must not leave behind. Blast radius is high because this is a safety regression in the defense-in-depth fixture: a future in-process runner could bypass subprocess containment, get refused by ingest, and still leave undeclared output bytes in the episode’s artifact area with no ledger record.

A reasonable fix is to assert the runner-side escape path too, e.g. `<episode>/dist/evil.txt`, and either make `buildTarget` clean escaped scratch outputs or move the containment check before hashing/using `path.resolve(request.output_dir, output.path)` for untrusted in-process responses.

### AUDIT-20260717-08 — `resolveToLocalPath` joins an unvalidated `filename` into the destination path

Finding-ID: AUDIT-20260717-08 (claude-01 + claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/assets/resolve.ts:96-107

`destination` is built as `path.join(destDir, addressLayout(address).digest, filename)` where `filename` is an arbitrary caller-supplied string. The interface doc constrains it by convention only — "the basename of the authored declaration, e.g. `take-01.wav`" — and nothing in this function enforces that. `path.join` resolves `..` segments, so a declaration whose basename is `../../../etc/cron.d/x` (or an absolute path, which `path.join` will not treat as absolute but which still contains separators) escapes the digest directory that the doc block claims "can never collide with a different asset." The `fs.mkdir(digestDir, { recursive: true })` on line 105 creates only the digest dir, so the escape then writes into whatever ancestor exists. An empty `filename` degenerates to `destination === digestDir`, and `writeFile` onto a directory fails with an opaque `EISDIR` rather than a named refusal.

The blast radius: this is the one function on the fetch side of the provider boundary, and its input traces back to manifest-authored strings. An adopter who clones a repo and runs `pc build` is executing a write whose path is a function of a checked-in YAML field. Even if today's only caller happens to pass `path.basename(...)`, the invariant lives in a comment in a different module, so the next caller — or an agent adding one — has nothing stopping it. Note this module already imports the `assertAddressMatches` pattern for exactly this reasoning ("the store is an untrusted boundary"); the same skepticism is not applied to the path input.

A reasonable fix is to assert the invariant at the boundary that depends on it: refuse when `filename !== path.basename(filename)`, when it is empty, or when it is `.`/`..`, naming the offending declaration. This chunk cannot see `tests/integration/path-safety.test.ts`; if that fixture covers the caller rather than this function, the guard is still missing here.

### AUDIT-20260717-09 — `fresh + validated` exclusion is pinned only for `'passed'` — the `'failed'` value channel is unfixtured, and the test title asserts the broader contract

Finding-ID: AUDIT-20260717-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/state/frontier.test.ts:96-100

The `validated` field is typed `'passed' | 'failed'` (declared at lines 15-19 in the `node` helper's `options` parameter). The suite exercises exactly two of the three points in the `fresh × validated` space: `validated: undefined` → `validate` (lines 90-95), and `validated: 'passed'` → excluded (lines 96-100). The third point — `fresh` with `validated: 'failed'` — has no fixture anywhere in this chunk.

This matters because the test's own title generalizes past what it proves: `'fresh + validated is absent from the frontier'` names the *presence* of `validated`, not the value `'passed'`. If `frontier` is implemented as a presence check (`node.validated !== undefined` → exclude) rather than a value check (`node.validated === 'passed'` → exclude), this suite is green and a node whose validation **failed** silently drops off the actionable frontier. Blast radius: FR-011's frontier is the surface an operator (or an unattended agent driving `pc next`) reads to decide what is left to do. A fresh node with a recorded validation failure that reports nothing-to-do is precisely the shipping-a-broken-artifact outcome the frontier exists to prevent, and no other assertion in this file would catch it. Note the suite does test `state: 'invalid'` → `rebuild` (lines 74-79), which suggests the intended encoding of a failed validation is the `invalid` state — but if that is the design, then `fresh + validated: 'failed'` is an unrepresentable combination and the type should exclude it rather than leave it constructible-and-untested.

Fix: add `it('fresh + validated failed -> rebuild')` (or whatever the contract dictates) pinning the third point, and rename the existing case to `'fresh + validated passed is absent from the frontier'` so the title matches the fixture. If `fresh + failed` is genuinely unreachable, narrow the type so the compiler enforces that rather than leaving the reader to infer it.

---

### AUDIT-20260717-10 — Derived directory artifacts are unresolvable — `isFile` refuses them with a remedy that can never work

Finding-ID: AUDIT-20260717-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/inputs.ts:283-300 (`resolveDerivedInput`, `isFile`)

`resolveAuthoredInput` deliberately handles the directory case — its final branch calls `hashPath(fullPath)` and the comment explicitly reasons about what "the provider receives for a directory input" (inputs.ts:230-236). `resolveDerivedInput` does not: it gates on `isFile(fullPath)` and hashes with `hashFile`. Nothing in `BuildOutputSchema` (contract.ts:47-49) constrains an output to be a file — `RelativePathSchema` refuses absolute and traversing paths, not directories — so a provider may legitimately declare a directory output (an HLS ladder, an image sequence, a frames dump), and the graph may legitimately declare that node as another node's input.

The blast radius is a refusal whose stated remedy is a no-op loop. When the upstream artifact is a directory, `isFile` returns false and the operator is told the artifact "is not present at `<path>` on this machine (`dist/` is not committed). Build `<node>` to produce it" (inputs.ts:294-298) — but it *was* built, it *is* present, and rebuilding produces the same directory and the same refusal. An unattended agent reading that message rebuilds the upstream, sees success, retries the downstream, and gets the identical error forever. This is worse than a bare failure because the refusal actively asserts a false fact about the filesystem.

The fix is to make the derived branch ask the same question the authored branch asks: replace `isFile` with an existence check that admits directories, and hash with `hashPath` rather than `hashFile`, so `pc build` cannot answer "what is at this path" differently depending on which side of the authored/derived split it is looking at. If directory outputs are genuinely out of scope, that invariant belongs in `BuildOutputSchema` as a refusal at ingest — not as a downstream error that misdescribes disk.

### AUDIT-20260717-11 — `BuildResponseSchema` accepts duplicate output paths

Finding-ID: AUDIT-20260717-11 (claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/contract.ts:91-99

`outputs` is `z.array(BuildOutputSchema).min(1, ...)` with no uniqueness constraint, so a provider may declare the same relative path twice and the schema parses it as a valid response. The file's own reasoning argues that a refusal of this class belongs in the schema rather than in "a caller who might forget to check" (contract.ts:86-90, for the empty-outputs case), and duplicate declarations are the same shape of defect: a claim about what was produced that the response cannot actually mean.

Downstream, whatever ingests these hashes the same file twice and records it twice — a ledger with two entries for one artifact, or one entry silently clobbering the other depending on how ingest folds the list. Neither is wrong in a way a reader would notice, which is why it is worth refusing at the boundary rather than discovering later from a ledger that double-counts. Blast radius is small because the duplicate is most likely a provider bug that produces identical entries, and the recorded hashes agree — but the ledger is the artifact this system exists to keep honest.

A `.refine` on the array checking distinct `path` values, refusing with the offending path named per FR-036, matches the existing style of the file.

Notes on what I checked and found clean, for triage weight: the `impure` trimmed-reason refinement (contract.ts:80-84) does refuse `"   "` and `impure: false` correctly, and matches the stated `WaiverSchema` symmetry; `version: z.literal(1)` refuses unknown versions in both directions; the observed-hash-over-claimed-address checks in both pointer branches (inputs.ts:150-160, 165-176) are genuinely symmetric and do not trust the resolver; the dangling-input branch (inputs.ts:98-108) correctly frames itself as a programming error rather than an operator mistake; and I found no fallbacks, swallowed exceptions (the `catch` in `isFile` is a legitimate stat-to-boolean), placeholder comments, or deferral phrases in either file.

### AUDIT-20260717-12 — `pc` resolves git-tracked status against `process.cwd()`, not the asset's own repository

Finding-ID: AUDIT-20260717-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/assets/git-tracked.ts:18-28

`gitTrackedCheck().isTracked()` calls `execFileAsync('git', ['ls-files', '--error-unmatch', absolutePath])` with no `cwd` option, so the child `git` inherits whatever directory the `pc` process happens to have been started in. `git ls-files` resolves the repository from its own working directory, not from the argument path. If the operator runs `pc` from `~/` (no repo), from a different repo, or from anywhere outside the episode's worktree, `git` exits non-zero — "not a git repository", or "path is outside repository" — and the `catch {}` on line 24 converts that into `return false`, i.e. "untracked".

The blast radius is that the tracked check silently produces the wrong answer for a file that genuinely *is* tracked, and it does so as a function of the caller's shell cwd rather than of anything about the asset. Every consumer of `TrackedCheck` (the tracked-guard path exercised by `tests/integration/tracked-guard.test.ts`) then takes the untracked branch. Because `false` is also the correct answer for a genuinely untracked file, nothing downstream can distinguish the two, and no test that runs with cwd inside the repo will ever catch it — the failure only appears in real operator use.

The fix is one option: `execFileAsync('git', ['ls-files', '--error-unmatch', '--', absolutePath], { cwd: path.dirname(absolutePath) })`. The `--` separator is worth adding at the same time so a path beginning with `-` is not parsed as a flag. A fixture that runs the check with `process.cwd()` set outside the repo would pin the behavior.

### AUDIT-20260717-13 — A cache-write failure turns a successful store read into a hard error

Finding-ID: AUDIT-20260717-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/cache.ts:47-51, 64-66, 71-79

`get()` is documented as a read-through cache whose inner store is the source of truth, and it deliberately makes a *corrupt* cache entry non-fatal (lines 57-62: "a corrupt cache entry is a cache MISS, not a fatal error"). But `writeCacheFile` on line 65 is awaited unguarded, so any failure to *populate* the cache — `ENOSPC`, `EACCES` on a read-only or root-owned `.production/cache/`, `EROFS`, `EMFILE` — rejects `get()` after `inner.get(address)` has already returned the authoritative bytes. The same shape sits in `put()` on line 76: the asset is durably in the store, `inner.put` returned its address, and then the cache write throws and the caller sees `put()` fail. The identical hole exists on the read side at line 38, where `readCacheFile` rethrows every non-`ENOENT` errno — an `EACCES` or `EISDIR` on a cache file is fatal rather than a miss.

This is the module contradicting its own stated invariant. The invariant is "the cache is an accelerator; the inner store is the source of truth," and the corrupt-entry path honors it while all three I/O paths violate it. The consequence for an adopter is that a cache directory the process cannot write — a container with a read-only volume, a full disk, a directory left root-owned by a previous `sudo` run — makes every `pc build` fail with an I/O error, even though the store is reachable and the bytes are in hand. That reads as "the asset store is broken" when nothing about the store is broken. A `put()` failure is worse still: the caller may retry an upload that already succeeded, or report to the operator that an asset was not stored when it was.

A reasonable fix is to make cache population best-effort in all three places — wrap `writeCacheFile` in try/catch at both call sites and let `readCacheFile` treat every errno as a miss — while surfacing the failure once on stderr rather than silently (see finding 03). Note this must *not* extend to `assertAddressMatches`: a hash mismatch on bytes returned from `inner` is a genuine integrity failure and must stay fatal.

### AUDIT-20260717-14 — `gitTrackedCheck()` reports tracked files as untracked when `pc` is launched outside the repo

Finding-ID: AUDIT-20260717-14
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/git-tracked.ts:18-27

`gitTrackedCheck().isTracked()` accepts an absolute path, but runs `git ls-files --error-unmatch <absolutePath>` without setting `cwd` or using `git -C`/`--work-tree`. That means the answer depends on the process working directory, not on the path being checked. From inside the repository, the command reports tracked files correctly; from outside any repository, the same absolute tracked path fails with “not a git repository” and this implementation catches it as `false`.

This matters because `pc build` and `pc validate` inject this check for FR-026’s large-file guard. A valid git-tracked oversized authored file can be falsely treated as untracked when the operator invokes `pc --episode /path/to/episode ...` from another directory, causing a refusal that tells them to run `pc asset add` even though the file is already tracked. The blast radius is high: consumers hit an incorrect build/validate refusal in normal CLI usage, and the failure mode looks like a production-content problem rather than a cwd-sensitive implementation bug. A reasonable fix is to derive the containing git worktree for the absolute path, or run git with an explicit `cwd`/`-C` rooted at the episode/repo before calling `ls-files`; add a test that checks a known tracked absolute path while the process cwd is outside the repo.

### AUDIT-20260717-15 — The rebuild half of the independence proof never invokes the real builder

Finding-ID: AUDIT-20260717-15
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/dual-signal.test.ts:43-77, 104-107

The file's stated purpose is that "rebuilding the derived output MUST NOT clear the review" (describe block at line 148). But `rebuildTranscript` (line 105) does not run `pc build` — it calls `recordTranscriptBuild`, which hand-writes an `artifacts.transcript` record via `readLedger`/`writeLedger` (lines 57-76). The waiver half of the same file *does* go through the real CLI (`waiveNarration`, line 110, shells out to `pc review --waive`). So the two directions of the independence claim are tested against asymmetric subjects: one against production code, one against a test-local simulation of production code.

The consequence is precisely the failure the file's header says it exists to catch. If the real `pc build` implementation clears or rewrites `ledger.reviews.narration` — the cheapest, most natural-looking implementation of "resolve the drift", per the header comment at lines 31-37 — every assertion here still passes, because the hand-written ledger mutation in `recordTranscriptBuild` spreads `...ledger` (line 68) and therefore preserves `reviews` unconditionally, by construction. The test cannot fail in the direction it was written to protect. The assertion at line 175 ("rebuilding the transcript cleared narration's review") is testing the spread operator on line 68, not the builder.

The justification comment at lines 45-47 — "the ledger write a real `pc build` will perform in Milestone 2, done by hand because Milestone 1 has no builder" — is stale as of this audited range: commit `0248ef7` ("pc build, pc validate, producer drift: the execution layer") shipped the builder inside the same range. The fix is to drive `pc build` through the CLI the way `waiveNarration` drives `pc review`, and delete `recordTranscriptBuild` from the rebuild path. `recordTranscriptBuild` is defensible for *seeding* the initial clean state in `buildDualSignalEpisode` (line 84), where it is arranging a precondition rather than exercising the behavior under test; it is not defensible as the act whose independence is being asserted.

### AUDIT-20260717-16 — The contrast test cannot fail on the regression it exists to catch — `pc status` has no store to probe

Finding-ID: AUDIT-20260717-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unreachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/asset-absent.test.ts:232-277 (the `THE CONTRAST` describe)

The file's header doc makes a strong claim: this is "a regression test rather than two unrelated facts," and specifically that "someone adding a reachability probe to status would still pass a test that only checked the build's refusal." But the first half of the contrast runs `pc(['status', '--episode', episodeDir, '--json'])` as a **separate process**, and the test's own comment concedes the reason: "with no store wired into it at all — because there is no seam to wire one into." The `MemoryAssetStore` that was seeded and then severed is an in-process object the `pc` subprocess never sees. The only two guards on the status half are `expect(status.code).toBe(0)` and `expect(status.stdout).not.toMatch(/store|network|unreachable|fetch/i)`.

Neither guard detects the regression. If someone adds a reachability probe to `pc status`, whether it fails depends entirely on whether the `asset` fixture's `episode.yaml` declares a store endpoint that is actually unroutable at test time. If the fixture declares no store (which the `MemoryAssetStore` injection pattern strongly suggests — the whole point is that nothing real is configured), the probe short-circuits as a no-op, status still exits 0, still says nothing about a store, and the test stays green through exactly the change it advertises catching. The stdout regex is a second-order proxy at best: it detects a probe that *reports* its result, not a probe that *makes a request* — and the FR-025 violation is the request, not the reporting. The regex is also unanchored and over-broad against a JSON payload; `/store/i` matches `restore`, `datastore`, any target or artifact name containing the substring, so it is simultaneously unable to catch the real thing and able to fail spuriously.

Blast-radius: this is the file's headline invariant and the sharpest edge in the asset design per its own framing. A consumer reading the suite will believe FR-025 (offline oracle) is regression-guarded when it is not, and will not add the guard that would actually hold it — so the first offline-breaking probe ships silently, and an unreachable bucket makes a whole production unreportable, the exact failure content addressing exists to prevent. A fix needs a channel the subprocess can actually observe: point the fixture (or a copied variant) at a store endpoint that is guaranteed unroutable with a short connect timeout, so any probe deterministically errors or hangs and turns the status half red; alternatively expose the probe count through a test-visible signal the subprocess emits. Until one of those exists, the doc comment's regression claim overstates what the code asserts.

---

### AUDIT-20260717-17 — The output-path refinement is only fixture-covered for *leading* `../` — embedded traversal (`sub/../../evil`) has no test

Finding-ID: AUDIT-20260717-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/contract/provider-by-hand.test.ts:113-127 (and the `parseBuildResponse` case at :159-179)

The new refinement on `BuildOutputSchema` is the security boundary the diff's own comment (lines 100-108) says both the runner (`path.resolve(output_dir, path)`) and `ingest` (`path.join(episodeDir, 'dist', path)`) trust to keep a provider-declared output inside `output_dir`. The fixtures accept `'podcast.out'` and `'sub/dir/podcast.out'`, and refuse `'../../../.ssh/authorized_keys'` and `'/etc/cron.d/evil'`. Every refused case starts with `..` or `/`. This is exactly the channel-enumeration trap: the fix was accepted on the one example it fixes, and the **value channel** it leaves open is untested.

The dangerous residue is a path that does not *begin* with `..` but still normalizes outside `output_dir`: `sub/../../evil.txt`, `./../../evil.txt`, or `a/b/../../../evil.txt`. If the refinement is implemented as a `startsWith('..') || isAbsolute(...)` string check rather than a `path.relative(output_dir, path.resolve(output_dir, p))` containment check, all three pass the schema and then escape at `path.resolve` in the runner and at `path.join(episodeDir, 'dist', path)` in `ingest` — precisely the composition the comment claims is now safe. Also unfixtured: the empty string (`{path: ''}`, which resolves to `output_dir` itself and would make the declared-output existence check assert on a directory), a bare `'.'`, and a NUL-embedded path.

Blast radius: a malicious or buggy provider writing outside the episode tree, which is the entire threat model this refinement was added for, with a test file that reads as though it were covered. Fix: add fixtures for `sub/../../evil.txt`, `./../evil.txt`, `''`, and `'.'` to the `BuildOutputSchema` describe block, and — if any of them currently pass — change the refinement to a resolve-and-contain check rather than a prefix check.

---

### AUDIT-20260717-18 — The `failed` verdict — the gate's whole reason to exist — is never exercised

Finding-ID: AUDIT-20260717-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/validate.test.ts:21-31, 96-140

`ValidateJsonSchema` (line 27) declares three reachable states: `passed`, `failed`, `unresolved`. The suite exercises `passed` (line 60, happy path) and `unresolved` three times (never-built at line 112, provider-crash at line 128, impure-rebuild at line 150). **No test ever produces `failed`** — a provider that runs to completion, obtains a verdict, and reports the artifact invalid. `withMode('fail')` (line 44) does not fill this hole: the test at line 137 asserts the outcome is `unresolved`, which is by construction the *provider crashed* path, not the *provider said no* path. The fake provider evidently has no mode that exits 0 while returning a negative verdict.

This is the one path the command exists for. `pc validate` is described in the file's own header as "A GATE: 0 only when every requested target passed, 1 otherwise (FR-035)." Every test that reaches exit 1 does so via a state where *no verdict was obtainable*. The transition that actually gates a release — verdict obtained, verdict is negative, record it as `failed`, exit 1 — is verified by nothing. Blast radius: if `src/cli/validate.ts` mishandles a negative verdict (records `passed`, records nothing, or exits 0), this suite is green and CI is green, and a consumer wiring `pc validate` into a release gate ships an artifact the provider explicitly rejected. That is a silent false-negative on the primary safety surface, and it is exactly the class of bug an integration suite is supposed to be the last line against.

A reasonable fix: add a `FAKE_PROVIDER_MODE=invalid` mode that exits 0 and emits a negative verdict, then assert `code === 1`, `answer.targets[0].state === 'failed'`, a non-null `detail`, and — critically — that the ledger records `validation.state === 'failed'` rather than leaving it absent (FR-006b's other half: failed is not absent).

---

### AUDIT-20260717-19 — "validates every declared target when none is named" is vacuous — the fixture has exactly one target

Finding-ID: AUDIT-20260717-19
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/validate.test.ts:34-52, 96-103

The `episode()` helper deliberately narrows the fixture to a single target: the profile declares only `voiceover` (line 39), and line 47 rewrites the manifest from `targets: [voiceover, podcast]` to `targets: [voiceover]`. Its docstring is explicit about why — "so `pc validate` with no argument has exactly one thing to do."

The test at line 96 then builds on that one-target episode and asserts `targets` has length 1. With N=1, "validates *every* declared target" is indistinguishable from "validates the first declared target," "validates an arbitrary declared target," or "validates only targets that happen to have records." The assertion `toHaveLength(1)` is satisfied by all four implementations, including the three wrong ones. The test's name states a plural contract; its fixture makes the plural unobservable.

The same N=1 collapse takes out FR-035's quantifier. "0 only when **every** requested target passed" contains an implicit conjunction, and a conjunction over a single element is just that element — so the fold is never exercised. An implementation that returns the *last* target's state as the exit code, or that `||`s where it should `&&`, passes this entire suite. Blast radius: the no-argument form is the natural CI invocation (`pc validate` in a release job). A consumer with three targets, two green and one never built, could get exit 0 from a broken fold and ship. Nothing here would have caught it, and the green test named "validates every declared target" would actively mislead the next reader into believing it had been.

Fix: keep the multi-target manifest (drop the line-47 rewrite, or add a second `episode()` variant that retains `podcast`), build only one of the two, and assert the no-arg run reports both targets, marks the unbuilt one `unresolved`, and exits 1. That single test restores both the "every" of the enumeration and the "every" of the fold.

---

### AUDIT-20260717-20 — Memoized resolver over a mutable ledger returns stale derived hashes if it outlives a build

Finding-ID: AUDIT-20260717-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/identity.ts:98-130 (`createContentResolver`, `resolveDerivedNode`)

`createContentResolver` memoizes `resolve(id)` for the lifetime of the resolver instance, and the header justifies that with "resolution is a pure read, so a cached answer and a recomputed one are the same answer" (lines 88-96). That justification holds only for the oracle path. For a derived identity, `resolveDerivedNode` (line 172-178) reads `context.ledger.artifacts[node.id].output.hash` — a value that a *build* mutates. The `ResolutionContext` holds the `Ledger` by reference, so the underlying record can change, but a memoized `Promise<ContentResolution>` cannot: once voiceover has been resolved (say, to answer a status question or to hash it as an input of an earlier node), a later `resolve('voiceover')` in the same resolver returns the pre-build hash forever.

The blast radius depends on whether `providers/inputs.ts` / `providers/build.ts` construct a resolver per node or share one across a multi-node build. If shared, a build of `voiceover` followed by a build of `podcast` records podcast's `inputs.voiceover` as voiceover's *old* hash. That is worse than a crash: podcast's ledger record is now internally consistent and will be compared against voiceover's *new* `output.hash`, so podcast reports `stale` immediately after a successful build of both — or, if the resolver is also what wrote voiceover's new record, the two can agree on a hash that no build ever used. Either way an unattended agent chasing "why is podcast stale after I just built it" has no signal pointing at the cache. The memo is invisible in the recorded output.

The fix is to make the invariant explicit rather than implicit: either key the memo on something that changes when the ledger changes (record generation counter / ledger identity), skip the memo for `kind === 'derived'` (its cost is a map lookup, not a hash — the memo's stated justification, "rehashing its bytes once per consumer", applies *only* to the authored branch), or document and enforce that a resolver is single-use per ledger snapshot and construct a fresh one after any ledger write. The second is cleanest and costs nothing: the expensive path is `hashPath` on authored bytes, and that is exactly the branch where the ledger is not read.

---

### AUDIT-20260717-21 — Ledger output paths are still trusted when state reads built bytes

Finding-ID: AUDIT-20260717-21
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/state/identity.ts:203-206; missing guard in src/ledger/schema.ts:45-47

`readOutputBytesUncached` takes the persisted `record.output.path` from the ledger and joins it directly under `episodeDir` before hashing it. But the ledger schema still accepts `output.path: z.string()` with no `RelativePathSchema` containment check, so a hand-authored or upgraded ledger can carry `../outside/file` and the state oracle will read and hash bytes outside the episode boundary. The provider response path was tightened elsewhere with `RelativePathSchema`, but that only protects newly produced records; it does not protect the persisted ledger boundary that `readLedger()` accepts as valid.

The blast radius is high because downstream release/status decisions can be made from an artifact path outside the episode, while the report still names it as the node’s recorded output. A reasonable fix is to make ledger `output.path` use the same relative-path invariant, likely with an additional `dist/` containment rule if ledger outputs are only valid under `dist`, and add a schema test that `../...`, absolute paths, and backslash-bearing paths are refused before `state/identity.ts` can consume them.

### AUDIT-20260717-22 — Text-only fixtures cannot catch binary asset corruption

Finding-ID: AUDIT-20260717-22
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/asset.test.ts:81-85

`fileWith` always writes `contents` as a UTF-8 string, and every expected hash is computed from `Buffer.from(contents, 'utf8')`. That means this integration suite never exercises true media bytes such as invalid UTF-8, NUL-heavy binary payloads, PNG headers, or arbitrary audio data. Even the “embedded bytes” case at lines 135-147 is still a JavaScript string encoded as UTF-8.

The feature is specifically about storing media assets safely by content address. A downstream implementation that accidentally reads/writes assets through text encoding, normalizes bytes, or corrupts non-UTF-8 media could still pass this entire file. Blast radius is high because the suite would certify the central safety property while missing the class of corruption real users hit with audio/image assets. A reasonable fix is to add Buffer-based fixture helpers and at least one non-text binary payload whose hash and retrieved store bytes are asserted byte-for-byte.

### AUDIT-20260717-23 — `never reviewed` is reported under the `followed-changed` cause code, so consumers cannot distinguish "no baseline" from "waiver superseded"

Finding-ID: AUDIT-20260717-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/resolve.ts:333-352 (the `reviewStatus` no-baseline branch), with the `Cause['code']` union at src/state/resolve.ts:35-46

`reviewStatus` handles two genuinely different situations and collapses them onto one machine-readable code. When `ledger.reviews[id]?.waived_hash` is `undefined` — nobody has ever accepted this node against the one it follows — the branch returns `code: 'followed-changed'` with `message.neverReviewed(...)`. When a baseline exists but no longer matches, it returns the same `code: 'followed-changed'` with `message.followedChanged(...)`. Only the human-prose `message` differs; the structural field an agent actually switches on is identical.

This contradicts the file's own stated contract twice over. The `Cause` doc at line 33-35 says the cause exists "so an agent reads a fact instead of guessing from a state word" — but here the fact is only recoverable by parsing the message string, which is exactly the guessing the type was introduced to eliminate. And `code: 'followed-changed'` is not merely under-specific, it is false: in the no-baseline case nothing changed. An unattended consumer building on this — a CLI that renders "the followed node changed since you approved it", or a release gate that treats `followed-changed` as "re-confirm the delta" versus a never-reviewed node that needs a *first* review — will emit or act on a statement that is not true of the ledger. That is the quietly-plausible wrong reading the rubric rates `high`: the code compiles, the state word (`needs-review`) is right, and the lie is only in the field a machine reads.

The fix is to widen the union with a distinct code — `'never-reviewed'` — and return it from the `baseline === undefined` branch, leaving `'followed-changed'` to mean what it says. The message helpers are already distinct (`message.neverReviewed` vs `message.followedChanged`), so the distinction exists in the implementation and is merely being thrown away at the structural boundary. Any exhaustive `switch` over `Cause['code']` in the CLI layer (`src/cli/explain.ts`, `src/cli/release-check.ts`) will surface as a typecheck failure and force the new branch to be handled, which is the desired forcing function.

### AUDIT-20260717-24 — A provider can get bytes from outside `output_dir` recorded, via a symlink the containment check doesn't see

Finding-ID: AUDIT-20260717-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/run.ts:236-268 (containment + `isFile`), src/providers/run.ts:290-300 (`listFilesRelative`), src/providers/invoke.ts:76-83 (`hashFile`)

The containment guard added in `assertOutputsAgreeWithDisk` validates the declared *path string* — `path.relative(request.output_dir, absolute)` must not start with `..` — and then `isFile(absolute)` calls `fs.stat`, which **follows symlinks**. So a provider that writes `output_dir/master.wav` as a symlink to `/etc/passwd` (or, more plausibly, to a previous run's artifact, or to a file the operator did not intend to ship) passes the string check because the declared path is genuinely inside `output_dir`, and passes the existence check because `stat` resolves through the link. `invokeProvider` then calls `hashFile(fullPath)` at src/providers/invoke.ts:82, which follows the link too — so the ledger records a hash of bytes that were never produced in the throwaway directory. That defeats the module's stated reason for existing ("a hash computed here from the bytes on disk is an observation").

The second direction is worse for the Rule-5 half. `listFilesRelative` filters on `entry.isFile()` from `readdir(..., {withFileTypes: true, recursive: true})`, and a `Dirent` for a symlink reports `isSymbolicLink() === true` / `isFile() === false`. An **undeclared** symlink is therefore invisible to the undeclared-file walk, and Node's recursive `readdir` does not descend through symlinked directories — so a provider can drop a symlink to a directory of undeclared files in `output_dir` and the reconciliation reports clean. Blast radius: the "production-control hashes the outputs itself" invariant, which the whole ledger's honesty rests on, is bypassable by a provider without any traversing path declaration; a downstream `pc validate` hash comparison would then compare against those foreign bytes and agree.

Fix: use `fs.lstat` for the declared-output existence check and refuse anything that is not a regular file (`stats.isSymbolicLink()` → error naming the path), and in `listFilesRelative` treat any non-directory entry (not just `isFile()`) as present-in-`output_dir`, so an undeclared symlink surfaces as an undeclared file rather than vanishing.

### AUDIT-20260717-25 — `readEntries` swallows every readdir error, silently making the undeclared-output check vacuous

Finding-ID: AUDIT-20260717-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/run.ts:305-312

```ts
async function readEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
}
```

The doc comment justifies exactly one case — "a missing `output_dir` is not an error here" — but the bare `catch` flattens *every* failure to "no entries": `EACCES` on a directory the provider chmod'd, `EMFILE`, `ELOOP`, `ENOTDIR`. In each of those, the walk returns `[]`, `undeclared` is empty, and `assertOutputsAgreeWithDisk` reports the provider clean. The check whose entire purpose is to catch "a file whose origin nothing captures" becomes a no-op precisely in the situations where something odd is going on in `output_dir`.

This is the fallback-hides-failure shape the project guidelines call a bug factory: an I/O fault becomes a passing gate rather than an error. Blast radius: a build proceeds and writes a ledger record while the "a provider MUST declare everything it produces" invariant was never actually evaluated, and nothing in the record notes that.

Fix: narrow the catch to `ENOENT` (rethrow everything else, naming `output_dir` and the errno), or better, drop the try/catch entirely — `invokeProvider` creates `output_dir` at src/providers/invoke.ts:66 before the run, and the declared-outputs check already covers a provider that deleted it, so ENOENT here is not a case worth special-casing at the cost of masking the others.

### AUDIT-20260717-26 — Scratch output directories can escape `dist/` through unconstrained identities

Finding-ID: AUDIT-20260717-26
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/validate.ts:58-67, src/providers/invoke.ts:56-58

`validateTarget` builds its scratch directory with `path.join(context.episodeDir, 'dist', \`.pc-validate-${id}\`)`, but `IdentitySchema` is currently just `z.string()`, so an identity containing slashes and `..` can normalize outside `dist/`. `invokeProvider` then immediately runs `fs.rm(request.outputDir, { recursive: true, force: true })` and recreates it. For an id such as `x/../../episode.yaml`, the scratch path can resolve to an episode-root file path, so validation can delete or replace non-scratch episode content before the provider even runs.

The blast radius is high because this is a correctness and safety defect a real adopter can hit with a malformed manifest/profile identity, and the recursive delete is performed by trusted production-control code. A reasonable fix is to constrain `IdentitySchema` to a bare non-path identifier, or derive scratch directory names from an escaped/hash form of the identity and assert the resolved scratch path remains under the intended scratch root before deleting it.

### AUDIT-20260717-27 — `IdentitySchema` is an unconstrained string, so a target identity escapes `dist/` and drives a recursive delete

Finding-ID: AUDIT-20260717-27 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/manifest/schema.ts:85 (`IdentitySchema`); src/providers/build.ts:104-105, 143-146

`RelativePathSchema` is carefully built to be "the single place the 'no directory traversal' refusal lives" — but it only guards `AuthoredDeclSchema.path` and `BuildOutputSchema.path`. Identities are `z.string()` with no constraints at all (`schema.ts:85`), and `EpisodeManifestSchema.authored` / `targets` / `TargetDeclSchema.inputs` are all typed by it. `buildTarget` then interpolates an identity straight into a filesystem path: `const outputDir = path.join(context.episodeDir, 'dist', '.pc-build-' + id)` (`build.ts:105`). A manifest declaring a target named `../../../../tmp/pwn` yields an `outputDir` far outside the episode — which is then handed to the provider as its writable scratch dir, and, in the `finally` at `build.ts:145`, to `fs.rm(outputDir, { recursive: true, force: true })`. An identity of `.` or `..` alone makes that recursive delete point at `dist/` or the episode dir itself.

The comment on `stage` (`build.ts:180-184`) explicitly reasons about defense in depth for `output.relPath` — "a future caller that builds a ProducedOutput another way must still not be able to write outside `<episodeDir>/dist`" — while the identity, which reaches the filesystem one function earlier and with `recursive: true`, gets no check whatsoever. This is exactly the shape `ProfileNameSchema` was written to close for profile names ("a name carrying separators (or `..`) would escape those directories"); the same reasoning applies verbatim to identities and was not applied.

Blast radius: the manifest is not necessarily operator-authored — `pc clone` ingests episode directories from elsewhere, and an unattended agent building a fetched episode would run an attacker-chosen `rm -rf` and hand an attacker-chosen directory to a spawned tool. Fix: constrain `IdentitySchema` to a bare-name shape the way `ProfileNameSchema` already does (`/^[a-z0-9][a-z0-9-]*$/` or similar, non-empty, no separators, no `..`), and — since `.pc-build-${id}` is a composition, not a wire value — add the same `relative(distRoot, …)` containment assertion to `outputDir` that `stage` already performs on `destination`.

### AUDIT-20260717-28 — A `rename` failure at step 6 strands a record over bytes it does not describe — the exact failure the header says the ordering prevents

Finding-ID: AUDIT-20260717-28 (claude-02 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/build.ts:96-99, 120-134

The module header states the guarantee twice. At `build.ts:96-99`: "Throws — naming what failed — if the target is not buildable, an input cannot be resolved, the provider fails or misbehaves, **or the ingest cannot be completed. In every one of those cases the ledger is untouched.**" And at `build.ts:48-52` it concedes only "the one interruptible window is the single rename in step 6", framing that as an *interrupt* risk.

But the rename is an ordinary fallible syscall, not just an interrupt window. `record(...)` at `build.ts:123` writes the ledger, and only then does `await fs.rename(staged.tempPath, staged.destination)` run at `build.ts:133`. If that rename throws — `destination` already exists as a directory (EISDIR/ENOTEMPTY), EACCES on a read-only or root-owned path, EROFS, ENOSPC on the metadata write, EPERM under a sandbox — `buildTarget` throws with the ledger *already mutated*: it now asserts `H_new` for `output.path`, while the bytes at that path are still `H_old`. The `finally` at `build.ts:137` then deletes the staged copy of `H_new`, so the bytes the record describes no longer exist anywhere. That is precisely the "the ledger claiming an origin for bytes that are not the bytes on disk" condition the header (`build.ts:54-60`) says the AUDIT-20260716-14 restructuring eliminated — it was narrowed from "any record-write failure" to "any rename failure", not removed.

The stated "a rerun repairs it" mitigation is weaker than it reads: a rename that fails for a persistent reason (destination is a directory, path is read-only) fails identically on every rerun, so the ledger stays permanently wrong while `pc build` keeps throwing. Fix: either make the failure explicit — catch around the rename and roll the ledger back to `current` (the snapshot `record` already read), or write the record only after a successful rename and accept the strictly smaller "bytes without a record" window, which `modified.ts` already reports; at minimum, the header's "in every one of those cases the ledger is untouched" must stop claiming an invariant the code does not hold.

### AUDIT-20260717-29 — The example episode declares two authored files that do not exist in the repo

Finding-ID: AUDIT-20260717-29 (claude-01 + claude-03 + codex-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    examples/minimal-podcast/episode.yaml:9-16

`episode.yaml` declares three authored nodes: `outline` (`path: outline.md`), `spoken` (`path: script.md`), and `narration` (`path: assets/narration/take-01.wav`). Only the `.wav` is added by this diff. The chunk's file list runs `examples/minimal-podcast/assets/narration/take-01.wav` → `examples/minimal-podcast/episode.yaml` → `package.json`; `examples/minimal-podcast/outline.md` and `.../script.md` sort between `episode.yaml` and `package.json` and are absent, so they were never committed.

The inline comment at lines 10-12 makes a behavioral claim about a file that isn't there: "`pc status` reports it `present`, because an authored file nobody builds from is still an authored file." As committed, `pc status` on this example reports `outline` and `spoken` as absent/missing, and `voiceover ← [narration]` is the only chain that could resolve — meaning the `follows: spoken` advisory edge at line 17 points at a nonexistent node, exercising an FR-018/FR-019 code path nobody intended to demo.

Blast radius: this is the onboarding artifact the README points a new adopter (or an unattended agent following the quickstart) at first. Their first command contradicts the comment sitting three lines above the path, and the natural conclusion is that `pc status` is broken rather than that the fixture is incomplete. Fix: commit `examples/minimal-podcast/outline.md` and `examples/minimal-podcast/script.md` with real (short) content, and add an integration test that runs `pc status` against `examples/minimal-podcast` so the example can't rot silently again.

### AUDIT-20260717-30 — The shipped profile binds every target to an npx package that does not exist

Finding-ID: AUDIT-20260717-30
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    profiles/editorial-audio.yaml:5-25

All five targets bind to invented tooling: `npx web-tooling build` (line 9), `npx epub-tooling build` (line 13), `npx audio-tooling master` (line 17), `npx audio-tooling publish` (line 21), `npx alignment-tooling align` (line 25). None of these are real npm packages. This is not a test fixture — `profiles/editorial-audio.yaml` is a committed, shipped profile, and `examples/minimal-podcast/episode.yaml:7` explicitly advertises it as "the real, shared profile ... this fixture uses it unmodified, so `pc status` here exercises the actual resolution path a real content repo would use, not a stand-in."

The header comment at lines 1-2 frames a profile as "a generic, reusable recipe binding targets to their inputs and producing tools." The inputs half is real and reusable; the tools half is placeholder data outside test code, which the project guidelines call a bug factory precisely because it hides the failure until someone runs it. And the failure is ugly: `npx` on an unresolvable package name attempts an install and prompts interactively, so `pc build` against this profile hangs rather than erroring cleanly — worst case in CI or under an unattended agent.

Blast radius: an adopter copies `profiles/editorial-audio.yaml` (it is the only profile in the repo, so it is the template), runs `pc build voiceover`, and gets an npx install prompt for a package that will never resolve. The reasonable fix is to make the placeholder status legible at the surface rather than only in an audit finding — either point the profile at tooling that actually exists, or move the invented `cmd` values behind a named `example`/`unbound` provider that `pc build` refuses with "target `voiceover` has no producing tool bound; edit profiles/editorial-audio.yaml" instead of shelling out.

### AUDIT-20260717-31 — `fixtures.test.ts` re-implements the CLI's profile search order instead of calling the shipped loader

Finding-ID: AUDIT-20260717-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/graph/fixtures.test.ts:47-58

`loadFixture` calls `loadProfile(manifest.profile, [episodeDir, PROFILES])` and the comment above it claims this is "the same order the CLI's `createEpisodeLoader` uses. Resolving profiles any other way here would be testing a composition nothing ships." That claim is asserted in prose and nowhere else. The test hand-builds the search-path array itself, so the agreement between this array and `createEpisodeLoader`'s array is exactly the by-construction agreement the file's own header calls out as the root cause of the bug it was written for: "every one of them hand-built its `Profile` object next to the manifest it was written to satisfy, so the two always agreed by construction." The failure mode has changed shape (hand-built path list rather than hand-built `Profile`), not gone away.

Blast radius: if someone reorders `createEpisodeLoader`'s search roots — say, `[PROFILES, episodeDir]` — the `cycle` fixture's local `profile-cycle.yaml` would stop shadowing anything, or a shared profile would start shadowing an episode-local one, and the shipped `pc status` would resolve a different profile than this suite proves works. Every test here stays green because it never touches the loader that changed. That is the same class of green-suite-with-broken-CLI failure this file was created to prevent, so it should be closed the same way: import `createEpisodeLoader` (or whatever the CLI's real resolution entry point is, from `src/cli/runtime.ts`) and drive the fixtures through it, rather than reconstructing its arguments.

### AUDIT-20260717-32 — Ledger output paths are not constrained, so a malformed ledger can make status hash outside the episode

Finding-ID: AUDIT-20260717-32
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/ledger/schema.ts:43-49

`ArtifactRecordSchema.output.path` is a bare `z.string()` at lines 45-46, unlike authored paths and provider output paths that reuse `RelativePathSchema`. That means `readLedger()` accepts a committed `.production/ledger.yaml` with `output.path: ../outside/file`, even though the ledger is an external document that the feature says must be schema-refused when malformed.

The downstream reader composes this field with the episode directory when reading actual output bytes, so a path-shaped ledger entry can point freshness/modified checks at bytes outside the episode. The blast radius is high because the oracle can make release/status decisions from a path the ledger boundary should have refused. The fix is to validate recorded output paths with the same containment primitive, likely requiring `dist/...` or at least `RelativePathSchema` plus a `dist/`-containment check.

### AUDIT-20260717-33 — `hashPath` follows file symlinks, bypassing the tree-hash symlink refusal

Finding-ID: AUDIT-20260717-33
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/hash/path.ts:26-28

`hashPath()` uses `fs.stat()` and then hashes non-directories with `hashFile()`. `stat()` follows symlinks, so a symlink to a regular file is treated as an ordinary file and `hashFile()` reads the target bytes. This conflicts with the explicit `hashTree()` invariant that symlinks are refused because following one can escape the hashed root (`src/hash/tree.ts:105-107`).

The blast radius is high because `hashPath()` is the shared status/build input-hash primitive. A committed authored file path that is actually a symlink can cause `pc status` and `pc build` to hash and hand providers bytes outside the episode, bypassing the lexical path-containment rules. A reasonable fix is for `hashPath()` to `lstat()` first and reject symbolic links before branching on file versus directory.

### AUDIT-20260717-34 — `runVerb` maps unanticipated crashes onto exit 1, the same code as a deliberate refusal

Finding-ID: AUDIT-20260717-34
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/runtime.ts:81-92

`runVerb` wraps a verb body in `try { return await body() } catch (error) { output.err(...); return EXIT_FAILED }`. The catch is unconditional: it treats a deliberate refusal (`throw new Error("Cannot waive the review on ...")` at review.ts:145) and a genuine programming defect (a `TypeError` from a null deref three frames down, an `ENOENT` from a bug in path assembly, a zod internal) as the same outcome, emitting both as `pc <verb>: <message>` on stderr with exit 1. The module's own header comment declares the exit split IS the contract — "it is what lets an agent branch without parsing prose" — and enumerates 1 as "a refusal, an unparseable episode, an unreadable ledger... or a GATE ran and did not pass". Every item in that list is an *anticipated* answer about the production. A crash is not one, and nothing in the code distinguishes the two.

Blast radius: an unattended agent branching on exit codes reads `pc status` crashing with `pc status: Cannot read properties of undefined (reading 'nodes')` as a well-formed "no" about the episode. Its natural next move is to act on the production — rebuild, re-resolve, escalate to a human about a broken episode — when the correct conclusion is that the tool fell over and the episode was never assessed. This is precisely the conflation the header comment says would "make `pc status` unusable in any pipeline", reintroduced one level down. It also defeats `nameError`'s stated discipline (FR-036, "a stack trace is not a named cause"): for an unanticipated throw, `error.message` is not a named cause either, it is just a stack trace with the trace deleted — strictly less diagnosable.

A reasonable fix is a tagged refusal type (a `kind: 'refusal'` discriminant on a plain object/error, per the project's avoid-inheritance guidance) that verbs construct deliberately; `runVerb` names and returns `EXIT_FAILED` only for those, and re-throws or maps anything else to a distinct code with an explicit "this is a defect in pc, not in your episode" message. Note also `nameError` returns `''` for an `Error` with an empty message, producing the bare line `pc review: ` — a refusal that names nothing at all.

### AUDIT-20260717-35 — Fake provider can write outside `output_dir` through `target`

Finding-ID: AUDIT-20260717-35
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/fixtures/fake-provider:64-65, tests/fixtures/fake-provider:117-164

`parseRequest` accepts any non-empty string as `target`, then the provider derives `outputName = \`${request.target}.out\`` and writes it with `join(request.output_dir, outputName)`. A hand-run BuildRequest with `target: "../escape"` makes the test double write outside `output_dir` before returning a response. This contradicts the provider contract this file claims to satisfy exactly, especially Rule 6: providers must not write outside `output_dir`.

The blast radius is high because this fixture is the reference provider used to prove the contract; a downstream provider author can reasonably copy the pattern and derive output paths from an unconstrained identity. A reasonable fix is to stop using `target` as a path component, or reject separators / upward traversal in `parseRequest` before any write occurs.

### AUDIT-20260717-36 — `explainChain` has no visited set — a diamond graph duplicates links and blows up combinatorially

Finding-ID: AUDIT-20260717-36
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/chain.ts:130-200 (`visit`), src/cli/chain.ts:105-115 (`explainChain`)

`visit` recurses into every node returned by `causalInputs` and pushes a link unconditionally; nothing tracks which identities the walk has already emitted. The docstring on `causalInputs` claims "following only the causal input also collapses a diamond to the one path that matters," but that collapse only happens when `status.cause.identity` names a declared input. On the documented fall-through path — a `fresh` node's provenance, or a `missing` node "that was simply never built" — `causalInputs` returns *every* declared input, so a diamond (`d ← [b, c]`, `b ← [a]`, `c ← [a]`) emits `a` twice, once under `from: 'b'` and once under `from: 'c'`. Deeper stacked diamonds multiply: the walk enumerates paths, not nodes, so link count is exponential in diamond depth, and the recursion depth is unbounded by anything other than the graph's height.

Blast radius: `pc explain` is FR-011a's answer surface and its JSON shape (`Chain.links`) is explicitly designed for unattended consumers — the `depth` field exists so "a renderer can indent without re-deriving the tree." A consumer that counts links, or that treats each link as a distinct causal contributor, will double-count shared upstream nodes and mis-weigh the chain; a human reader sees the same authored input listed twice with no indication it is the same node. On a wide-but-shallow real episode the duplication is merely wrong; on a graph with several stacked diamonds it is an unbounded output (and potentially a stack overflow) from a read-only verb.

A reasonable fix: thread a `Set<Identity>` of already-emitted ids through `visit`; on a repeat, either emit a terminal link marked as a re-reference (`via: 'dependency'`, plus a halt-like `already-reported` marker so the JSON stays honest about the DAG shape) or skip it, and document which. Either way the choice must be deliberate and fixtured — the current code makes it by accident.

### AUDIT-20260717-37 — `causalInputs` narrows the chain whenever *any* cause carries an `identity`, including causes the doc says should widen

Finding-ID: AUDIT-20260717-37
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/chain.ts:203-215 (`causalInputs`)

The implementation is `if (causal !== undefined && inputs.includes(causal)) return [causal];` — it keys purely on the presence of `cause.identity`, not on the cause *kind*. The docstring directly above it enumerates a different rule: narrow "when the cause names a specific input — `stale` on a changed input, `blocked` on an absent one," and widen "when no single input is implicated — a `fresh` node's provenance, a `missing` node that was simply never built." Those two rules only coincide if `Cause` guarantees that `identity` is populated *exclusively* for `stale`/`blocked` and never for `fresh`/`missing`. Nothing in this file establishes that, and `Cause` is imported from `@/state/resolve.js` — outside this chunk, so the invariant is asserted in a comment and enforced nowhere.

Blast radius: if a `fresh` cause ever carries a provenance identity (a plausible shape — "fresh as of input X") the chain silently follows one branch and drops the others. That is the failure mode this module exists to prevent: a truncated chain reads as a complete one, because there is no halt and no marker distinguishing "these are all the implicated inputs" from "this is the one I picked." An unattended agent reading `pc explain --json` would conclude the omitted inputs are not part of the node's provenance. This is a quietly-plausible wrong reading, not an obvious contradiction, which is what puts it above `medium`.

The fix is to switch on the discriminant rather than on `identity !== undefined`: narrow only for the cause kinds whose contract is "this named input is the reason" (`stale`, `blocked`), and widen for every other kind regardless of whether `identity` happens to be set. If `Cause` genuinely is a discriminated union with that property, the switch is also self-documenting and a new cause kind fails the exhaustiveness check instead of silently landing in the narrowing branch.

## 2026-07-17 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260717-38 — `reviews[X].waived_hash` silently stores a *different node's* hash than its name implies

Finding-ID: AUDIT-20260717-38
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/state/resolve-precedence.test.ts:139-149, 224-232; tests/unit/state/resolve-validation.test.ts:255-263

Every `follows` scenario in this chunk writes the hash of the **followed** node into the **tracker's** review entry. In Case 8c (`resolve-precedence.test.ts:224-232`), `baselineHash` is `writeAndHash(episodeDir, 'script.md', 'script v1')` — i.e. `spoken`'s content — and it is stored at `ledger.reviews.narration.waived_hash`. The field is keyed by the node being reviewed (`narration`) but holds the content hash of a different node (`spoken`). Nothing in the ledger records which node's hash it is; the disambiguation lives only in a test docblock (`resolve-precedence.test.ts:18-31`), which itself concedes this is "the most literal reading" and "the only reading the schema supports without inventing an undocumented field."

The blast radius is that any other consumer of `Ledger` — a doctor rule, a future `pc review` implementation, a migration, or an unattended agent extending the schema — will read `reviews.narration.waived_hash` as narration's own hash, because that is what the field name and key structure say. A consumer that writes narration's hash there (the natural reading) produces a ledger that `resolveStatus` will compare against `spoken`'s current hash, permanently reporting `needs-review` with no way for the operator to clear it. The tests here freeze the non-obvious reading into the contract without making it discoverable from the schema.

A reasonable fix is to make the schema say what it stores — rename to something like `followed_hash`, or add an explicit `followed: { id, hash }` shape to the review entry — so the field name carries the interpretation rather than a test comment. If the rename is out of scope for this chunk, the ledger schema needs a doc comment at the field itself, not only in these tests.

### AUDIT-20260717-39 — Git tracked check depends on the caller’s cwd, not the checked file’s repo

Finding-ID: AUDIT-20260717-39
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/git-tracked.ts:20-25

`gitTrackedCheck().isTracked(absolutePath)` accepts an absolute path, but runs `git ls-files --error-unmatch <absolutePath>` without setting `cwd` or using `git -C` against the file’s repository. That means the same tracked file reports `true` only when the current process is already inside that repo; from any other cwd, Git exits with “not a git repository” and this code collapses that into `false` at lines 24-25.

This matters because the CLI resolves `--episode` against the invocation cwd (`src/cli/episode.ts:57-64`), and provider input resolution passes absolute authored paths into this check (`src/providers/inputs.ts:143-147`). A valid git-tracked oversized authored file can therefore be refused as “untracked” when a user runs `pc build --episode /path/to/repo/episode` from outside the repo. The blast radius is high: it breaks the FR-026 tracked-file exception for a normal CLI invocation shape. A reasonable fix is to resolve the repo context for the checked path, or run Git with `-C` rooted at the episode/repo directory instead of relying on process cwd.

### AUDIT-20260717-40 — `pc asset add` silently discards `--media` on the re-add path, and no verb can ever correct a recorded media type

Finding-ID: AUDIT-20260717-40
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/asset.ts:283-332 (`reAddOrMissing`), with src/cli/asset.ts:196-210 (`resolveMedia` call site)

`reAddOrMissing` never looks at `options.media`. When the original bytes have already been moved into the store, the function reads the existing stand-in, confirms `store.has(existing.asset)`, and emits `media: existing.media` with `standin_written: false` and `EXIT_OK` — reporting success while ignoring the flag the caller passed. So `pc asset add take-01.wav --media audio/wav` run to *fix* a stand-in that says `application/x-wav` prints a green no-op and changes nothing. The caller has no signal that their flag was dropped.

This is worse than a dropped flag because it closes the only door. The address is derived from bytes alone (`hashBytes(bytes)`, line 213), so `media` is metadata the content address does not cover — a wrong media type cannot be corrected by re-adding "different content," and there is no other verb in this chunk that edits a stand-in. Once the original is unlinked (line 253), `media` is frozen at whatever the first run inferred or was told. The file's own doc comment (lines 156-160) argues the media type matters precisely because "the stand-in is the only description of bytes that are not in the repo" — a system that treats that field as load-bearing must offer a way to fix it. Blast radius: an agent or adopter fixing a mis-inferred media type gets `EXIT_OK` and a report echoing the *old* media, so it will record "fixed" and move on with the wrong value still on disk and in git.

A reasonable fix: in `reAddOrMissing`, when `options.media` is present and differs from `existing.media`, rewrite the stand-in (the address and byte count are unchanged; only the description changes) and report `standin_written: true` — or, if rewriting is deliberately out of scope for this verb, refuse loudly naming the conflict rather than emitting `EXIT_OK`. The empty-string `--media` guard at lines 196-202 is also unreachable on this path, which is a symptom of the same gap: option validation lives inside the bytes-present branch only.

### AUDIT-20260717-41 — `asset add` deletes the local copy after `has()` proves only key presence, not byte integrity

Finding-ID: AUDIT-20260717-41
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/asset.ts:230-270

`assetAddCommand` treats `store.has(address)` as sufficient proof that the store holds the exact local bytes before removing the original file. On the has-hit path, lines 231-241 skip `put`, and lines 263-270 check `has(address)` again before `fs.unlink(file)`. The `AssetStore` contract in `src/assets/store.ts:24-25` only says `has` reports whether an address exists; it does not require fetching and hashing the stored bytes. The S3 adapter reinforces that boundary in practice: `has` is implemented with `HeadObject`, while integrity verification is only performed by `get`.

The blast radius is high because a real adopter can lose the only good local copy if the remote key already exists but contains corrupted, truncated, or otherwise mismatched bytes. The command will write a stand-in pointing at the hash of the local file, report success, and delete the local file even though future retrieval of that address will fail integrity checks. A reasonable fix is to make the pre-unlink confirmation integrity-proving: after a has-hit, fetch the object and verify it hashes to the computed address, or add a store method whose contract explicitly means “the exact addressed bytes are retrievable” and use that before unlinking.

### AUDIT-20260717-42 — `pc explain --json` drops the structured cause identity

Finding-ID: AUDIT-20260717-42
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/explain.ts:30-60

`ChainLinkJson.cause` only carries `{ code, message }`, and `toExplainJson()` serializes only those two fields. The shared `Cause` model includes `identity` specifically so an agent can read the responsible node structurally instead of scraping prose; `status` preserves that field, but `explain --json` loses it.

This matters most for cases where the responsible identity is not also emitted as the next chain link, such as `input-removed`, where the removed input is no longer in declared inputs and `chain.ts` intentionally cannot descend to it. A downstream consumer acting on `pc explain --json` gets a plausible causal report but cannot reliably identify the removed or followed identity without parsing `message`. A reasonable fix is to reuse the same cause JSON projection as `status`, including `identity: null` when absent.

### AUDIT-20260717-43 — The `PC_REQUIRE_DOCKER` enforcement gate is asserted to be set by CI, but nothing in the repo sets it

Finding-ID: AUDIT-20260717-43
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/s3-store.test.ts:36-44 (the `requireDocker` comment + derivation), and the absent CI workflow surface

The comment block preceding `requireDocker` states as fact that CI sets the variable: *"`PC_REQUIRE_DOCKER` makes the missing-Docker branch a FAILING test rather than a skip, so CI (which sets it) cannot normalize the skip"*, and the skip banner repeats it: *"Set PC_REQUIRE_DOCKER=1 (CI does)"*. Both claims are load-bearing for the finding this file cites as its motivation (AUDIT-20260716-18, *"A gate is not enforcement until absence can fail"*). But no `.github/workflows/*` file — nor any other CI config — appears anywhere in this diff's file inventory across all 40+ chunks. If the variable is never exported by an actual pipeline, `requireDocker` is `false` in every environment, the `describe.runIf(requireDocker && !dockerAvailable)` failing branch never registers a single test, and the suite reverts to exactly the unconditional-skip false-clean the file was written to close.

The blast radius is that FR-027 — the *only* real proof that `s3AssetStore` speaks S3 rather than agreeing with the in-memory double — silently never runs, while the board reads green and the source comment tells the next reader it is enforced. That is worse than an honest skip: a reader auditing this file for the AUDIT-20260716-18 shape will read "CI does" and mark the finding closed without checking. A reasonable fix is to land the CI job that exports `PC_REQUIRE_DOCKER=1` in the same commit as the gate, and to change the comments from an assertion about CI to a pointer at the specific workflow file and step that sets it, so the claim is falsifiable by grep. If no CI exists yet, the comments must say the gate is currently unset in every environment rather than claiming enforcement.

---

### AUDIT-20260717-44 — The Docker requirement is only read, not wired into any required test command

Finding-ID: AUDIT-20260717-44
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=reachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/contract/s3-store.test.ts:37-55; missing CI/package-script wiring for `PC_REQUIRE_DOCKER`

The fix adds `PC_REQUIRE_DOCKER` and correctly turns missing Docker into a failing test when that variable is set, but this chunk does not wire the variable into any required command. The comment and warning claim “CI does” set it at lines 40 and 55, yet the repo has no `.github` workflow in this workspace, and `package.json` currently defines `test` as plain `vitest run` and `test:integration:store` as plain `vitest run --project contract tests/contract/s3-store.test.ts`, with no `PC_REQUIRE_DOCKER=1`.

That means the prior false-clean path is still reachable by default: a runner without Docker can execute the advertised store contract command, skip the MinIO suite, and exit green. The new failing branch exists, but nothing in the audited surface makes the project’s own verification path enter it. Blast radius is high because FR-027’s only real S3-compatible proof can still be absent while downstream consumers see a passing test run and infer the adapter was exercised against MinIO.

A reasonable fix is to make at least one committed verification path set the requirement, for example by changing the store contract script or CI command to run with `PC_REQUIRE_DOCKER=1`, while keeping a separate explicit local opt-out command if laptop ergonomics matter.

### AUDIT-20260717-45 — The escape test creates the escaped file itself before asserting it does not exist

Finding-ID: AUDIT-20260717-45
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/path-safety.test.ts:52-57, tests/integration/path-safety.test.ts:109-127

`runnerEmitting('../evil.txt')` resolves the runner output against `request.output_dir` and writes it immediately with `fs.writeFile(full, ...)` before returning the declared output. In this build path, `request.output_dir` is `<episodeDir>/dist/.pc-build-voiceover`, so `../evil.txt` resolves to `<episodeDir>/dist/evil.txt`, not to the final ingest destination `<episodeDir>/evil.txt`. More importantly, for any traversing case that does reach outside the intended area, the fake runner has already performed that write before `buildTarget` reaches the ingest containment check.

The test then asserts “NO file outside dist/” by checking only `path.join(dir, 'evil.txt')`, which is not the path this runner wrote for `../evil.txt`. That makes the negative assertion non-contractual: it can pass while an escaped provider scratch write remains under `dist/evil.txt`, and a slightly different traversal would make the test fail because the harness, not ingest, created the outside file. Blast radius is high because this is governance coverage for a path-safety fix; as written, a downstream maintainer could trust a green test that does not actually prove the claimed no-outside-write invariant.

A reasonable fix is to separate “provider scratch file exists for hashing” from “final ingest path escapes”: create the produced bytes at a contained scratch path, then return a crafted `ProducedOutput`/runner seam that drives `stage()` with a traversing `relPath` without having the fake runner itself write the escaped destination, or assert the exact scratch escape path as runner-owned debris separately from the ingest destination.

### AUDIT-20260717-46 — The offline-by-construction proof never checks its own walk for holes — only the ROOT_FILES walk does

Finding-ID: AUDIT-20260717-46
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/architecture-boundary.test.ts:52-58, 66-88, 144-153

The final test (`'every internal import resolves to a real file (the walk is complete)'`, lines 144-153) states the file's own trust condition in its failure message: *"the import graph has holes, so this test cannot be trusted."* That check is rooted **only** over `ROOT_FILES`. The two walks the file leans on hardest are never checked for `unresolved`: the read-verb walk over `CLI_ROOT_FILES` (line 55: `walk(root)`) and the eager walk from the shipped entry (line 76: `walk(entry, EAGER_IMPORTS_BY_FILE)`). Unless `CLI_ROOT_FILES ⊆ ROOT_FILES` and the eager graph is a strict subset of the graph the completeness test walks — neither of which the diff states, and I could not verify in `architecture-support.ts` — the strongest claims in the file are made over graphs whose completeness is unverified.

This matters because of how `walk` must behave on an unresolvable import: it records the specifier in `unresolved` and cannot follow it, so everything behind it is invisible to the violation scan. A refactor that renames a module, adds a subpath export, or introduces an import form the resolver doesn't understand would silently shrink the eager graph — and `failures` would still be `[]`. The test would report "dispatching `pc status` loads no network client" while having never looked at the subtree where the client now lives. The vacuity guards at lines 79-87 do not cover this: they only assert `status.ts` and `resolve.ts` are reached, which stays true while an arbitrary amount of the graph behind them goes dark.

Blast radius: this is the mechanical half of the SC-001/FR-010 offline guarantee, and the file explicitly says the runtime half (`tests/integration/offline.test.ts`) is *not sufficient alone* — "a runtime test only proves the paths it happens to walk never dialled out, and this only proves the code CANNOT." If the eager walk can go quietly incomplete, that division of labor is broken and the pair proves less than either author believed. Fix: assert `unresolved` is empty for every walk the file performs — extend the completeness test to iterate `[...ROOT_FILES, ...CLI_ROOT_FILES]` plus the eager and full walks from `SHIPPED_ENTRY`, or have `walk` throw on an unresolved internal specifier so no caller can forget.

### AUDIT-20260717-47 — Fetched assets are materialized into a flat directory keyed only by basename, so two inputs sharing a filename clobber each other after verification

Finding-ID: AUDIT-20260717-47
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/inputs.ts:186-230 (`assetDir`, `fetchAsset`, and the pointer branch of `resolveAuthoredInput`)

`fetchAsset` computes `const filename = path.basename(declaredPath)` and hands the resolver `assetDir(context.episodeDir)` — a single flat `.production/assets/` directory — as the destination. The basename is not unique across an episode: `narration/take-01.wav` and `music/take-01.wav` are ordinary, idiomatic declarations, and both materialize to `.production/assets/take-01.wav`.

`resolveInputs` (line 78-84) resolves declared inputs sequentially and accumulates `BuildInput` records. Input A is fetched to `.production/assets/take-01.wav`, its bytes are hashed and verified against the stand-in's address (line 174-186), and `{path: '.production/assets/take-01.wav', hash: hashOfA}` is stored in the result map. Input B is then fetched to the *same* path, overwriting it. The verification for B passes. The provider is subsequently spawned with a `BuildRequest` in which input A's entry names a path whose bytes are now B's, alongside A's hash. The integrity check at line 175-186 does not protect against this, because it runs before the clobber. This is precisely the failure the comment at line 175-182 says the check exists to prevent ("`pc build` record an input hash nothing on disk matches"), reached by a different route: the record is written against A's address, the provider consumed B's bytes, and nothing refuses. The same directory is also shared across concurrent `pc build` invocations in one episode dir, which makes the same collision reachable even with distinct basenames if two runs fetch and verify interleaved.

A reasonable fix is to make the destination content-addressed rather than name-addressed — e.g. `.production/assets/<address>/<basename>`, keeping the extension the comment at line 189-192 correctly insists on while making the path collision-free by construction. That also makes the materialized file idempotently reusable across runs instead of a mutable slot. Blast radius: an adopter with two same-named assets in different directories gets a build recorded against provenance that does not describe what the provider read — silent, and exactly the corruption class this boundary is built to refuse.

### AUDIT-20260717-48 — Derived input resolution trusts ledger paths outside the episode

Finding-ID: AUDIT-20260717-48
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/inputs.ts:296-306

`resolveDerivedInput` reads `record.output.path` from the ledger and joins it directly with `episodeDir` before checking existence and handing it to the provider. The ledger schema currently stores `output.path` as an unconstrained string, so a corrupted or hand-edited ledger can name `../outside.wav` or another upward-traversing path; `path.join(context.episodeDir, recordedPath)` will normalize that escape, `isFile()` will accept it, and the provider receives bytes from outside the episode as a legitimate derived input.

This matters because the provider boundary is explicitly supposed to hand providers only resolved episode artifacts, and the build record then records the hash of whatever bytes were supplied. The blast radius is high: a downstream build can consume and record provenance for arbitrary local files selected by ledger text rather than by the episode graph’s produced artifacts. A reasonable fix is to validate `record.output.path` before use, ideally with the same relative-path containment invariant used for manifest/provider paths and, since build records outputs under `dist/`, refuse derived records that do not resolve inside the episode’s `dist/` directory.

### AUDIT-20260717-49 — Case 9 cannot fail for the reason it claims — its fixture is Case 10's fixture, so it passes on the both-authored-and-derived refusal regardless of whether `follows`-on-derived is checked at all

Finding-ID: AUDIT-20260717-49
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/graph/validate-refusals.test.ts:187-227 (the `Case 9: follows declared on a DERIVED node is refused` block)

Case 9's own header comment states the premise: "`follows` can only reach a derived node one way: an identity that is BOTH authored-with-follows AND a profile target." The fixture therefore declares `voiceover` in `authored` (with `follows: 'spoken'`) *and* in `profile.targets`. But that exact collision — an identity that is both authored and a profile target — is independently refused by the rule Case 10 asserts at lines 259-287, whose fixture is byte-for-byte Case 9's minus the `follows` key. So `validateGraph` throws on Case 9's fixture from the both-authored-and-derived check alone, before any `follows`-on-derived rule is consulted. The assertion `toThrow(/voiceover/i)` at line 226 is satisfied by Case 10's refusal message. If the `follows`-on-derived check were deleted from `validateGraph` entirely, Case 9 would still pass green.

The comment block concedes that this is the *only* route to the condition, which is the tell: if the only reachable instance of "follows on a derived node" is already refused by a different rule, then either the rule Case 9 names does not exist as a distinct behavior (and the test should be deleted or relabeled as a second assertion on the Case 10 rule), or the schema permits some route the comment missed and the fixture must exercise that route instead. As written the test is a duplicate wearing a different name.

Blast radius: this is a governance-suite test, and the suite is the artifact downstream consumers (and the govern loop itself) read to decide the graph validator is covered. A vacuous test reports coverage of a refusal that may not be implemented. A reasonable fix is to determine whether `validateGraph` has a distinct follows-on-derived branch; if it does not, delete Case 9 and note in Case 10 that the both-authored-and-derived refusal subsumes it; if it does, find a fixture that isolates it (which per the comment's own reasoning may be impossible, which is itself the answer).
```

```

### AUDIT-20260717-50 — Rebuild path is mocked, so the main FR-022a guard cannot catch a real build regression

Finding-ID: AUDIT-20260717-50
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/dual-signal.test.ts:57-78, tests/integration/dual-signal.test.ts:117-120, tests/integration/dual-signal.test.ts:200-240

The test section titled “rebuilding the derived output MUST NOT clear the review” never exercises `pc build` or the provider/build recording path. `rebuildTranscript()` calls `recordTranscriptBuild()`, which hand-writes the ledger with `{ ...ledger, artifacts: ... }`, inherently preserving `reviews`. That means the test would still pass if the actual build command regressed and cleared, rewrote, or otherwise corrupted `ledger.reviews`.

The blast radius is high because this file is explicitly presented as the FR-022a integration guard for “a rebuild resolves one, a human the other.” A downstream maintainer or audit gate acting on this test as written would believe the real rebuild boundary is covered when it is not. A reasonable fix is to make the dual-signal fixture buildable through the real `pc build transcript` path, then use that command in `rebuildTranscript()`; keep the ledger-level assertions afterward as verification, not as the mechanism under test.

### AUDIT-20260717-51 — `pc status` half of the FR-025 contrast cannot detect the probe it claims to guard against

Finding-ID: AUDIT-20260717-51
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unreachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/asset-absent.test.ts:225-244

The docstring at lines 10-24 and the closing comment at lines 268-273 assert that this test is a regression guard: "someone adding a reachability probe to status would turn the first half red while leaving the second half green. Do not resolve such a failure by relaxing the first half." The mechanism cannot deliver that. The `MemoryAssetStore` constructed at lines 219-222 is never wired into the `pc status` subprocess — the test's own comment at 227-229 concedes "no store wired into it at all — because there is no seam to wire one into." So the store's `setUnreachable(true)` state has zero causal connection to the first half. If someone added a HEAD probe to `status`, it would resolve store config from the episode/env, not from this in-memory fixture, and would either silently succeed or hit the real network. The single actual guard is the stdout regex at line 240 (`not.toMatch(/store|network|unreachable|fetch/i)`), which only catches a probe that *narrates itself in the JSON answer* — a probe that quietly returns and colors nothing would pass green, and `expect(status.stderr).toBe('')` at 233 only catches a probe that fails noisily.

Blast radius: an unattended agent (or a maintainer) reading this file concludes FR-025 is regression-covered and will not add a real guard. The invariant most worth protecting in the whole asset design — that the oracle works offline — then has no test behind it, and its loss ships silently. The comment at 271-273 actively discourages the one correction that would help ("do not resolve such a failure by relaxing the first half"), because it presumes a failure mode that can't occur.

A reasonable fix is to guard the invariant at a seam that exists rather than at a fixture that doesn't: assert on observable process behavior — run `pc status` with network egress denied and/or an intentionally poisoned store endpoint in config, and assert exit 0; or, if there is genuinely no seam, add one (inject the store factory) and assert the factory is never constructed. Failing both, downgrade the docstring to state honestly what is covered (status answers from the stand-in alone under a fixture whose bytes are absent from disk) and what is not (the probe channel), so the gap is visible instead of papered over.

### AUDIT-20260717-52 — `resolveAuthored` reports a directory as `{ kind: 'file' }`, silently bypassing the FR-026 size guard

Finding-ID: AUDIT-20260717-52
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/pointer.ts:106-129 (`resolveAuthored`, `statIfExists`)

`statIfExists` returns `await fs.stat(filePath)` and the caller only distinguishes `null` (ENOENT) from present — it never asks `stat.isFile()`. When `declaredPath` names a directory, `readFileIfExists('<dir>.asset')` returns `null` (no stand-in), `fs.stat` succeeds, and the function returns `{ kind: 'file', path: declaredPath }`. The FR-026 guard then compares `stat.size` — for a directory this is the inode's own size (typically 64–4096 bytes on APFS/ext4), not the size of its contents — against the 5 MiB threshold, so the guard can never fire on a directory no matter how many gigabytes of untracked media sit inside it. That is exactly the footgun FR-026 exists to catch, and it is the one shape where the guard is structurally unable to catch it.

The blast radius is that every downstream consumer of `AuthoredResolution` is told, as fact, that a directory is a plain file whose bytes can be hashed and built from. Commit `7d2a0ba` ("T078 quickstart walk: fix the directory-input build bug it found") shows a directory input already reached and broke the build path once; whatever fix landed there, this resolver still hands the wrong `kind` upward, so any *other* consumer (hashing, `pc asset add`, the oracle's freshness read) inherits the same wrong reading independently. A reasonable fix is to branch on `stat.isFile()` inside `resolveAuthored`: a directory is neither `file` nor `absent`, so it should either throw naming `declaredPath` ("authored paths must be files; X is a directory") or gain an explicit `kind: 'directory'` that consumers must handle. Silently collapsing it into `file` is the one option that cannot be right.

### AUDIT-20260717-53 — S3 `put` treats a corrupt object key as durable storage

Finding-ID: AUDIT-20260717-53
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/s3.ts:55-77

`put()` derives the content address, calls `has(address)`, and returns without uploading whenever `HeadObject` succeeds. A HEAD only proves that some object exists at the content-addressed key; it does not prove the object's bytes hash to that address. That matters because `pc asset add` relies on `store.has(address)` before deleting the original local file, so a bucket containing a truncated or out-of-band-written object at `sha256/...` can make the CLI remove the only good local copy while leaving future `get()` calls to fail integrity verification.

The blast radius is high because this is a correctness and data-retention boundary a normal adopter can hit after bucket corruption, interrupted manual repair, or external writes. A reasonable fix is to make the S3 adapter’s “already present” path verify content before treating it as a no-op, or make `put` upload/repair/refuse in a way that never lets `has()` alone stand in for byte integrity.

### AUDIT-20260717-54 — The path-escape refinement is fixtured only on leading `../` and leading `/` — interior traversal and the empty path are unenumerated channels

Finding-ID: AUDIT-20260717-54
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/provider-by-hand.test.ts:110-125

`BuildOutputSchema`'s refusal tests exercise exactly two shapes: `'../../../.ssh/authorized_keys'` (leading `..`) and `'/etc/cron.d/evil'` (leading `/`). The header comment (lines 96-105) claims this is the wire boundary that both `subprocessRunner` (`path.resolve(output_dir, path)`) and `ingest` (`path.join(episodeDir, 'dist', path)`) trust to make an escape unreachable. That claim is much broader than the fixtures. The **value channel** the refinement opens is unenumerated: `'sub/../../escaped.txt'` normalizes to an escape but has no leading `..`, so a prefix-style check (`path.startsWith('..')`) admits it and `path.resolve` walks it right out of `output_dir`. Same for `'a/b/../../../..'`, for `'..'` bare, and for the empty string `''` — `path.resolve(dir, '')` yields `dir` itself, so a declared output of `''` means "the output is the directory," which the existence check downstream would satisfy trivially.

The **state channel** is also open: `{ path: '.' }` and `{ path: './' }` are accepted by an ordinary-relative-path check but are not files. And nothing here pins the accept-side boundary — `it('accepts an ordinary relative output path')` uses `'podcast.out'` and `'sub/dir/podcast.out'`, neither of which distinguishes a normalizing check from a prefix check.

Blast radius: this is the only refusal standing between a hostile or buggy provider's stdout and a filesystem write composed by two separate call sites. If the refinement is a prefix check rather than a `path.normalize`-then-`startsWith('..')` check, an adopter running an untrusted provider gets an arbitrary-path write and every test in this file still passes. A reasonable fix: add fixtures for `'sub/../../escaped.txt'`, `'..'`, `''`, and `'.'` asserting refusal, and (if the implementation currently passes them) fix `src/providers/contract.ts` to normalize before testing for escape.

### AUDIT-20260717-55 — `RelativePathSchema` test enshrines a lexical-containment claim that is false under symlinks

Finding-ID: AUDIT-20260717-55
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/manifest/schema-manifest.test.ts:213-219

The test "accepts an interior `..` that normalizes back inside" pins `RelativePathSchema.safeParse('a/../b')` as `success: true`, and its comment states the security rationale outright: *"only a value whose NORMAL FORM leaves the root is an escape. `a/../b` resolves to `b`, which is contained, so joining it against a root stays inside."* That claim holds only for **lexical** normalization. On a real filesystem, if `a` is a symlink to `/etc/foo`, the kernel resolves `a/..` to `/etc`, so `a/../b` reads `/etc/b` — outside the root, despite `path.normalize` reporting `b`. The suite's own sibling case (`a/../../b` refused) shows the author reasoning purely in `path.normalize` terms, so the symlink channel was never enumerated.

This matters because the surrounding comment block (lines 190-193) declares this refinement "the ONE shared refinement that closes directory traversal at every schema boundary that stores a filesystem path" — it is positioned as *the* containment control for `AuthoredDecl.path`, `BuildOutput`, and any future path-bearing schema. A downstream consumer reading this test will reasonably conclude that a value passing `RelativePathSchema` is safe to `path.join` against `episodeDir` and hand to `readFile`/hash. It isn't, for any value containing an interior `..` traversing through a symlinked segment. The blast radius: an episode manifest authored with a symlinked asset directory can read (and, on the build-output side, potentially write) outside the episode boundary while every schema check reports green.

A reasonable fix is either (a) refuse interior `..` outright — the accepted example `a/../b` has no legitimate authoring use, and refusing it costs nothing while removing the entire class; or (b) keep lexical acceptance but add a `realpath`-based containment assertion at the join site, and rewrite this comment to say the schema is a *syntactic* filter, not a containment guarantee. Whichever is chosen, add a fixture with a symlinked segment (`tests/integration/path-safety.test.ts` is the natural home) so the channel has coverage.

---

### AUDIT-20260717-56 — Chunk 95355b61788b5b2e declares 29 files in scope but renders diffs for only 4

Finding-ID: AUDIT-20260717-56
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    chunk 95355b61788b5b2e — "Files in scope" list vs. the "## Diffs" section

The chunk header assigns 29 files: `.prettierrc.json`, `.specify/feature.json`, `.stack-control/audit-barrage-config.yaml`, `.stack-control/config.yaml`, the execute ledger, `package-lock.json`, and 23 files under `tests/fixtures/`. The `## Diffs` section contains exactly four: `.prettierrc.json`, `.specify/feature.json`, `.stack-control/config.yaml`, and the ledger. The other 25 were never rendered. Several of those are plain text that a diff renderer has no reason to omit — `tests/fixtures/memory-store.ts`, `tests/fixtures/minimal/episode.yaml`, `tests/fixtures/cycle/profile-cycle.yaml`, `tests/fixtures/blocked/episode.yaml`, `tests/fixtures/tree-output/article.mdx`, and `.stack-control/audit-barrage-config.yaml` (which configures the barrage auditing this very feature).

The blast radius is on the audit apparatus rather than the product. Per the fleet-degradation pricing driver, a round's finding count is only meaningful over the surface the fleet actually saw. If I return few or no findings for this chunk, the operator's triage will read that as "29 files audited clean" when 25 of them were never presented to any reviewer assigned to them. That is a silent coverage cap — exactly the "no silent caps" failure — and it is invisible from the output side because a quiet lane and a starved lane look identical. Notably `tests/fixtures/fake-provider` is extensionless and almost certainly an executable script whose committed file mode determines whether the provider-runner contract tests pass on a fresh clone; I cannot check that, and neither could any sibling assigned this chunk.

A reasonable fix is for the chunker to either render every in-scope file or emit an explicit `omitted:` list with the reason (binary, size cap, generated lockfile), so that a clean report can be priced against what was actually shown.

### AUDIT-20260717-57 — The "defaults to the current directory" test never omits `--episode` — the default-resolution path is entirely untested

Finding-ID: AUDIT-20260717-57 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    tests/integration/cli.test.ts:232-238

The test is titled `defaults to the current directory` and its comment states "Run with cwd inside the episode and no `--episode` flag: same answer as the explicit form." The body does the opposite:

```js
const dir = await copyFixture('chain');
const explicit = await pc(['status', '--episode', dir, '--json']);
expect(explicit.code).toBe(0);
expect(StatusJsonSchema.parse(parseJsonText(explicit.stdout)).episode).toBe('chain');
```

There is exactly one invocation, it passes `--episode` explicitly, and no cwd is ever set. The variable is even named `explicit` — the implicit half of the intended comparison was never written. `copyFixture` is pure overhead here; the assertion is a duplicate of the `--json parses as JSON` test at lines 88-97 pointed at a different fixture. The named `const explicit` strongly suggests a second `const implicit = await pc(['status', '--json'], {cwd: dir})` was intended and dropped.

Blast radius: the CLI's cwd-defaulting for `--episode` has zero coverage while the suite reports it as covered. If `pc status` with no `--episode` crashes, resolves to the repo root, or silently picks the wrong episode, this suite is green. That is worse than no test — a maintainer grepping for "is the default covered?" finds a passing test with the right name and stops looking. The fix is to add the missing invocation with `cwd: dir` and no flag, and assert both runs produce the same parsed status; if `pc()` in `support.ts` has no `cwd` option, that option is the actual missing surface. Note this also interacts with finding 02: the sibling test at 240-249 relies on `--episode <dir>` resolution too, so nothing in this describe block exercises the default.

---

### AUDIT-20260717-58 — Validation records can clobber a newer artifact record

Finding-ID: AUDIT-20260717-58
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/validate.ts:80-115

`validateCommand` loads the ledger once at command start and passes that snapshot into the validation context (`ledger` from line 80, stored into `BuildContext` at lines 106-115). The provider validation path then uses that stale `context.ledger.artifacts[id]` as the artifact record to validate and rewrite. If another `pc build` or `pc validate` updates the same artifact while this provider invocation is running, the eventual verdict write can overwrite the newer artifact record with the older snapshot plus a validation field.

This matters because validation is explicitly described as recording a verdict about an existing build, not rebuilding or rewriting origin facts. Under concurrent automation, this can silently lose a newer `inputs`/`output`/`producer` record and leave the ledger asserting the older artifact again. The reasonable fix is to make the verdict write re-read the current artifact for the target, verify it is still the same artifact/hash the provider verdict was obtained for, and refuse if it changed before writing the validation field.

### AUDIT-20260717-59 — Waivers Can Transfer Across A Different `follows` Target With The Same Hash

Finding-ID: AUDIT-20260717-59
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/state/resolve.ts:351-367

`reviewStatus` accepts an authored tracking node as `present` when `ledger.reviews[id]?.waived_hash` equals the current hash of the followed node. The waiver comparison does not bind the waiver to the followed identity, only to bytes. If a manifest changes `node.follows` from one identity to another whose content hash happens to match the old waived hash, the old human review silently applies to a different followed node.

That matters because the comments define the waiver as proof that “a human has looked at this” against the followed node, not merely against any content-addressed blob. A downstream release check would see `present` and allow release even though the advisory relationship changed and no human accepted the new relationship. A reasonable fix is to record and compare the followed identity in the review ledger, or otherwise make a changed `follows` target force `needs-review` even when the content hash matches.

### AUDIT-20260717-60 — Symlinked outputs defeat both the containment check and the undeclared-file walk

Finding-ID: AUDIT-20260717-60
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/run.ts:229-262 (`assertOutputsAgreeWithDisk`, `isFile`, `listFilesRelative`), src/providers/invoke.ts:88-92

Every containment guarantee in this diff is lexical, and every existence check follows symlinks — so the two disagree. In `assertOutputsAgreeWithDisk`, the traversal guard computes `path.relative(request.output_dir, absolute)` and rejects `..`-escapes on the *string*, then calls `isFile(absolute)`, which uses `fs.stat` — and `fs.stat` follows symlinks. A provider that writes `output_dir/episode.mp3` as a symlink to `/etc/passwd` (or to any file elsewhere on the operator's disk) passes the lexical containment check, because the declared path really is `episode.mp3` inside `output_dir`, and passes the existence check, because `stat` resolves the link to a real file. `invokeProvider` then does `await hashFile(fullPath)` at invoke.ts:91 on that same following path, so the ledger records a hash — a "first-hand observation" per the module's own docstring — of bytes that were never inside `output_dir` and that the provider never produced. The ingest step downstream (not in this chunk) would then copy those bytes in as an artifact.

The undeclared-file walk has the mirror hole. `listFilesRelative` filters on `entry.isFile()`, and a `Dirent` for a symlink reports `isSymbolicLink()`, not `isFile()` — so symlinks are silently skipped rather than flagged as undeclared. Additionally, `fs.readdir(dir, {recursive: true})` does not descend into symlinked directories, so a provider can hide an entire tree of undeclared files behind one symlinked directory. Rule 5's "a provider MUST declare everything it produces" is unenforced for exactly the case where a misbehaving provider would want it to be.

Blast radius: the record — the artifact this whole feature exists to make trustworthy — can name a hash of a file the provider chose from anywhere on the filesystem, while the runner reports the build as clean. That is the precise false-clean FR-033 is written against, and it is silent. The fix is to make the checks agree with the containment claim: use `fs.lstat` for the declared-output existence check and refuse any declared output that is not a regular file (naming symlinks explicitly), and have `listFilesRelative` treat a non-file, non-directory entry as an undeclared artifact rather than skipping it. Belt-and-braces: after `lstat`, `fs.realpath` the resolved output and re-assert containment against the realpath'd `output_dir`, so a symlinked *parent* directory can't move the target either.

### AUDIT-20260717-61 — `pc validate` on a modified artifact records a verdict about bytes that are not on disk

Finding-ID: AUDIT-20260717-61 (claude-02 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/validate.ts:64-84

`validateTarget` compares the provider's fresh output hash against `existing.output.hash` — the hash *in the ledger record* — and never reads the artifact at `existing.output.path` on disk. The docstring at validate.ts:22-31 states the purpose exactly: "to establish that what the provider just judged is byte-for-byte the artifact this record describes." But the record is not the artifact; it is a claim about the artifact, and this feature already has a first-class concept for the case where they diverge — `modified`, a human's hand-edit to a machine-made file (FR-017a/FR-017b, cited in that same docstring).

That gives the failure directly: an operator hand-edits `episode.mp3` (state becomes `modified`), then runs `pc validate episode`. The provider re-derives from unchanged inputs, reproduces the *original* bytes, `output.hash === existing.output.hash` holds, and `recordVerdict` writes `validation: {state: 'passed'}` onto the record. The verdict is about the bytes the build produced; the file the operator will actually ship is the edited one, which no provider ever judged. `pc validate` — a gate — reports a pass on an artifact it did not look at. The module correctly refuses to rebuild over a modified artifact, but then quietly validates the thing it refused to touch instead of the thing that is there.

Blast radius: this is the failure mode a gate exists to prevent, it is silent, and the surrounding prose reads as though it were handled — so a downstream consumer (or the release-check verb) has no signal that the pass is vacuous. A fix is to hash the on-disk artifact at `existing.output.path` first and refuse when it diverges from `existing.output.hash`, naming `modified` and telling the operator that a hand-edited artifact has no provider verdict available (FR-006b's "absent is its own thing" applies here just as it does to a silent provider). That refusal is honest; the current `passed` is not.

### AUDIT-20260717-62 — Recursive Output Reconciliation Silently Treats Filesystem Errors As Empty Output

Finding-ID: AUDIT-20260717-62
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/run.ts:296-313

`readEntries` catches every error from `fs.readdir(dir, { withFileTypes: true, recursive: true })` and returns `[]`. The comment says a missing `output_dir` should flatten to “no entries,” but the implementation also flattens permission errors, transient I/O failures, unsupported recursive readdir behavior, and other filesystem faults.

The blast radius is high because this function is the only reverse check for undeclared files. If the walk fails after declared outputs have passed `isFile`, `assertOutputsAgreeWithDisk` can accept a provider run without proving there were no undeclared artifacts. A reasonable fix is to catch only the specific missing-directory case, such as `ENOENT`, and rethrow all other errors with provider/output-dir context.

### AUDIT-20260717-63 — Unconstrained `IdentitySchema` lets a manifest identity escape `dist/` and drive a recursive delete

Finding-ID: AUDIT-20260717-63 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/manifest/schema.ts:68 (`IdentitySchema`), src/providers/build.ts:118-119, 145-148

`IdentitySchema = z.string()` carries no constraint at all — no non-empty check, no separator refusal, no `..` refusal. Identities flow directly into filesystem paths in `build.ts`: `const outputDir = path.join(context.episodeDir, 'dist', `.pc-build-${id}`)`. Because `path.join` normalizes, a target identity of `../../../tmp/x` produces `outputDir = <episodeDir>/../../tmp/x` — outside `dist/`, outside the episode. That directory is then handed to the provider to write into, and on every exit path `buildTarget`'s outer `finally` runs `await fs.rm(outputDir, { recursive: true, force: true })`. A manifest value the schema accepts without complaint therefore selects the target of an unconditional recursive delete. Identities also key `graph.nodes`, `authored`, and the ledger's `artifacts` record, so an empty-string identity is equally admissible and yields `dist/.pc-build-`.

This directly contradicts the module's own stated contract. `RelativePathSchema`'s doc comment (lines 10-30) says it is "the single place the 'no directory traversal' refusal lives, so every caller that stores a filesystem path in a schema inherits the same invariant," and `ProfileNameSchema` (lines 44-56) was hardened for exactly this reason — a name carrying separators "would escape those directories." Identity received neither treatment even though it is interpolated into a path on the build hot path. `stage()`'s defense-in-depth guard (build.ts:205-215) checks only `output.relPath` against `distRoot`; it never sees `outputDir`, so nothing downstream catches this.

Blast radius: an operator or agent authoring an episode manifest — or a profile fetched from anywhere — can cause deletion of a directory tree outside the episode, silently, on a normal `pc build`. Even absent malice, an identity containing a `/` (a plausible naming convention, e.g. `audio/narration`) creates nested scratch dirs and a `.pc-build-audio` parent that the `rm` then removes wholesale. The fix is to give `IdentitySchema` the same shape `ProfileNameSchema` already has — a bare-name regex (or at minimum non-empty plus a refusal of `/`, `\`, and `..`) — and to sanitize/hash the identity where it is interpolated into `outputDir` rather than trusting it.

### AUDIT-20260717-64 — `hashPath` follows symlinks with `stat`, so the tree walker's symlink refusal is bypassed at the top level

Finding-ID: AUDIT-20260717-64 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/hash/path.ts:27-28 (with src/hash/tree.ts:57-62, 121-125)

`hashPath` calls `await fs.stat(fullPath)` (path.ts:27). `stat` follows symlinks. `hashTree` deliberately does not: `collectEntries` uses `lstat` with the comment "lstat, not stat: stat follows symlinks, and a followed link is one we would never notice" (tree.ts:55-62), and the root check rejects a symlinked root (tree.ts:121-125). The file's own doc says it is "the ONE place the file-or-directory question is asked" and that "the `stat` asks exactly one question — file or directory."

It asks a second question by implication, and the two callers get inconsistent policy. An input identity resolving to a symlink pointing at a *file* outside the episode directory is silently followed and hashed — the exact escape `tree.ts` refuses one level deeper. An input resolving to a symlink pointing at a *directory* takes the other branch (`stat` reports `isDirectory()`) and then dies inside `hashTree` on the root `lstat` symlink check with "is a symbolic link" — so the same construct is silently accepted for files and hard-rejected for directories. Both halves are wrong: the file case is a content-addressing hole (the hash claims to describe episode content that lives elsewhere and is not tracked), and the directory case is a build failure for a construct the codebase never decided to forbid at the identity boundary. Blast radius: an operator who symlinks `assets/narration -> ~/shared/takes` gets `pc build` failing with a message about hashed trees; an operator who symlinks a single `take-01.wav` gets a green `pc status` whose hash covers bytes no other machine has. The fix is to make `hashPath` use `lstat`, decide the symlink policy once at that boundary (reject, or resolve-and-record — but the same rule for files and directories), and state it in the doc comment that currently claims only one question is asked.

### AUDIT-20260717-65 — `writeLedger` rewrites the committed source of truth non-atomically

Finding-ID: AUDIT-20260717-65
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/ledger/store.ts:70-72

`writeLedger` does `await fs.mkdir(...)` then `await fs.writeFile(ledgerPath, text, 'utf8')` straight onto the live path. `writeFile` on an existing path truncates first and then writes, so the file is observably empty-or-partial for the duration. An operator interrupt (Ctrl-C during `pc build`), a crash, or ENOSPC mid-write leaves a truncated `ledger.yaml` on disk.

The failure mode is not "the last write is lost" — it is "the whole ledger is lost." `readLedger` distinguishes exactly two states: absent (returns `emptyLedger()`, store.ts:36-39) and present-but-unparseable (throws, store.ts:41-45). A truncated file lands in the second bucket, so every subsequent `pc status` / `pc build` / `pc release-check` on that episode throws `…/ledger.yaml: malformed YAML — …` until a human hand-repairs it. Every artifact record and every waiver — the accumulated build history the whole feature exists to hold — is behind that error. This surface is the one place the ledger is written; there is no recovery path in the diff.

The fix is the standard one: `stringify` to a sibling temp file in the same directory (`.production/ledger.yaml.tmp-<pid>` or similar), `fsync`, then `fs.rename` onto the target. `rename` within a directory is atomic on POSIX and on NTFS, so a reader sees either the old complete ledger or the new complete ledger, never a truncation. The mkdir already runs first, so the temp file has somewhere to live.

### AUDIT-20260717-66 — `renderStatus` and `toNodeJson` disagree on how "no producer drift" is represented; a `null` crashes the human renderer

Finding-ID: AUDIT-20260717-66
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/status.ts:96-118 (renderStatus), src/cli/status.ts:70-82 (toNodeJson)

Two readers of the same field in the same file encode absence differently. `toNodeJson` writes `producer_drift: node.producerDrift ?? null` and `identity: node.cause.identity ?? null` — the `??` operator defends against **both** `null` and `undefined`, which is the correct defensive posture only if the producing type can actually yield either. `renderStatus`, reading the identical field four lines later, tests `if (drift === undefined) { return [line]; }` — strict `undefined` only. If `state/resolve.ts` ever populates `producerDrift` as `null` (or is widened to `ProducerDrift | null` to match the JSON shape this file publishes), the human path falls through the guard and evaluates `drift.tool` and `drift.others.join(', ')` on `null`, throwing a `TypeError`. That `TypeError` is then swallowed by `runVerb` and reported as `pc status: Cannot read properties of null (reading 'others')` with exit 1 — the read verb that is contractually required to answer instead reports a refusal, in prose that names nothing about the episode.

The blast radius is that `pc status` (no `--json`) is the default human surface and the one an agent falls back to when JSON parsing is not wired; it dies on a shape that `toNodeJson` in the same file explicitly anticipates. The asymmetry is the evidence: you do not write `?? null` for a field you believe is only ever `undefined`. Either the source type is `| null` today (in which case this is a live crash) or it is not (in which case `?? null` is dead defensive code advertising a state that cannot occur). Both readings are defects; they differ only in severity.

A reasonable fix is to make the absence representation single-valued at the source — declare `NodeStatus.producerDrift?: ProducerDrift` (undefined-only, never null) and drop the `??` in favor of `node.producerDrift ?? null` being the *sole* undefined→null translation at the JSON boundary, with `renderStatus` using `if (drift == null)` so it is correct under both encodings regardless. The same applies to `cause.identity`.

### AUDIT-20260717-67 — A waiver pins the hash observed at write time, not the hash the human actually reviewed — the TOCTOU window silently launders unreviewed content

Finding-ID: AUDIT-20260717-67
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/cli/review.ts:148-163

The verb's entire reason to exist is stated at line 12: "an advisory `needs-review` is a question addressed to a person, and the system cannot answer it… Only a human saying so does." But the content the waiver pins is observed by the tool, at line 153, *after* the human has already made their decision and typed the command: `const resolution = await resolver.resolve(followed); … waivedHash: resolution.hash`. There is no way for the caller to state which content they reviewed, and no check that it is the same content the tool is about to pin.

Concretely: an operator runs `pc status`, sees `needs-review  script  (follows transcript)`, opens `transcript`, reads it, decides it is fine, and runs `pc review script --waive --reason "checked, no change to the claims"`. If `transcript` was rewritten in the interval — by a running craft tool, a `git checkout`, a collaborator's sync, or the operator's own editor autosaving a different buffer — `resolver.resolve(followed)` returns the *new* hash, and the ledger now records that a human accepted content nobody has read. The next `pc status` reports `fresh`. This is precisely the failure mode the code refuses two lines earlier for the `absent` case ("a waiver recorded now would claim a human accepted content nobody can read") — the same claim is made silently when the content is readable but *different*. The refusal guards the case where the tool cannot read the file and permits the case where the tool reads the wrong file.

Blast radius: the advisory edge is the feature's only human-in-the-loop gate, and the ledger record is durable and consulted by every subsequent `pc status`. A wrong pin does not fail loudly; it reports `fresh` forever. The fix is to let the decision carry its subject: accept `--expect-hash <hash>` (which `pc status --json` already publishes for the followed node), and refuse with a named error when the observed hash differs — "the content of `transcript` changed since you looked at it; re-review and re-run." Defaulting to observe-at-write-time is acceptable only if the verb also prints the pinned hash *before* writing and requires confirmation, which it does not (line 165 renders after the write).

### AUDIT-20260717-68 — The output declaration is never compared against the record — a changed `output.path` is a false-clean

Finding-ID: AUDIT-20260717-68
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/freshness.ts:135-243 (`assessFreshness` / `assessOutput`)

`assessFreshness` reads `node.inputs` from the manifest and compares it against `record.inputs` in **both** directions — the file argues at length (lines 88-101, the `input-removed` variant docs) that a one-directional comparison is a false-clean because "a removed input is a change to the input SET". That argument applies verbatim to the output declaration, and the output half does not make it: `assessOutput` is handed only `record.output` (`return assessOutput(resolver, node.id, record.output)`), and `node.output` is never read anywhere in this file. The manifest's declared output path is not compared against `record.output.path` at any point.

The consequence depends on what `readOutputBytes(id)` resolves against, and both branches are defects. If it resolves the **declared** path: an episode whose producer output path moved (`dist/ep.wav` → `dist/audio/ep.wav`) with the old bytes still on disk at the old path reports `output-absent` while `path: recorded.path` names the *old* path — the operator is told the wrong file is missing, and the state is derived from a path the check never read. If it resolves the **recorded** path: the node hashes clean against bytes at a path the manifest no longer declares and reports `consistent` → `fresh` → absent from the frontier, and `pc build` never runs, so nothing is ever emitted at the declared path. That second branch is precisely the `AUDIT-20260716-03` shape this file cites, relocated from the input set to the output declaration.

Blast radius: an unattended agent driving `pc next` after an output-path edit gets a clean frontier and ships the episode built at the stale path. The fix is symmetric with the input pass — compare `node.output.path` against `record.output.path` before `assessOutput`, and report a distinct assessment (`output-path-changed`, with `declared` and `recorded`) that `resolve.ts` maps to `stale`. `assessOutput` should also take the path it actually read, not `recorded.path`, so the reported path can never disagree with the bytes checked.

### AUDIT-20260717-69 — The atomic-ingest test proves only one arm of the split it claims to close

Finding-ID: AUDIT-20260717-69
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/build-atomic.test.ts:14-25, 100-128

The docblock at lines 22-25 claims "the bytes on disk and the recorded `output.hash` still AGREE — the two are never split, **whichever way an interruption falls**." The test only exercises one way. It forces `record` to throw and asserts `dist/` still holds `H_old` (lines 118-127). For that assertion to hold, the implementation must order the ingest as: run provider into staging → write record → rename staged bytes into `dist/`. That ordering necessarily opens the mirrored window: the record write **succeeds**, and then the rename fails or is interrupted (SIGINT between `writeLedger` returning and `rename` landing, EACCES/EXDEV on `dist/`, a full disk on the final link). In that state the ledger names `H_new` while `dist/<path>` holds `H_old` — the ledger asserting an origin for bytes that are not the bytes on disk, which is verbatim the condition the file's own docblock (lines 18-20) says "this system exists to make impossible."

Blast radius: an operator or downstream agent reads this file (or the AUDIT-20260716-14 disposition it anchors) and concludes ingest atomicity is closed and covered. It is half-covered. The uncovered half is the *operator-interrupt* case, which is the most likely one in practice — Ctrl-C during a long build is routine, ENOSPC on the ledger is not. Nothing in the fix as evidenced here makes record-then-rename a single atomic step, so the invariant is "at most one of the two windows is closed," not "the two never split."

A reasonable fix is a second test that injects failure at the rename boundary (e.g. inject a `BuildContext` whose commit step throws after the record write, or make `dist/` read-only after the record lands) and asserts the same agree-or-rollback invariant — plus, if that direction genuinely cannot be made safe, a stated invariant-first boundary in the docblock ("the record is written last-but-one; the residual window is X, recovered by Y") rather than a blanket claim of never-splits.

---

### AUDIT-20260717-70 — Integration global setup still races contract builds on shared dist

Finding-ID: AUDIT-20260717-70
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    vitest.config.ts:16-35

The integration project’s `globalSetup` builds and snapshots the CLI at lines 31-34, but the same `vitest.config.ts` defines the contract project separately at lines 37-43. `tests/contract/build-emit.test.ts` also runs `npm run build` against the shared repo `dist/`, and Vitest projects are not ordered by this config. A full `vitest run` can therefore have the integration setup copying `dist/` while the contract project is rebuilding it.

The blast radius is high because this is the main test command path, and the failure mode is a nondeterministic false red or false green around the built CLI artifact rather than a cosmetic ordering issue. The reasonable fix is to serialize all `npm run build` consumers that mutate `dist/`, or move the shared build/snapshot responsibility to a single suite-level mechanism that contract and integration tests cannot run through concurrently.

### AUDIT-20260717-71 — `cachedStore.put` write-through to the authoritative store is never verified — the test that claims to cover it is satisfied entirely by the cache

Finding-ID: AUDIT-20260717-71
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/assets/store.test.ts:196-208 (`works over the in-memory double just as it would over any other AssetStore`)

This is the only test in the file that exercises `cachedStore.put`, and every one of its three assertions can be satisfied without the bytes ever reaching `inner`. `expect(address).toBe(hashBytes(bytes))` only checks the returned address is derived from the content; `store.has(address)` and `store.get(address)` are both served by the cache layer the `put` just populated. If `cachedStore.put` wrote only the local cache directory and never forwarded to `inner`, this test would still pass green. The sibling tests take the opposite care — the read-through test explicitly seeds `inner` directly (line 105-107: *"bypassing the decorator — so the FIRST decorated `get` is a genuine cache miss"*) precisely to avoid this class of vacuity, so the discipline exists in the file and is just not applied to the write path.

Blast radius: an asset store's whole purpose is durable, addressable storage. A `put` that lands only in a machine-local temp/cache directory loses the asset on cache eviction or on any other machine, and the failure is silent — `has`/`get` keep answering correctly on the machine that wrote it, so the operator discovers the loss only when a second machine (or CI) tries to resolve the address. That is a data-loss shape guarded by a test that reads as if it covers it.

A reasonable fix: assert against `inner` after the decorated `put` — `await expect(inner.has(address)).resolves.toBe(true)` and `await expect(inner.get(address)).resolves.toEqual(bytes)` — and, to nail write-through rather than lazy backfill, check it *before* any decorated `get`. `MemoryAssetStore` is already imported and directly inspectable (`store.size()` is used at line 60), so this costs two lines.

### AUDIT-20260717-72 — Non-input causes fall back to falsely causal input chains

Finding-ID: AUDIT-20260717-72
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/chain.ts:204-210

`causalInputs()` treats any cause whose `identity` is absent or no longer in `node.inputs` as a reason to walk every declared input. That is correct for some provenance-style answers, but it is wrong for derived states whose cause is owned by the node’s output, especially `modified` / `output-edited` and `invalid` / `validation-failed`. For those states, the declared inputs did not cause the state; the edited output or failed validation did.

The blast radius is high because `pc explain` is the agent-facing causal interface: `src/cli/explain.ts` describes it as walking “the causal chain behind one node’s state, back to the authored inputs responsible.” For a `modified` artifact, the system’s own model says rebuilding is the wrong remedy because it can destroy a human edit, but this fallback will still render upstream inputs as causal links. A reasonable fix is to make `causalInputs()` branch on `status.cause.code` / `status.state`: follow named input causes for `input-changed` and `input-absent`, show full provenance only for states where that is the intended answer, and stop at the root for output-owned causes such as `output-edited` and `validation-failed`.

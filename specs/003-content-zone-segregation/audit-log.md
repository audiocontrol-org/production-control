---
slug: 003-content-zone-segregation
targetVersion: ""
---

# Audit log — 003-content-zone-segregation

## 2026-07-26 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260726-01 — A `..` segment classifies as `ai-permitted` — the escape direction fails open

Finding-ID: AUDIT-20260726-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/zoning/classify.ts:31-38

`directorySegments.some((segment) => segment.startsWith('.'))` treats `..` as a dot-directory. So `classifyZone('../secrets/out.wav')` → `ai-permitted`, and `classifyZone('a/../../b/c.md')` → `ai-permitted`. The permissive zone is the answer for every path that climbs out of the production root. The docstring at lines 17-19 waves this off — *"no `..` climbing above it — that is the caller's concern, not this function's, per Rule 5"* — but the function is simultaneously advertised as "total", and a violated precondition here does not produce an error, it produces the **least safe** verdict. That is a false-safe of exactly the shape the design round `f1b19b9 design(zoning): close the false-safe and escape holes` set out to eliminate.

Blast radius: the enforcement predicate is asymmetric. For impure output the check is "must be `ai-permitted`", so a path that escaped containment upstream gets waved through by zoning rather than refused; zoning contributes nothing as defense-in-depth precisely in the case where the primary containment check has already failed. (The authored direction fails safe, which is why the dirty-fixture test in `audit-zones.test.ts` doesn't surface this.) The realpath containment in `run.ts` and `build.ts` is the primary guard, but the whole point of a second lexical layer is that it holds when the first one has a hole.

Fix: make the precondition enforced rather than assumed — `throw` on any `..` segment (per the project's "no fallbacks; throw with a description of the missing data" rule), or at minimum classify `..` as `human-safe` so the failure mode is a refusal rather than a permit. A one-line unit case (`expect(() => classifyZone('../x.md')).toThrow()`) pins it.

### AUDIT-20260726-02 — `.ai/` as the *committed* durable record has no gate proving it is actually tracked

Finding-ID: AUDIT-20260726-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/readme/generate.ts:65-69, src/zoning/route.ts:9-16

The README copy now tells the operator that impure bytes *"are COMMITTED (under `.ai/`) as the durable record"* (line 68), and `route.ts` documents `dist` as "Gitignored, not dot-zoned" while `.ai` is the opposite. Both are claims about VCS state that nothing in this diff verifies. `.ai` is a widely-used convention for *ephemeral* AI scratch directories, and it appears in many operators' global gitignore (`~/.config/git/ignore`) alongside `.aider*`, `.cursor`, `.claude`. A global-ignore hit is invisible in the repo, produces no warning from `git add .`, and silently converts the feature's central guarantee — the non-reproducible bytes are recoverable because they are committed — into data loss on the next clean checkout.

The dot-prefix opens a second, independent channel: dot-directories are excluded by default from a large fraction of the tooling that consumes a content tree — `glob`/`fast-glob` without `dot: true`, `npm pack`'s file selection, Jekyll/GitHub Pages, several static-site scanners, and `rsync` filter rulesets. This diff moves durable, human-consumed content (`ai-generated/` → `.ai/`) into exactly that blind spot and updates only the prose that describes it. No fixture in the diff walks the tree the way a packager or site generator would.

Blast radius: silent absence rather than a loud failure, which is the worst class for an unattended consumer. A reasonable fix is a doctor/validator rule (the feature already has `pc audit-zones` as a natural home) that asserts (a) `git check-ignore` returns non-ignored for `impureOutputRoot()`, including global and `core.excludesFile` sources, and (b) `pureOutputRoot()` *is* ignored — and refuses loudly when either is false, rather than leaving both as comments.

### AUDIT-20260726-03 — Realpath containment resolves the output root itself, so a symlinked `dist/`/`.ai/` escapes the episode entirely

Finding-ID: AUDIT-20260726-03 (claude-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/build.ts:225-245 (the `(c) REAL-PATH containment` block)

The guard's own comment states it catches "a symlinked component, **or the root itself being a symlink**." The code does not. `const realOutputRoot = await fs.realpath(outputRoot)` (line 234) resolves the root before comparing, so containment is measured *relative to wherever the root points*. If `<episodeDir>/.ai` (or `<episodeDir>/dist`) is a symlink to `/tmp/elsewhere`, then `realOutputRoot === /tmp/elsewhere`, `realParent` is at/under it, `realRel` is an ordinary relative path, and the check at line 238-245 passes — while the bytes land outside the episode directory and `recordedPath` still records `.ai/foo.md`. The lexical guard (b) cannot see this either, by construction. The comparison the invariant actually needs (`realOutputRoot` is within `realEpisodeDir`) is never made; `realEpisodeDir` is computed at line 233 and used only to format the error message.

The blast radius splits by purity. For **impure** output, guard (d) is the only thing left, and it is a fail-open equality test (see finding -04). For **pure** output there is *no* remaining guard at all — (d) is explicitly impure-only — so a symlinked `dist/` gives a build target unchecked write access anywhere on the filesystem, with production-control recording the write as episode-relative. An adopter who symlinks `dist/` to an external volume (an ordinary thing to do) silently disables FR-009 for every pure target, and the recorded provenance stops describing where the bytes are.

A reasonable fix: keep `realpath(episodeDir)` and derive the expected root as `path.join(realEpisodeDir, root)` rather than realpath'ing `outputRoot`; or add an explicit assertion that `path.relative(realEpisodeDir, realOutputRoot) === root` before the destination comparison, and refuse a symlinked output root by name. Either way the comment at 225-232 must be brought back in line with what the code proves.

### AUDIT-20260726-04 — `ai-generated/` → `.ai/` relocation ships with no upgrade path for existing episodes

Finding-ID: AUDIT-20260726-04
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/build.ts:113-114 (`impureOutputRoot()` replacing the `'ai-generated'` literal); missing surface across the audited range

Line 113 replaces the hardcoded root pair `'ai-generated' | 'dist'` with `impureOutputRoot()` / `pureOutputRoot()`, and commit `57a4db7` retargets impure output to `.ai/`. This changes the recorded path of every impure artifact. Nothing in the audited range addresses what happens to an episode that already has artifacts on disk and records in its committed ledger under `ai-generated/`: the commit subject for `57a4db7` says "migrate fixtures", i.e. the repo's own test data was updated, not adopter data. There is no migration verb, no doctor rule, no legacy-read compatibility, and no note in this chunk. `src/zoning/route.ts` is in another chunk and I could not read it, so I cannot rule out a compatibility read-path there — but if one exists it is not visible from any surface in this chunk, and the ledger records no task for a migration.

Blast radius on **upgrade** (the checklist's fresh-install-vs-upgrade axis): after upgrading, `pc build` writes to `.ai/`, the old `ai-generated/` tree is orphaned but still referenced by committed records and README output, and any `.gitignore` / tooling entry naming `ai-generated/` now guards nothing while the new `.ai/` tree may be uncommitted-and-unignored. An adopter's first post-upgrade build produces a repo whose provenance records point at one tree and whose artifacts sit in another — exactly the class of drift this feature exists to prevent. Fresh installs are unaffected, which is what makes this easy to miss in the repo's own green suite.

A reasonable fix is an explicit migration surface (a `pc` verb or a doctor rule) that detects `ai-generated/` on disk or in records and either relocates + rewrites the records or refuses with instructions, plus a stated upgrade note. Silence here is the failure mode.

### AUDIT-20260726-05 — Escape refusal can create directories through an escaping symlink before it throws

Finding-ID: AUDIT-20260726-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/build.ts:221-235

`stage()` calls `fs.mkdir(path.dirname(destination), { recursive: true })` before realpath containment. If a provider returns a nested path under a symlinked directory, e.g. `link/deep/out.bin` where `.ai/link -> ../human`, this `mkdir` follows the symlink and creates `../human/deep` before lines 233-245 detect and refuse the escape. The current tests cover `.ai/link/out.bin`, where the symlink itself already exists and no nested directory is created, but they do not cover the multiline/composition channel opened by nested output paths.

The blast radius is high because the feature’s build-time guarantee says provider escape is rejected before visible filesystem mutation/staging. As written, an escaping provider can still mutate human-safe or outside-root directories even though the artifact is not copied or recorded. A reasonable repair is to make directory creation symlink-aware: walk/create each parent segment while refusing symlink traversal, or perform containment checks against the nearest existing parent before creating the remaining directories.

### AUDIT-20260726-06 — `classifyZone`'s "above-root exclusion (FR-003)" block asserts nothing that could fail if the guarantee were broken

Finding-ID: AUDIT-20260726-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/zoning/classify.test.ts:77-92

The block titled `above-root exclusion (FR-003)` asserts only `classifyZone('target/out.md') === 'human-safe'`, `'build/artifact.txt'`, `'dist/index.html'`, plus two already-covered dot cases (`.ai/output/file.md`, `build/.cache/temp.txt`). Every one of those inputs is a plain dot-free relative path already covered by the golden cases at lines 7-15; none of them exercises the property the block names. The prose comment at lines 79-84 concedes this outright — "the function sees only a relative path; segments above the production root are never in its input" — i.e. the test states the precondition as an assumption and then tests nothing about it. If a caller ever hands `classifyZone` an absolute or root-prefixed path (the diff range includes a commit explicitly about `realpath` containment ordering, `673af26`/`673f...` "realpath containment ordering + impure zoning refusal", so absolute paths demonstrably exist in this feature's call graph), a path like `/Users/x/.config/project/dist/out.md` would hit the any-dot-wins rule on the `.config` ancestor and classify `ai-permitted` — the exact false-safe/false-permitted flip the FR-003 language exists to prevent, and this suite would stay green.

Blast radius: an agent or adopter reading this file concludes FR-003 is covered by a regression guard when it is covered by an untested comment. The classifier is the single decision point for routing and for both refusal directions (T012/T017), so a wrong classification silently routes AI output into a human-safe location or refuses an authored node with a nonsense reason, with no test to catch the regression.

A real guard would pin the contract at the boundary: either assert `classifyZone` refuses/throws on an absolute input (`expect(() => classifyZone('/abs/.hidden/out.md')).toThrow()`), or assert it classifies `human-safe` despite the dot-prefixed *above-root* ancestor. One of those two is the actual FR-003 behavior; the current block does not tell a reader which.

---

### AUDIT-20260726-07 — Every impure integration path now requires a static `impure` declaration, so the decl-impure × response-pure state opened by that new field has no fixture anywhere in this chunk

Finding-ID: AUDIT-20260726-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/build.test.ts:56-58, tests/integration/readme.test.ts:26-30, tests/integration/validate.test.ts:41-43, tests/integration/validator.test.ts:48-57

This diff adds a new accepted value to the profile surface in four fixtures — `provider.impure = { reason }` — to satisfy FR-012's corroboration rule. Channel-enumeration on that addition: the **value** channel is the reason string (covered), the **state** channel is the cross product of declaration × response. Three of four cells now have fixtures: pure-decl × pure-response (the default `chainEpisode()` / `episode()` calls), impure-decl × impure-response (every test touched here), pure-decl × impure-response (refused — the reason these edits were needed, covered in the sibling chunk's `tests/unit/providers/invoke-impurity.test.ts`). The fourth cell — **impure-decl × pure-response** — is newly reachable *because of this diff* and has no fixture in any of these four files.

That cell is not exotic; it is the normal case for the very providers that motivate a static declaration. A provider you declare impure because it is *sometimes* nondeterministic will, on many runs, return a pure response. The unanswered questions are behavioral and provenance-visible: does the output route to the committed `.ai/` tree (declaration wins, conservative) or to gitignored `dist/` (response wins)? Does `pc readme` file it under `## AI-generated` or `## Reproducible`? Does `pc validate` refuse it under FR-017a, or attempt revalidation? Two of these files sit exactly one environment variable away from exercising it: drop `withMode('impure')` in `readme.test.ts:47` or `buildImpure` in `validator.test.ts:66` and the fixture is already in that state, with nothing asserting what should happen.

Blast radius: an adopter in this configuration gets routing and README classification that no test pins, so it can silently flip on any refactor of the routing precedence. If the response wins, irreproducible bytes land in gitignored `dist/` while the README claims AI-generated provenance — the exact drift this feature exists to prevent. A reasonable fix is one integration test per surface (build routing + readme classification) that declares `impure` and runs the provider in pure mode, asserting the declaration is the conservative upper bound.

---

### AUDIT-20260726-08 — `.ai/` is asserted only as a path string; nothing proves the "committed, not gitignored" property the comments claim, and the rename to a dot-directory is exactly what would break it

Finding-ID: AUDIT-20260726-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/build.test.ts:170-174, tests/integration/validate.test.ts:157-160

The load-bearing claim, restated in the comments this diff edits, is a *git* property: "An impure output is not reproducible, so it lands in the COMMITTED `.ai/` tree, not gitignored `dist/` — the bytes are the durable record and must be kept" (`build.test.ts:170-171`), and "Impure output is committed under `.ai/` (not gitignored `dist/`): its irreproducible bytes are the durable record" (`validate.test.ts:155-156`). Every assertion under those comments checks only a string: `expect(record.output.path).toBe('.ai/voiceover.out')` (line 172) and `fs.readFile(path.join(dir, '.ai/voiceover.out'))` (line 158). Not one asserts the file is actually trackable — the durable-record property is documented, never tested.

That gap was low-risk while the directory was `ai-generated/` and it is materially higher now. `.ai` is a dot-directory: it is a plausible entry in a user's global gitignore or a tool's default ignore set, it is skipped by default by many recursive-copy and glob helpers unless `dot: true` is passed, and `npm pack` / file-list tooling treats dotfiles inconsistently. The rename moved the artifact tree into precisely the namespace where "silently invisible" is the common failure mode, and the test suite's only defense is a path-equality check that passes identically whether or not git will ever record the bytes. Note also that `copyFixture` is unchanged by this feature (it appears in no chunk's file list) while the sibling commit `57a4db7` migrated fixtures into `.ai/` — if that helper does not copy dotfiles, migrated fixture content is silently absent from every fixture copy.

Blast radius: an adopter's irreproducible outputs are generated, recorded in the ledger, described by the README as durable provenance, and then never committed — the feature's central guarantee fails silently and the test suite stays green. A reasonable fix is one assertion in the build path that the emitted `.ai/` file is not matched by the episode's ignore rules (`git check-ignore --no-index` against the fixture, or an explicit read of the shipped `.gitignore` asserting `.ai` is absent and `dist` present), plus an explicit fixture round-trip proving `copyFixture` carries `.ai/` contents.

---

### AUDIT-20260726-09 — Audit lane degraded: chunk `ecfb4e19fe0283f1` was dispatched with an empty diff payload

Finding-ID: AUDIT-20260726-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    audit dispatch for chunk `ecfb4e19fe0283f1` (declared file: `tests/integration/zoning.test.ts`); the `## Diffs` section of the prompt

The prompt declares `Files in scope: tests/integration/zoning.test.ts` and then presents a `## Diffs` heading with no content beneath it — zero hunks, zero lines. The other eight chunks are listed by file only ("context for cross-file dependencies this chunk cannot see"), so there is no fallback source of the audited text either. This session additionally has no file-reading capability (`Read`/`Grep`/`Glob`/`Bash` are not in the tool set and are not registered as deferred tools; `ListMcpResourcesTool` returns no resources), so I cannot recover the file from disk to substitute for the missing payload. Every check I would run on this chunk — whether the US1/US2/US3 integration tests assert the routing *contract* (impure output lands under the dot-zoned `.ai` root, authored-under-dot-zone refusal, realpath-containment escape) rather than merely asserting the refusal string; whether the `.ai` in-place-edit boundary regression (T023) actually exercises the boundary; whether fixture migration from `57a4db7` left stale paths; whether the file stayed under the 500-line gate the sibling commits `1ecfaab`/`4f84b77` were enforcing — is unrunnable against an empty payload.

The blast radius is on the operator's triage, not on adopters: an audit lane that returns nothing looks identical to a lane that returned nothing *because the code is clean*. Per the fleet-degradation pricing driver, a round's "0 HIGH" computed over a fleet containing a zero-payload lane is weaker cross-model agreement than the count suggests, and `tests/integration/zoning.test.ts` is the single file carrying the end-to-end proof for all three user stories in this feature — the highest-value surface in the range to leave unreviewed. If this lane is counted as a clean pass, the feature converges with its primary integration-test surface unaudited by this model.

A reasonable fix is on the dispatch side: (1) have the chunker fail loud when a chunk's rendered diff body is empty rather than dispatching it — an empty body is a chunking bug (likely a path/rename mismatch between the chunk manifest and `git diff 2c90a315...`), not a legitimate "no changes" state, since the chunk would not exist if the file were unchanged; and (2) mark the lane `degraded` in the run record so the convergence tally prices it as a missing model rather than a quiet one. Re-dispatch this chunk with the populated diff before treating round results as converged.

## 2026-07-26 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260726-10 — "No bytes written outside" is asserted at exactly one filename, so a residual escape through the scratch path would still ship green

Finding-ID: AUDIT-20260726-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/zoning-symlink-containment.test.ts:160, :187, :216

The AUDIT-03 describe title claims refusal happens "with no bytes written outside" (line 130-131), but each test verifies that claim with a single point probe: `expect(await exists(path.join(outside, 'voiceover.out'))).toBe(false)` (line 160), the same at line 187, and `path.join(humanSafe, 'voiceover.out')` at line 216. Nothing asserts that the escaped-to directory is *empty*. Any byte or directory that lands outside the root under a different name passes unnoticed.

That is not hypothetical for the PURE case. The test's own comment at lines 174-175 states "`dist/` is created by the build's scratch step; plant the symlink up front so the real `dist/` is never a plain directory" — i.e. the author's model is that the build materializes scratch state under `dist/`. `runnerEmitting` (lines 68-71) unconditionally does `fs.mkdir(dirname(full), {recursive: true})` and `fs.writeFile(full, ...)` against `request.output_dir` *before* returning, so if `output_dir` is scratch beneath the symlinked `dist/`, the fake provider's bytes land at `<outside>/<scratch>/voiceover.out` and the assertion at line 187 — which only looks at `<outside>/voiceover.out` — is green while the invariant the test exists to protect is violated. I cannot confirm which reading of `output_dir` is true without reading `src/providers/build.ts`, and that is precisely the point: the assertion is written so that either reading passes, so it does not discriminate.

Blast radius: this is the regression guard for AUDIT-03, an escape that writes bytes outside the episode. As written, a future refactor that reintroduces write-before-containment (or moves scratch under the output root) leaves the test suite green, so the guard's protection is weaker than the commit message asserts. Fix: replace the point probes with a directory-emptiness assertion — `expect(await fs.readdir(outside)).toEqual([])` for lines 160/187, and the equivalent (excluding pre-created entries) at line 216. That assertion holds under every reading of where scratch lives.

---

### AUDIT-20260726-11 — The "no cache directory is invented anywhere" assertion is vacuous — it checks a directory the miner was never told about

Finding-ID: AUDIT-20260726-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    editorial-tooling/test/miner-cache-fidelity.test.mjs:18-31

Line 18 creates `const observed = tempDir('qm-nocache-')` and then never passes it to anything — `mine({ sources, model: first })` at lines 22/24 receives no `cacheDir`, and `QUOTE_MINER_CACHE_DIR` was deleted at line 17. So `observed` is a directory `mkdtemp` just created, that no production code has any way to name. `assert.deepEqual(filesIn(observed), [], 'no cache directory is invented anywhere')` (line 31) is therefore true by construction and will remain true for every possible implementation of `mine()`.

The assertion's stated contract is the load-bearing half of this whole `test()` block: "miner cache: DISABLED unless asked for". If a regression made `mine()` fall back to a default cache location — `process.cwd()/.quote-miner-cache`, `os.tmpdir()`, `~/.cache/...` — every other assertion in this subtest still passes (both runs re-mine only if the fallback cache is cold; a *stale* fallback cache would trip lines 26-27, but a cold-then-warm fallback within one run would not, and cross-run persistence would break the *next* run, not this one), and line 31 would still pass because the invented directory is not `observed`. Blast radius: an opt-in-only caching guarantee — the thing that keeps un-asked-for state off an adopter's disk and out of a supposedly deterministic run — is guarded by an assertion that cannot fail. This file is also exactly where split-induced fidelity loss already happened once (`b3d8e48 test(editorial-tooling): restore no-cache determinism assertion dropped in the split`), so the "the sibling file covers it" reading is not available.

A fix has to give the assertion a real subject: chdir into (or otherwise scope the run to) `observed` and assert the whole subtree is empty afterward, and additionally snapshot a known default-fallback candidate (cwd and `os.homedir()`-relative cache paths) before/after the two `mine()` calls and assert no new entries appeared. Whatever surface is chosen, the test must be able to fail — the current one cannot.

### AUDIT-20260726-12 — Chunk ecfb4e19fe0283f1 dispatched with an empty diff body — this lane produced no coverage of `tests/integration/zoning.test.ts`

Finding-ID: AUDIT-20260726-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    the audit dispatch itself — chunk `ecfb4e19fe0283f1`, declared scope `tests/integration/zoning.test.ts`

The prompt declares `Files in scope: tests/integration/zoning.test.ts` and then presents a `## Diffs` heading with no content beneath it. Every other chunk in the manifest (`35a25a79…`, `432428db…`, `f4649b03…`, etc.) is listed only as a file-list for cross-file context, which is expected; but this chunk is the one I was assigned to audit, and its diff body is empty. The session also exposes no `Read`, `Grep`, `Glob`, or `Bash` tool — I searched the deferred-tool registry for all four and got only MCP/task/cron/monitor tools back — so I could not recover the file contents out-of-band either. There is therefore no evidence surface in front of me: no hunks to walk, no line numbers to anchor to, and no way to check the integration test against the routing code it exercises.

This matters because of the fleet-degradation pricing driver in the process controls. `tests/integration/zoning.test.ts` is the US1 integration surface for impure-output routing, refusal, and escape containment — the tests that pin the feature's central safety claim. If this lane is tallied as a participating model and it silently contributed zero coverage of that file, the round's cross-model agreement over the zoning integration tests is computed over a smaller fleet than the operator thinks it is. Concretely: a "0 HIGH on the integration tests" conclusion drawn from this round would be resting on however many siblings actually received the hunks, minus one. A quiet lane and a clean lane are indistinguishable in the triage table unless the degradation is recorded, which is precisely the failure mode US2 observability exists to prevent.

A reasonable fix is on the dispatch side, in two parts. First, the chunker should refuse to emit a chunk whose declared file list is non-empty while its rendered diff body is empty — that combination is always a bug (an over-aggressive hunk filter, a path that resolved to no changes against the `2c90a315` base, or a truncated render), and failing loud beats shipping a model a blank page. Second, the triage step should treat a zero-hunk chunk as a degraded lane rather than a participating one, so the round's convergence claim is priced over the fleet that actually saw content. Until the diff for `tests/integration/zoning.test.ts` is re-dispatched with hunks present, this file should be treated as **unaudited by claude in this round**, not as clean.

### AUDIT-20260726-13 — `.gitignore` regression gate probes repo-root paths, not the nested paths artifacts actually occupy — a nested ignore rule breaks the guarantee with the gate still green

Finding-ID: AUDIT-20260726-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/ai-zone-tracked.test.ts:69-71, 84-97

Both probes are built by joining the root name onto a bare filename and are resolved against the repo root: `path.posix.join(impureOutputRoot(), 'probe.out')` → `.ai/probe.out`, and `path.posix.join(pureOutputRoot(), 'probe.out')` → `dist/probe.out`. But an impure artifact never lands at `<repo>/.ai/...` — it lands at `<episode-dir>/.ai/<target>.out`, which the sibling test in this same chunk pins directly (`tests/integration/build.test.ts:176-177`: `record.output.path === '.ai/voiceover.out'`, resolved as `path.join(dir, '.ai/voiceover.out')` where `dir` is an episode directory). Gitignore patterns are position-sensitive in exactly the way this gap exploits: a future rule such as `content/**/.ai/` or `episodes/*/.ai` would ignore every real impure artifact while leaving the root-level `.ai/probe.out` probe unignored, so the assertion on line 90 (`.toBe(1)`) still passes. The failure the header names — "the durable record silently becomes data loss with no test ever going red" — is precisely the failure this construction cannot see.

The same hole exists in the sibling direction and is arguably easier to trip: if `.gitignore` carries an anchored `/dist` rather than `dist/`, the root probe is ignored (exit 0, test green) while `<episode>/dist/…` build output is *not* ignored, so reproducible output starts getting committed. The test's own non-vacuity argument on lines 84-89 is therefore also anchored at the wrong depth.

Blast radius: test-efficacy only, and only conditional on a future `.gitignore` edit — but this test is the *sole* automated guard for the feature's central claim ("impure bytes are the durable, committed record"), and its failure mode is silent, unbounded loss of unreproducible artifacts, discovered only when someone looks for bytes that were never committed. A reasonable fix: derive the probe from a realistic episode-relative location as well as the root — e.g. probe both `${impureOutputRoot()}/probe.out` and `${<fixture or configured content dir>}/ep/${impureOutputRoot()}/probe.out` — and assert on both, so a positionally-anchored rule cannot pass. If the content-root location is not knowable from `src/zoning/route.ts` alone, at minimum probe one nested depth (`a/b/${impureOutputRoot()}/probe.out`), which is what distinguishes `.ai/` from `/.ai/`.

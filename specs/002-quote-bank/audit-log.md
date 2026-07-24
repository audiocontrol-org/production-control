---
slug: 002-quote-bank
targetVersion: ""
---

# Audit log — 002-quote-bank

## 2026-07-24 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260724-01 — Declared outputs are validated with symlink-following `stat` while the undeclared-file walk skips symlinks, so a symlink output escapes both halves of the reconciliation

Finding-ID: AUDIT-20260724-01 (claude-01 + claude-02 + claude-05 + codex-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/run.ts:228-264 (`assertOutputsAgreeWithDisk`), ~271-278 (`isFile`), ~288-300 (`listFilesRelative`)

The containment check added at `run.ts:234-244` is purely *lexical*: `path.resolve(request.output_dir, output.path)` then `path.relative`. It proves the declared **path string** does not traverse; it proves nothing about what the path resolves to on disk. The existence check immediately after uses `isFile()`, which calls `fs.stat` — and `fs.stat` follows symlinks. So a provider that writes `output_dir/master.wav` as a symlink to `/Users/op/secrets/other.wav` (or to any file outside `output_dir`) passes the containment check (`master.wav` is lexically inside) and passes the existence check (`stat` follows the link and reports `isFile() === true`). Downstream hashing/ingestion then reads content from outside `output_dir` and records it in the ledger as a provider-produced output. That is exactly the false-clean the comment at 230-233 claims to be closing, and it is the FR-036 invariant the block cites.

The same asymmetry opens the *other* direction. `listFilesRelative` filters on `entry.isFile()` from `fs.readdir(..., {withFileTypes: true})`, and a `Dirent` for a symlink reports `isSymbolicLink()`, **not** `isFile()` — so every symlink under `output_dir` is invisible to the undeclared-file walk. Node's recursive `readdir` also does not descend through symlinked directories, so an undeclared symlink-to-a-directory hides an entire subtree. Rule 5 ("a provider MUST declare everything it produces") is therefore unenforced against any artifact the provider chooses to materialize as a link. Blast radius: an adopter running a third-party or buggy provider gets out-of-tree bytes recorded as in-tree provenance, silently, with a green build — the ledger says the file came from this provider run and the reconciliation that was supposed to catch it reported clean.

Fix: `isFile` should `fs.lstat` (or `stat` plus an `lstat` symlink assertion) and refuse a symlink declared output by name, and `listFilesRelative` should count non-regular entries (`!entry.isDirectory()`) as present-but-undeclared rather than skipping them, so a symlink surfaces as a named refusal in one direction or the other instead of falling through both.

### AUDIT-20260724-02 — `Case 11b` pins `followed-changed` as the cause for a fresh install where nothing has changed

Finding-ID: AUDIT-20260724-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/unit/state/resolve-validation.test.ts:257-295 (the `Case 11b (AUDIT-20260716-12)` block, specifically `expect(node.cause.code).toBe('followed-changed')`)

The test sets up a day-one episode: `script.md` and `narration.wav` both freshly written, `ledger.reviews` empty. Its own comment states the situation plainly — *"nothing has drifted since authoring, because there is no recorded baseline to have drifted FROM"* — and then asserts `node.cause.code` is `followed-changed`. The state (`needs-review`) is defensible and well argued in the comment. The **cause** is not: it asserts a factual claim about the followed node (`spoken` changed) that the fixture demonstrably contradicts. Per FR-007 every node carries a cause whose `message` is operator-facing (`Case 10` asserts `cause.message.length > 0`), so this is the string `pc status` / `pc explain` will print. On a fresh checkout the operator is told their script changed when it never did, and the only honest remedy (`pc review`) is not what the message points at.

This is the *same class of defect* as the finding the adjacent `Case 8b (AUDIT-20260716-30)` test exists to close — that one rejected `absent`/`path-absent` on `tracker` because it was "a claim about `spoken`'s file carried on `tracker`, whose own bytes are present and readable." Here a claim of *changed* is carried on an edge that has never changed. `Case 8b` shows the codebase already models distinct causes for distinct followed-node situations (`followed-absent` vs `followed-changed`), so the fix is cheap and in-idiom: introduce a third cause (`never-reviewed` / `no-baseline`) for the empty-`reviews` case, keep the state at `needs-review`, and retarget this assertion. Blast radius: the assertion *pins* the wrong string, so a later correction now requires editing a test that carries an `AUDIT-...` provenance tag — an unattended agent will read the tag as "this was adjudicated, do not touch" and preserve the false message indefinitely.

### AUDIT-20260724-03 — Chunk advertises 48 files "in scope" but ships diff content for only 4 — the quote-bank fixture corpus is audited by nobody

Finding-ID: AUDIT-20260724-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    chunk `13b39982699caaf7` manifest ("Files in scope") vs. its "Diffs" section

The chunk header enumerates 48 in-scope files, including the entire US1 acceptance corpus: `editorial-tooling/test/fixtures/banks/*.yaml` (16 bank fixtures — `fabricated-span.yaml`, `reconstruction-mismatch.yaml`, `overlapping-ocr-fix.yaml`, `location-ambiguous.yaml`, `duplicate-quote-id.yaml`, …), `editorial-tooling/test/fixtures/banks/expected.json` (the expected verdicts), and `editorial-tooling/test/fixtures/sources/{bradford,plymouth,winthrop}.txt`. The "Diffs" section contains content for exactly four files: `.prettierrc.json`, `.specify/feature.json`, `.stack-control/audit-barrage-config.yaml`, `.stack-control/config.yaml`. Every fixture is plain UTF-8 text (`.yaml`, `.json`, `.txt`) — none is binary, so binary-suppression does not explain the omission.

These are not incidental files. Commit `33d2355` ("T003: hand-written quote-bank fixtures + expected verdicts (US1 RED)") makes them the executable definition of the validator's contract: `expected.json` *is* the pass/fail oracle that `bd49221` (T008 GREEN) was written against. A wrong or self-satisfying expected verdict — e.g. an `expected.json` entry that asserts `valid` for `fabricated-span.yaml`, or a source `.txt` whose bytes were retro-fitted to whatever the validator happened to reconstruct — is precisely the class of defect that makes a green US1 suite meaningless, and it is invisible in every other chunk (the fixtures appear in no other chunk's file list).

Blast radius: the barrage will record chunk `13b39982699caaf7` as audited and, if the other lane is likewise payload-bound on this chunk, will price a 0-HIGH verdict over a chunk whose substantive content was never transmitted. The operator reads "clean" and ships an unaudited acceptance oracle. This is the silent-truncation failure the process drivers call out ("No silent caps… log what was dropped"): the round reads as covered when the fixture corpus received zero coverage. A reasonable fix is for the chunker to either include text-fixture content in the payload or emit an explicit `NOT TRANSMITTED` list per chunk so the synthesis step can price the gap rather than absorb it.

---

### AUDIT-20260724-04 — Liveness windows are fixed constants while timeouts scale per-KB, so the watchdog tightens as payloads grow — re-creating the false-kill class it was twice widened to fix

Finding-ID: AUDIT-20260724-04
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    .stack-control/audit-barrage-config.yaml:166,170-171,207-209 (values); ≈152-165 and ≈190-206 (rationale)

`timeout` is derived from payload size — `max(floor, ceil(secs_per_kb × payload_KB))` (line ≈98). `liveness_window_seconds` is a hard constant. The two therefore diverge monotonically with payload:

- claude: window `300`, timeout `max(420, 13 × KB)`. Past ~32 KB the budget grows; the window does not.
- codex: window `280`, timeout `max(300, 7 × KB)`. Past ~43 KB the budget grows; the window does not.

The window is being justified against *observed healthy completion time* — "300s comfortably exceeds the ~170-233s healthy completion (never false-kills)" (≈163-164), measured on "14-24KB no-grounding payloads" (≈142). But healthy completion time is payload-dependent; that dependence is the entire premise of `timeout_secs_per_kb`. Sizing the timeout linearly in KB while pinning the staleness window to a constant calibrated on 14-24 KB means the watchdog becomes proportionally *stricter* exactly as runs get slower — the mechanism that produced both prior false-kills ("a >60s gap tripped a FALSE killed-no-liveness, degrading the fleet", ≈157; "still false-killed on exactly 1 of 43 chunks", ≈199).

The codex comment's own justification is arithmetically wrong at the calibration point: "280 gives it nearly the full budget before a liveness kill, mirroring the claude lane (300s window under a 420s timeout)" (≈202-203). 300/420 leaves 120 s of post-window budget (71% ratio); 280/300 leaves 20 s (93%). Those are not mirrored, and at 93% the watchdog has nearly stopped doing its stated job — "killed … instead of waiting out the full timeout" (≈92) — while retaining full capacity to false-kill.

Blast radius: a false `killed-no-liveness` on any single chunk drops a two-lane fleet below `--require-models 2` and, per the file's own account, "FATALs the whole 2-lane floor-of-2 pass" (≈200) — a ~40-chunk govern run discarded for one transient silence. The fix is to derive the window the same way as the budget (e.g. `window = min(timeout − margin, max(window_floor, k × payload_KB))`) so the two stay in fixed proportion at every payload size, rather than hand-widening a constant after each field failure.

---

### AUDIT-20260724-05 — Audit prompt omits most files assigned to this chunk

Finding-ID: AUDIT-20260724-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    chunk 13b39982699caaf7 render: `Files in scope` vs `## Diffs`

The chunk assigns many files to this reviewer, including `editorial-tooling/package-lock.json`, the quote-bank fixture banks/sources, `package-lock.json`, and multiple `tests/fixtures/**` files, but the rendered `## Diffs` section only includes `.prettierrc.json`, `.specify/feature.json`, `.stack-control/audit-barrage-config.yaml`, and `.stack-control/config.yaml`. That means an unattended audit reviewer acting only on the provided payload cannot review the fixture corpus or lockfile changes even though this chunk claims they are in scope.

Blast radius is high because this is a governance correctness failure: the audit can return “clean” while most of its assigned surfaces were never visible. A reasonable fix is to make chunk rendering fail closed when any non-binary in-scope file lacks a diff body, or explicitly mark omitted files with a reason the reviewer can price.

### AUDIT-20260724-06 — `buildCli()`'s snapshot does not eliminate the `dist/` race its own comment claims to close — it adds a third writer and copies unsynchronized

Finding-ID: AUDIT-20260724-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/integration/support.ts:26-33, 73-100

The SNAPSHOT docstring (lines 29-33) states the problem precisely — "`tests/contract/build-emit.test.ts` runs `npm run build` twice, vitest runs that project concurrently with this one" — and then concludes "`dist/` is a shared mutable resource with two owners; this copy has one." The copy has one owner. Its *source* does not. `buildCli()` at line 75 runs `npm run build` into that same shared `dist/`, making it a *third* concurrent writer, and then at line 96 does `fs.cp(DIST, path.join(SNAPSHOT, 'dist'), { recursive: true })` with nothing serializing it against the contract project's builds. The comment on line 93 — "Snapshot AFTER the build, so the copy is of a complete dist rather than one mid-write" — orders the copy only against *this function's own* build; it says nothing about the concurrent one it was written to defend against.

Two concrete failures follow. (a) If `build-emit`'s `npm run build` is mid-write during the `fs.cp`, the snapshot captures a partial `dist/` and every test in this project fails with `ERR_MODULE_NOT_FOUND` — the exact symptom the snapshot exists to remove, now *frozen in* for the whole file instead of being a transient window, so it is both more damaging and harder to attribute. (b) `fs.cp` recursive can itself throw `ENOENT` mid-walk when a concurrent tsc deletes a file between readdir and read, which surfaces as an opaque `beforeAll` failure with no mention of the build at all.

Blast radius: intermittent red CI on a shared branch, plus a misleading load-bearing comment. The comment is the worse half — an engineer bisecting the flake reads lines 29-33, sees the race described and declared solved, and rules it out. The fix is to make the build/snapshot happen exactly once before any project starts (a vitest `globalSetup`, or `sequence`/`fileParallelism` config that forbids `build-emit` and integration overlapping), or to `fs.cp` into a scratch dir and `fs.rename` it into `SNAPSHOT` only after `stat`-ing the entry, so a torn copy is never observable.

---

### AUDIT-20260724-07 — Response/request schemas are non-strict, so a misspelled `impure` or `validation` key parses clean and is silently dropped

Finding-ID: AUDIT-20260724-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/contract.ts:102-110, 182-186 (also 32-37, 165-175)

Every schema in this file is a bare `z.object({...})`. Zod's default object behavior is *strip*: unknown keys are removed and parsing succeeds. So a provider that emits `{"version":1,"outputs":[...],"tool":{...},"impure":{"reason":"calls a language model"}}` and a provider that emits the same payload with the key misspelled `"impures"` / `"impure_reason"` / `"Impure"` produce **identical, successful** `BuildResponse` values — the second one records the artifact as referentially transparent. The same hazard applies to `validation` (a typo turns a self-reported `failed` into `undefined`, which line 88-89 explicitly defines as the distinct state "not yet validated"), and to `ValidateResponseSchema.errors` at line 185 (`erors: [...]` → verdict with no reasons).

This directly contradicts the design stance the file spends 80 lines arguing for. Line 29-30 says an unknown version "is a refusal, never a best-effort parse (FR-005)"; lines 96-100 say the non-empty-`outputs` refusal "lives in the schema itself rather than in a caller who might forget to check" precisely because "an empty success recorded as success is exactly the false-clean the ledger exists to prevent." Silent key-stripping *is* best-effort parsing, and it manufactures exactly that false-clean: an impure artifact ledgered as pure is undetectable after the fact, because the wire bytes that would have proved otherwise were discarded at parse time and the provider exited 0.

Blast radius: an adopter writing a by-hand provider (FR-031 makes hand-written providers a first-class case, line 20) gets no feedback on a typo — the failure is invisible at every layer, and the wrong value is durably written into the ledger that drift reporting reads. Fix: make `BuildResponseSchema`, `BuildRequestSchema`, `ValidateRequestSchema`, and `ValidateResponseSchema` `.strict()` so an unrecognized key is a named refusal through `formatSchemaIssues`, matching the version-literal stance. If forward-compatible extension is wanted, it should be an explicit namespaced escape hatch (e.g. an `x_` prefix allowance), not the silent default.

---

### AUDIT-20260724-08 — `eslint .` applies type-checked TS rules to the new `editorial-tooling/*.mjs` sources, which no `files` block configures — the new package is either ungoverned or breaks the lint gate

Finding-ID: AUDIT-20260724-08 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    `eslint.config.mjs:34-52` (+ `package.json:15`, `editorial-tooling/test/validator.test.mjs:5`)

`eslint.config.mjs:36` ignores only `dist/`, `node_modules/`, `coverage/`, and `**/*.config.{ts,js,mjs}`. The two rule blocks are scoped to `files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx']` (line 41) and `tests/fixtures/**/*.ts` (line 56). Nothing matches `editorial-tooling/src/*.mjs`, `editorial-tooling/bin/*.mjs`, or `editorial-tooling/test/*.mjs` — yet ESLint lints `.mjs` by default, so `npm run lint` (`package.json:15`, `eslint .`) *does* pick those files up. What they receive is the spread at line 39, `...tseslint.configs.recommendedTypeChecked`, whose base and rules entries carry no `files` restriction: the TS parser and the type-information-requiring rules (`no-floating-promises`, `no-unsafe-assignment`, …) get applied to `.mjs` files for which no `projectService`/`project` is configured anywhere in this config. That is the classic "you have used a rule which requires type information, but don't have parserOptions set to generate type information for this file" failure.

Corroborating evidence that the new package is in fact escaping lint today: `editorial-tooling/test/validator.test.mjs:5` imports `pathToFileURL` and never uses it. `js.configs.recommended` (line 38) enables `no-unused-vars` for all files, so a green `npm run lint` over this tree is only possible if the file is not being linted, or if lint is not being run at all as a gate.

Blast radius: the entire US1/US2 deliverable — six-plus `.mjs` modules implementing the byte-exactness invariant this feature exists to guarantee — ships outside the house typing/prettier gate that `eslint.config.mjs` was written to enforce, and a consumer who wires `npm run lint` into CI gets either a hard crash on files they didn't intend to type-check or a false-clean pass. Fix: add an explicit block with `files: ['editorial-tooling/**/*.mjs']` that spreads `tseslint.configs.disableTypeChecked` (or add `editorial-tooling/` to `ignores` and give the sub-package its own `eslint.config.mjs` plus a lint script), and make the root lint script run both.

---

### AUDIT-20260724-09 — The test that claims to prove "byte-exact comparison (no normalization)" cannot distinguish byte-exact comparison from normalize-then-compare

Finding-ID: AUDIT-20260724-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `editorial-tooling/test/validator.test.mjs:172-185`

The final test is named `byte-exact comparison (no normalization)` and its comment claims: *"The fixture differs only by a single ASCII punctuation byte ('.' vs '!'). This test proves exact byte comparison is performed — no normalization. (Exercises FR-001: verbatim extraction and FR-002: byte-exact preservation)"*. Its only assertion is `assert.equal(verdict.state, 'failed')` on `reconstruction-mismatch.yaml` — the same fixture and the same assertion already made by the table-driven case and by the `reconstruction mismatch reports first differing byte` test above it. A `.` vs `!` difference survives every normalization a quote validator would plausibly apply (Unicode NFC/NFKC, whitespace collapse, CRLF folding, smart-quote folding, case folding). So the assertion holds identically for a validator that normalizes both sides before comparing. The test proves the validator rejects *some* difference; it proves nothing about the absence of normalization, which is the exact claim it makes and the exact FR it is cited as evidence for.

The blast radius is that this is *acceptance evidence*. FR-002 (byte-exact preservation) is the feature's central safety property; the execution ledger and the commit log (`T008: deterministic quote-fidelity validator (US1 GREEN)`) treat this suite as the proof it holds. A downstream consumer — or an unattended agent extending the validator — reads "no normalization is proven under test" and is free to add a normalization step (e.g. NFC-folding source bytes to tolerate an encoding quirk) without a single test turning red. That is a silent regression of the one invariant the whole quote bank rests on.

A real fix is a fixture whose only difference is one a normalizer *would* collapse — e.g. a curly `’` where the source has a straight `'`, an NBSP (U+00A0) where the source has U+0020, a trailing `\r`, or NFD-decomposed `é` against an NFC source — and an assertion that it is `failed` with a reconstruction error. Until such a fixture exists, the test's name and comment should not claim what they claim.

---

### AUDIT-20260724-10 — `profiles/editorial-audio.yaml` ships `npx <unclaimed-package>` provider commands while the example asserts the profile is "the real, shared profile"

Finding-ID: AUDIT-20260724-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `profiles/editorial-audio.yaml:9,13,17,21,25` (+ `examples/minimal-podcast/episode.yaml:5-8`)

Every one of the five targets binds a provider of the shape `cmd: [npx, <name>-tooling, <verb>]` — `web-tooling`, `epub-tooling`, `audio-tooling` (twice), `alignment-tooling`. These are generic, unqualified, unscoped npm package names. Nothing in the diff indicates they exist on the public registry or are owned by this project. Meanwhile `examples/minimal-podcast/episode.yaml:5-7` explicitly instructs the reader that this is not a stand-in: *"`editorial-audio` is the real, shared profile committed at profiles/editorial-audio.yaml — this fixture uses it unmodified, so `pc status` here exercises the actual resolution path a real content repo would use, not a stand-in."*

`npx <name>` on an unresolvable local binary falls through to fetching and executing that package from the public registry. So the first operator (or unattended agent) who runs `pc build` against the shipped example causes arbitrary code from whoever currently owns or later registers `audio-tooling` to execute on their machine with their credentials in the environment. That is a dependency-confusion / name-squat surface committed into the repository and framed by the adjacent comment as production configuration rather than as a placeholder. It also directly violates the project rule against mock data outside test code: these are placeholder tool names dressed as real ones, and the failure mode is remote code execution rather than a clean "not implemented" error.

Fix: either make the placeholder status explicit and unrunnable (`cmd: [pc, provider-not-configured, <target>]`, or a scoped name the project actually owns, e.g. `@production-control/audio-tooling`), or pin `npx --no-install` / `npx --package=<exact-version>` so an unresolvable provider fails loudly and locally instead of reaching the network. At minimum, correct `episode.yaml:5-7` so it stops asserting these providers are real.

---

### AUDIT-20260724-11 — The shipped example declares `outline.md` and `script.md` as authored inputs, but neither file is added anywhere in the diff

Finding-ID: AUDIT-20260724-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `examples/minimal-podcast/episode.yaml:11-16`

`episode.yaml` declares three authored nodes: `outline` → `outline.md` (line 14), `spoken` → `script.md` (line 16), and `narration` → `assets/narration/take-01.wav` (line 18). Only the third has a corresponding file in this diff (`examples/minimal-podcast/assets/narration/take-01.wav`). The chunk manifest for this review lists exactly two files under `examples/minimal-podcast/`, and the one other chunk file list visible to me does not contain them either — I have no filesystem access in this lane to rule out their presence in a truncated chunk list, so treat this as high-confidence-but-unverified.

If they are indeed absent, the inline comment at lines 11-12 is falsified by the artifact it documents: *"Unused by any declared target below. Still a first-class node: `pc status` reports it `present`, because an authored file nobody builds from is still an authored file."* `pc status` on the shipped example would report `outline` and `spoken` as missing, not `present` — and `spoken` is the input `narration` declares `follows:` against (line 21), so the advisory `needs-review` mechanism the comment describes (FR-018/FR-019) cannot be demonstrated either. The blast radius is that `examples/minimal-podcast/` is the adopter's first contact with the tool and is documented as an exercise of the real resolution path; an adopter running it sees output that contradicts the committed explanation, and an agent using the example as a template for a new episode reproduces a broken manifest. Fix: add the two missing files (a few lines of markdown each is sufficient), or remove those nodes from the manifest and the comment that describes their behavior.

---

### AUDIT-20260724-12 — Credentials reach the S3 adapter only through mutated global `process.env`, which is never restored and never neutralizes an inherited AWS session

Finding-ID: AUDIT-20260724-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/contract/s3-store.test.ts:78-80, 106-108

`beforeAll` sets `process.env.AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` to the MinIO root creds (lines 79-80), and `makeStore()` (line 106-108) constructs `s3AssetStore({ bucket, endpoint, forcePathStyle })` with **no credential argument** — so the adapter can only authenticate via the AWS SDK's default credential-provider chain reading those globals. Two concrete failures follow. (a) A developer with an active AWS SSO/STS session exports `AWS_SESSION_TOKEN` (and often `AWS_PROFILE`) in their shell. The test overwrites the ID and secret but leaves the inherited session token in place, so the SDK assembles a mismatched credential triple and MinIO answers 403. Every assertion in the suite then fails with a signature/auth error that reads like an `s3AssetStore` defect, on exactly the machine most likely to be running the contract locally. (b) `afterAll` (lines 100-104) stops the container but never restores or deletes the two env vars, so the fake credentials persist for the remainder of that vitest worker's lifetime — any suite sharing the worker (isolation config is outside this chunk, so this is not hypothetical-by-configuration) inherits them.

Blast radius: a contract test that is the feature's *only* real proof of FR-027 produces auth failures that a consumer will misattribute to the adapter, and it silently mutates process-global state that other suites read. The fix is to stop using globals as the credential channel: give `s3AssetStore` an explicit `credentials` option and pass `{ accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD }` from `makeStore()` — the same way the `setupClient` at lines 89-94 already does. If the adapter genuinely has no such surface, that is the finding: the production adapter cannot be configured without ambient environment state, which is the same bug in the shipped code.

### AUDIT-20260724-13 — Docker-required S3 proof is documented but not wired into a required command

Finding-ID: AUDIT-20260724-13
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/s3-store.test.ts:37-55; missing package/CI wiring for `PC_REQUIRE_DOCKER`

The test correctly adds a failing branch when `PC_REQUIRE_DOCKER` is set and Docker is unavailable, but the audited surface only makes that branch conditional. Lines 40-41 and 55 claim CI sets `PC_REQUIRE_DOCKER`, yet the repository command visible for this suite is `test:integration:store: "vitest run --project contract tests/contract/s3-store.test.ts"` with no environment assignment, and no CI workflow appears in the file inventory. In that state, a Dockerless verification run still takes the `describe.skipIf(!dockerAvailable)` path at line 77 and exits green.

Blast radius is high because this file is the only real S3-compatible proof for `s3AssetStore`; a downstream consumer can run the advertised store contract command, see success, and infer MinIO coverage ran when it did not. A reasonable fix is to make a committed required verification path set `PC_REQUIRE_DOCKER=1`, such as the package script or the CI job, and make the comment point to that concrete enforcement surface rather than asserting it implicitly.

### AUDIT-20260724-14 — The file-size cap scans only `src/` and `tests/` `.ts` files, so the entire package this feature added (`editorial-tooling/**/*.mjs`) is outside the only mechanical enforcement of the size cap

Finding-ID: AUDIT-20260724-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=reachable, fix-debt=no; reachable, high blast radius — NOT calibrated down (real signal preserved, SC-003).
Surface:    tests/unit/architecture-file-size.test.ts:15-27, 37-54 (affects all of `editorial-tooling/src/*.mjs`, `editorial-tooling/bin/*.mjs`, `editorial-tooling/test/*.mjs`)

The two roots this gate scans are `ALL_SRC_FILES` (line 16, i.e. `REPO_ROOT/src`) and `listTsFiles(path.join(REPO_ROOT, 'tests'))` (line 37). The helper is named `listTsFiles` and the comment at line 36 confirms the extension filter is `.ts` ("Support modules … are `.ts` and are scanned alongside the `*.test.ts` files"). Feature 002-quote-bank — the feature under audit — introduced an entire second package written exclusively in `.mjs` under a third top-level directory: `editorial-tooling/src/miner.mjs`, `validator.mjs`, `schema.mjs`, `edits.mjs`, `claude.mjs`, `editorial-tooling/bin/quote-{miner,validator}.mjs`, and `editorial-tooling/test/*.test.mjs`. Neither the directory nor the extension is reachable by this scan, so the cap has *zero* coverage of the code the feature actually shipped.

This is exactly the channel-enumeration failure the fix was supposed to prevent. The comment at lines 30-35 diagnoses the incident as "this size check scanned only src/ … with nothing failing until the fleet broke," and then widens the scan by exactly one directory — closing the one example that bit, not the class. Two channels stay open: the **path** channel (any top-level dir that is not `src/` or `tests/` — `editorial-tooling/`, plus root-level `.ts` such as `vitest.config.ts`), and the **extension** channel (`.mjs`, which is now the majority of executable code in this repo). `editorial-tooling/src/miner.mjs` is the file most likely to accrete — it holds the impure mining loop, byte-exact grounding, and omission handling.

Blast radius: an unattended agent (or a human) reading a green run of a suite titled `constitution § Technology: file size` reasonably concludes the 300-500-line cap is mechanically enforced for this repository. It is not enforced for the package this feature exists to deliver, so `miner.mjs` can grow past the cap *and* past the audit-barrage fleet envelope and re-trigger the exact FATAL cited at line 33, with the gate still green. A reasonable fix: make the scan roots and the extension set data (e.g. `SIZE_SCAN_ROOTS = ['src', 'tests', 'editorial-tooling']`, extensions `['.ts', '.mjs', '.js']`, with `node_modules` excluded — `editorial-tooling/node_modules` exists per the `.gitignore` added in 6fb5f00), and assert non-emptiness per root so a mistyped root fails loudly rather than silently contributing zero files.

### AUDIT-20260724-15 — The walk-completeness check covers only `ROOT_FILES`, so unresolved edges in the eager graph from `src/cli/index.ts` — the file's strongest claim — are invisible

Finding-ID: AUDIT-20260724-15
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/architecture-boundary.test.ts:150-159 (guards the claims at lines 35-64 and 66-101)

`walk()` returns `{violations, reached, unresolved}`, and the last test (lines 150-159) is the guarantee that makes the other tests trustworthy: an import the resolver cannot resolve is an edge the walk silently drops, taking the whole subtree behind it out of scope. But that test iterates `ROOT_FILES` only (line 152) and uses the default `IMPORTS_BY_FILE`. It never checks `CLI_ROOT_FILES` (the read-verb roots, line 51) and — critically — never checks `walk(entry, EAGER_IMPORTS_BY_FILE)` rooted at `src/cli/index.ts` (line 80).

`src/cli/index.ts` cannot be inside `ROOT_FILES` or `CLI_ROOT_FILES`, and this is provable from the diff itself: both of those root sets are walked with the default map and asserted to produce zero violations (lines 27-32, 57-63), while the complement test at lines 103-120 asserts that the *full* walk from `index.ts` produces `violations.length > 0`. If `index.ts` were in either root set, those tests would contradict each other. So the shipped entry point — the one module whose import graph the "offline BY CONSTRUCTION" claim now rests on — is the one module whose import resolution is never verified. `EAGER_IMPORTS_BY_FILE` is additionally a *separately constructed* map; a bug in how it classifies static vs. dynamic edges (a re-export form, a bare-specifier alias, a `.js`-extension resolution miss) drops edges from the eager graph specifically, and nothing in this file would notice.

The two non-vacuity guards at lines 85-91 do not cover this: `toContain('src/cli/status.ts')` and `toContain('src/state/resolve.ts')` prove that *two particular nodes* were reached, not that *no edges were dropped* elsewhere. A dropped edge under, say, `src/state/freshness.ts` or `src/assets/resolve.ts` would leave both assertions passing while an S3/AWS-SDK import behind it goes unscanned, and the test at lines 94-100 reports "clean." Blast radius: the FR-010/SC-001 offline guarantee — the one this file was rewritten to close AUDIT-20260716-10 against — degrades to a green test over a truncated graph, with no signal. Fix: extend the completeness test to accumulate `unresolved` from `CLI_ROOT_FILES` and from `walk(path.join(REPO_ROOT, SHIPPED_ENTRY), EAGER_IMPORTS_BY_FILE)` as well as `ROOT_FILES`, so every graph the file draws a conclusion from is proven hole-free.

### AUDIT-20260724-16 — `modified` vs `invalid` precedence is untested — the one ordering that can destroy human work

Finding-ID: AUDIT-20260724-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/unit/state/frontier.test.ts:53-58, tests/unit/state/modified.test.ts:105-155

`frontier.test.ts:53-58` establishes `invalid -> rebuild`, and `frontier.test.ts:60-70` establishes `modified -> resolve-edit, NEVER rebuild — rebuilding would destroy the human edit`. These two mappings have opposite remedies and `NodeState` is a single exclusive value, so the safety property depends entirely on which state `resolveStatus` assigns when **both** conditions hold: a derived output whose bytes were hand-edited *and* whose recorded validation is `failed`. If resolve evaluates validation before the output-edited check, that node resolves `invalid`, the frontier says `rebuild`, and the build overwrites the human's edit — precisely the failure FR-017a exists to prevent.

`modified.test.ts` proves exactly one precedence pair: `stale` beats `modified` (Case 15, lines 105-155, with the reasoning spelled out in the file header at lines 15-22). It never exercises `invalid` at all — the word does not appear in the file. So the suite green-lights the hazardous case by silence. The blast radius is a destroyed hand-edit under an unattended `pc next` → `pc build` loop, with no signal that anything was lost, because the frontier itself told the operator to rebuild.

A reasonable fix is a Case 17 in `modified.test.ts` that builds a derived node with unchanged inputs, hand-edited output bytes, and a `reviews`/validation record marking it failed, then asserts the resolved state (whichever the spec chooses) *and* asserts the resulting `frontier` action is not `rebuild`. Whichever way the spec resolves it, the ordering must be pinned by a test, the same way stale-vs-modified is.

### AUDIT-20260724-17 — Miner accepts a source directory the validator hard-refuses (no duplicate-id check)

Finding-ID: AUDIT-20260724-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    editorial-tooling/bin/quote-miner.mjs:87 (vs editorial-tooling/bin/quote-validator.mjs:74-78)

Both bins derive a source id the same way: `basename(name, extname(name))` (miner line 87, validator line 71). The validator then routes that list through `buildSourceMap(files)` and **hard-fails on ambiguity** (lines 74-78, `ambiguous source mapping`). The miner has no equivalent check — it pushes straight into `sources` and hands the array to `mine()`.

So a sources directory containing `chapter-3.md` and `chapter-3.txt` (or `.markdown`/`.txt` pairs from an OCR or export step — a normal thing to have) yields two distinct files both claiming id `chapter-3`. The producer builds a bank, exits 0, and emits a success BuildResponse; every quote citing `chapter-3` is grounded against whichever file `mine()` happened to key on, with the other silently shadowed. That is a citation attributed to the wrong document — the exact failure the feature exists to prevent — and it is emitted with no warning. The validator then refuses to run at all on the same directory, so the operator gets a validator crash rather than a fidelity report, and the bank is never adjudicated. I cannot see `src/miner.mjs` from this chunk, so I cannot say whether `mine()` dedups, first-wins, or last-wins internally; the asymmetry is proven by this chunk regardless — the producer accepts an input its own acceptance gate refuses.

Fix: run the same `buildSourceMap` (or a shared id-resolution helper) in the miner before calling `mine()`, and fail with the same message. Better: lift the whole readdir→stat→filter→id block into `src/sources.mjs` and have both bins import it, so the two surfaces cannot drift again (see AUDIT-BARRAGE-claude-07).

---

### AUDIT-20260724-18 — The "rebuild" half of the dual-signal invariant never invokes the builder — it hand-forges the ledger, so the headline assertion is tautological

Finding-ID: AUDIT-20260724-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/dual-signal.test.ts:46-88 (`recordTranscriptBuild`), :127-129 (`rebuildTranscript`), :191-231 (the "rebuilding MUST NOT clear the review" describe)

The file's stated purpose is an asymmetric-coupling test: a *build* must not clear a human review, and a *review* must not fake a build. The review direction goes through product code — `waiveNarration` shells out to `pc review --waive` (:132-144). The build direction does not: `rebuildTranscript` calls `recordTranscriptBuild`, which computes hashes with `hashFile` and writes the artifact record directly with `writeLedger` (:75-87). The ledger-level assertion that follows — `expect(ledger.reviews.narration?.waived_hash, 'the build moved the review baseline — a build must never write a human decision').not.toBe(currentSpoken)` (:229-235) — therefore cannot fail: the only writer on that path is the test's own helper, which never touches `reviews`. Same for the sibling test at :238-245, which compares `reviews` before/after a write the test itself performed. What survives is a resolver test (status recomputed from a ledger where transcript is fresh still reports `narration: needs-review`), which is real but is a strictly weaker claim than the one the comments make.

The justifying comment is now stale: ":48-50 — "the ledger write a real `pc build` will perform in Milestone 2, done by hand because Milestone 1 has no builder"". Milestone 2 ships inside this audited range — `src/cli/build.ts` (chunk `a51b1117efaba5f1`), `src/providers/build.ts` (`c53bc95400e99ce3`), commit `0248ef7 pc build, pc validate, producer drift: the execution layer`. The builder exists; the test that exists to guard it against clearing human decisions still doesn't call it.

Blast radius: a regression where `pc build` rewrites or drops `reviews.narration` (e.g. a naive whole-ledger rewrite rather than an artifact-scoped merge — exactly the shape the diff's own helper uses at :75-87) ships green. The consequence is the false clean the file's own prose names: "it will report green while a recording drifts from the script it claims to deliver." Fix: drive the rebuild through `pc build` (as `waiveNarration` drives `pc review`), keeping the hand-written ledger only for the *initial* clean state if the builder can't produce it; if `pc build` genuinely cannot yet target `transcript`, say so at :48 with the concrete blocker rather than "Milestone 1 has no builder."

### AUDIT-20260724-19 — `ocr-fix` with a non-string `before`/`after` passes Step 0 silently, opening an unanchored-insertion channel

Finding-ID: AUDIT-20260724-19
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    editorial-tooling/src/schema.mjs:180-182 (with editorial-tooling/src/edits.mjs:96-100)

`checkOcrFix` returns early **without pushing a defect** when `before` or `after` is not a string:

```js
if (typeof edit.before !== 'string' || typeof edit.after !== 'string') {
  return;
}
```

So the edit `{op: 'ocr-fix', span: 0, after: '!'}` (no `before`) is structurally clean. Reconstruction then coerces the missing field: `beforeBuf = Buffer.from(String(edit.before ?? ''), 'utf8')` is empty, `buf.indexOf(<empty>)` returns `0`, and the verify at edits.mjs:100-104 passes vacuously (`subarray(0,0).equals(empty)` is true). The splice inserts `after` at byte 0 of the span. The result is a quote whose presentation `text` contains bytes that appear nowhere in the source, disclosed by an edit that is anchored to nothing.

Blast radius: this defeats the acceptance guarantee the validator exists to provide. The fidelity gate cannot catch it — every span's `raw` still matches the source byte-for-byte, and `reconstruct()` agrees with `quote.text`, so the bank is ACCEPTED. The consumer is a human or LLM hand-authoring a bank (exactly the adversarial input class the `fabricated-span.yaml` / `nonexistent-span-edit.yaml` fixtures target), and an unattended agent gets a green verdict on fabricated presentation text. The fix is two-part: push a named defect here (`quote '<id>': ocr-fix (edit #k) missing or non-string before/after`), and make `applyOcrFix` refuse an empty `before` rather than treating it as a match-at-0 (an empty `before` is an insertion, not an OCR fix, and neither declared op permits it).

### AUDIT-20260724-20 — `at` and occurrence-uniqueness are validated in original-raw coordinates but applied against the mutated working buffer

Finding-ID: AUDIT-20260724-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    editorial-tooling/src/schema.mjs:161-197 vs editorial-tooling/src/edits.mjs:85-113

`checkOcrFix` computes `start`/`end` and the overlap ranges against `rawBytes = Buffer.from(spans[spanIndex].raw)` — the *original* span bytes — and it checks `before`-uniqueness against those same original bytes. `applyOcrFix` resolves the same fields against `spanBufs[spanIndex]`, which is the **cumulatively spliced working buffer** (edits.mjs:38-45 assigns the spliced result back before the next edit is applied). The two modules use different coordinate spaces the moment a span carries more than one `ocr-fix` whose `before`/`after` differ in byte length.

Two concrete failures. (a) Raw `"AB cd EF"`, edit1 `{before:'AB', after:'XYZ'}`, edit2 `{before:'EF', at:6}`: Step 0 sees non-overlapping ranges `[0,2)` and `[6,8)` and accepts; reconstruction shifts `EF` to offset 7, the verify at edits.mjs:100-104 fails, and a structurally-valid bank is rejected with the misleading message *"ocr-fix before 'EF' not found in span 0"*. (b) Raw `"AB cd"`, edit1 `{before:'cd', after:'AB'}`, edit2 `{before:'AB'}` with no `at`: Step 0 confirms `AB` occurs exactly once in raw and accepts; reconstruction runs `indexOf` on `"AB AB"` and patches the **first** occurrence — the wrong one — silently.

Blast radius: case (a) is a false REJECT that an operator cannot diagnose from the error text; case (b) is a silent wrong reconstruction. Both compound because the pre-check advertises exactly the guarantee (unique anchor, non-overlapping) that the applier does not honor. A reasonable fix is to make reconstruction resolve every `ocr-fix` against the pristine span bytes and apply all splices for a span in one pass over disjoint raw ranges (which is what the non-overlap check already proves is safe), rather than sequentially against the mutated buffer. Relatedly, note that Step 0 never bounds-checks or anchor-verifies an explicit `at` at all (schema.mjs:184-186 takes `edit.at` verbatim, so `at: -5` or `at: 99999` produces garbage overlap ranges) — same root cause: the check and the application disagree about what `at` indexes into.

### AUDIT-20260724-21 — The model identity recorded for producer drift is the constant string `'claude'`

Finding-ID: AUDIT-20260724-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    editorial-tooling/src/claude.mjs:26-35

The adapter comments its intent explicitly — *"Stable model-identity string that flows into the miner's `tool.version` (FR-020): a model change must surface as producer drift"* — and then computes:

```js
const id = modelCmdOverride ? basename(command) : 'claude';
```

Two defects follow. First, when `options.command` is injected without the env var set (the documented injection seam, claude.mjs:19-24), `id` is still `'claude'` — a bank mined by an injected fake or an alternate binary is stamped as having been produced by the real `claude` CLI. Second, and more consequentially, the real `claude` CLI can be pointed at different underlying models (Opus vs Sonnet vs Haiku) with no change to the command name, so swapping the model that actually selected the passages produces a byte-identical `id`. The one thing FR-020 asks this string to detect is the one thing it cannot detect.

Blast radius: a downstream drift check sees a stable `tool.version` and reports banks as fresh after the model behind them changed, so stale selections are never re-mined and provenance records a producer that did not produce the artifact. Rate this high rather than medium because the failure is silent and the artifact is a provenance record — nothing downstream can recover the truth. A fix would resolve a real identity (e.g. query the CLI for its model id, or require the caller to supply an explicit identity string and fail loudly when absent) rather than hardcoding the binary name; per the project's no-fallbacks rule, an unresolvable model identity should throw, not degrade to `'claude'`.

### AUDIT-20260724-22 — `BuildOutputSchema` traversal fixtures cover only leading `../` and leading `/` — a normalizing path like `a/../../evil` has no fixture, so a naive prefix check passes the suite

Finding-ID: AUDIT-20260724-22
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    tests/contract/provider-by-hand.test.ts:130-147

The block header (lines 111-120) states the load-bearing claim: `parseBuildResponse` runs *before* the runner's `path.resolve(output_dir, path)` and before `ingest`'s `path.join(episodeDir, 'dist', path)`, so "an absolute or `..`-escaping output can never reach the filesystem composition in the first place." The fixtures that back that claim are exactly four: `'podcast.out'`, `'sub/dir/podcast.out'` (accept), `'../../../.ssh/authorized_keys'`, `'/etc/cron.d/evil'` (refuse). Every refusal fixture puts the escape in the *first* segment.

The channel the fix opens and does not fixture is embedded, normalizing traversal: `'sub/../../evil.txt'`, `'./../../evil.txt'`, `'a/b/../../../evil.txt'`. All are relative, none start with `..` or `/`, and all resolve outside `output_dir` under `path.resolve`. If the refinement is implemented as `!p.startsWith('../') && !path.isAbsolute(p)` — the obvious implementation given exactly these fixtures — the suite is fully green while the guard is bypassed and the runner walks the escape onto disk. Adjacent degenerate values are also unfixtured: `''`, `'.'`, `'..'` (bare, no trailing slash), a trailing-slash directory path, and a path containing a NUL byte (which `path.resolve` accepts but `fs` rejects with a different error).

Blast radius: this schema is the *only* asserted chokepoint for a third-party-tool-supplied path that two different call sites then compose into a filesystem write. A green suite here is read by an adopter (and by an unattended agent extending the schema) as "traversal is enforced." Fix: add refusal fixtures for `'sub/../../evil.txt'` and `'..'`, plus an accept/refuse decision for `''` and `'a/../b.out'` (in-bounds but non-normal — pick one and fixture it), and state the invariant as `path.resolve(dir, p)` must remain under `dir` rather than as a prefix test.

### AUDIT-20260724-23 — The runner never proves it refuses a traversing declared output — the end-to-end claim lives only in a comment

Finding-ID: AUDIT-20260724-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/contract/provider-by-hand.test.ts:169-180; tests/contract/provider-runner.test.ts:186-215

`provider-by-hand.test.ts:170-171` asserts the integration fact in prose: "The runner parses the provider's stdout through this same function BEFORE it resolves any output path against output_dir, so the escape is refused before it can be walked (finding 07)." Nothing tests that ordering. The test calls `parseBuildResponse` directly on a literal object; it exercises the schema, not the runner's call sequence. If `subprocessRunner` ever resolves/stats declared outputs before parsing (e.g. an existence pre-check moved above the parse, or a `path.resolve` inside the undeclared-output diffing that runs on raw response data), the schema stays correct and this test stays green while the escape reaches the filesystem.

`provider-runner.test.ts` already has the exact machinery to close this: `nodeDecl(script)` runs an arbitrary node one-liner as the provider (used at lines 186, 193, 198, 205, 211, 220). A missing test is one line of the same shape — emit `{version:1,outputs:[{path:'../escaped.txt'}],tool:{...}}`, assert `subprocessRunner().run(...)` rejects naming `outputs`/`path`, **and** assert `fs.stat(path.join(work, 'escaped.txt'))` still rejects, proving nothing was walked or created outside `output_dir`. Without that second assertion no test in either file distinguishes "refused before resolution" from "refused after."

Blast radius: the same false-assurance as finding 01, one layer up — a reviewer reading `provider-runner.test.ts` sees an exhaustively enumerated failure-mode list and reasonably concludes traversal is among the modes covered by the runner. It isn't.

### AUDIT-20260724-24 — `pc validate`'s producer path records a verdict without ever looking at the artifact on disk

Finding-ID: AUDIT-20260724-24 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/validate.ts:74-106 (producer path) vs. :136-154 (declared-validator path)

The declared-validator path reads the artifact and refuses when it diverges from the record: `onDiskHash = await hashFile(artifactPath)` then `if (onDiskHash !== existing.output.hash) throw` — with the stated reason that "Validating it would attach a verdict to bytes the record does not describe." The producer path never performs the equivalent check. It compares the *freshly re-derived* bytes to the recorded hash (`if (output.hash !== existing.output.hash)`) and then calls `recordVerdict`. Nothing in that branch ever reads `existing.output.path` from disk.

So the exact scenario the file's header comment is built around — "A `modified` artifact is a human's edit to a machine-made file" — produces a wrong recorded fact. Human edits `dist/x.mdx` after the build; operator runs `pc validate x`; the provider deterministically re-derives the *recorded* bytes, `output.hash === existing.output.hash`, the provider self-reports `passed`, and the ledger gains `validation: {state: 'passed'}` for a record whose file in the working tree is something else entirely. The two paths assert opposite things about the same invariant, and the one that skips the check is the default (a node with no declared `validator`).

Blast radius: `pc validate` is the acceptance gate — a release check or an unattended agent reads `passed` and ships. A hand-edited artifact passes the gate silently, which is precisely the fabricated-fact outcome the module refuses to commit elsewhere. Note the asymmetry is self-evidencing: the declared path performs the on-disk check *because it is necessary*, so it cannot already be guaranteed by an upstream caller in `src/cli/validate.ts`, or that check would be dead code. Fix: hoist the `hashFile(path.join(episodeDir, existing.output.path))` comparison into `validateTarget` before either branch dispatches, so both paths refuse identically.

### AUDIT-20260724-25 — README can file a `dist/` artifact under "AI-generated — COMMITTED", contradicting the `Path:` line it prints two lines later

Finding-ID: AUDIT-20260724-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/readme/generate.ts:29-30, :60-70, :127-137

`isImpure` ORs two independent sources of truth: `recordById[n.id]?.producer_impure !== undefined || n.provider?.impure !== undefined`. The comment claims this "mirrors the routing in providers/build.ts (`impurityOf`), so the README can never disagree with where a build actually put its bytes." The OR is safe in one direction and unsafe in the other. Built-impure + now-declared-pure → still classified impure, and the record's path (`ai-generated/...`) is printed — consistent. But built-**pure** + now-**declared**-impure → also classified impure, and `derivedEntry` prints `- **Path:** \`${record.output.path}\`` from the record, which is `dist/...`.

The section heading that file lands under states: "the exact bytes are COMMITTED (under `ai-generated/`) as the durable record." The bullet directly beneath it names a gitignored `dist/` path. The document whose entire stated job is to "make provenance unmistakable" now asserts that a gitignored, uncommitted file is the durable record of a non-reproducible artifact. Reaching this state needs nothing exotic: edit the profile/provider decl to add `impure` (a normal thing to do once you discover a tool isn't reproducible) and run `pc readme` before rebuilding.

Blast radius: the failure mode is data loss with a paper trail that says otherwise. An operator or unattended agent trusting the README does not commit the file (it is under `dist/`, which the README's own third section says is gitignored), and a non-reproducible artifact is gone. Fix: when a record exists, classify from the record alone — the record is the fact about where the bytes actually went — and consult `n.provider?.impure` only in the `record === undefined` branch, which is exactly where `derivedEntry` already falls back to the declaration.

### AUDIT-20260724-26 — `recordVerdict` merges the verdict onto a stale record snapshot, silently reverting fields it re-read the ledger to protect

Finding-ID: AUDIT-20260724-26
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/validate.ts:176-190

`recordVerdict` re-reads the ledger (`const current = await readLedger(context.episodeDir)`) with the stated intent that "nothing else in it may be disturbed," and then writes `{...existing, validation: {...}}` — where `existing` is `context.ledger.artifacts[id]`, captured before the provider subprocess ran. The re-read protects every artifact *except the one being written*. For that one, the write uses a base that is as old as the context.

The window is not theoretical: it spans the entire provider or validator subprocess invocation, which for an AV/render toolchain is the longest operation this system performs. If a `pc build <id>` lands in that window, the validate write reverts `output.hash`, `output.path`, `inputs`, `producer`, and `built_at` to the pre-build values and stamps a verdict on top of them. The result is a record that claims a fresh validation of a build that has been superseded — with the older output hash, so freshness and modified-detection downstream (`src/state/freshness.ts`, `src/state/modified.ts`) resolve against bytes that are no longer on disk. If the record was removed concurrently, this resurrects it.

Blast radius: a corrupted ledger entry that every other verb reads as authoritative, produced by the one verb whose documented contract is "a validation is a fact recorded ABOUT a build, never a substitute for one." Fix: after the re-read, compare `current.artifacts[id]` against `existing` and refuse when it moved (same shape as the divergence refusals above), or merge onto `current.artifacts[id]` rather than `existing`.

### AUDIT-20260724-27 — Validation can read and hand off an escaped ledger output path

Finding-ID: AUDIT-20260724-27
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/providers/validate.ts:132-158

The declared-validator path builds `artifactPath` with `path.join(context.episodeDir, existing.output.path)` and then hashes and passes that path to an external validator. `ArtifactRecord.output.path` is only a plain string in the ledger schema, so a malformed or edited ledger can contain `../outside-file` and `pc validate` will read outside the episode before invoking the validator.

Build ingestion defends output paths when it writes records, but validation is reading a committed ledger as input and should not assume every record was produced by the current binary. The fix should apply the same relative-contained path invariant before `hashFile` and before constructing `ValidateRequest`. Blast radius is high because a normal validation command can be steered into reading or exposing paths outside the episode boundary.

### AUDIT-20260724-28 — Release target that is an authored node is permanently unreleasable, and its blocker message reads as green

Finding-ID: AUDIT-20260724-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/state/release.ts:43-53 (target loop), cross-file: src/state/messages.ts:88-99

`assessRelease` gates every target on `node.state !== 'fresh' || node.validated !== 'passed'`. But `fresh` is a *derived*-node state. `messages.ts` shows the authored vocabulary is disjoint from it: `present` ("Authored node "${id}" resolves, and it follows nothing.", messages.ts:88-90) and `reviewed` (messages.ts:92-97) are the healthy authored states, and `ok`/`neverBuilt`/`inputChanged` are the derived ones. An authored node therefore can never satisfy `state === 'fresh'`, and it almost certainly never carries `validated === 'passed'` either (nothing validates an authored file — `validated` is written by the provider/validator run). The only guard in the function is the `byId.get(id) === undefined` throw at line 45-49, which catches "not a node in this episode" but says nothing about kind.

The consequence is a silent, self-contradictory dead end: declare an article/MDX deliverable as a release target (the repo already ships `tests/fixtures/minimal/article.mdx` and `tests/fixtures/tree-output/article.mdx` as episode content) and `assessRelease` returns `releasable: false` with a single blocker whose own cause message is *"Authored node "article" resolves, and it follows nothing."* — i.e. a blocker that states nothing is wrong. Blast radius: an unattended agent driving `pc release-check` reads "not releasable, blocker = article, reason = it resolves fine" and has nothing to act on; it will loop, or worse, conclude the gate is broken and route around it. That is precisely the failure mode the `ReleaseVerdict` doc at lines 13-17 claims to prevent ("a caller never has to re-derive the reason").

A reasonable fix is to make the kind constraint explicit rather than accidental: either reject an authored identity as a release target with a loud error at line 45 (`Release target "${id}" is an authored node; only derived nodes are releasable targets.`), or define the authored-node release predicate positively (`present`/`reviewed` are releasable, `absent`/`needs-review` are not) and branch on `node.kind`. Whichever is chosen, it needs a fixture — there is no test in the file lists that declares an authored release target.

### AUDIT-20260724-29 — The doc's own justifying example (`stale` upstream) is not among the states the all-nodes loop checks

Finding-ID: AUDIT-20260724-29
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=reachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/state/release.ts:35-37 vs src/state/release.ts:55-59

Lines 35-37 justify scanning every node rather than only targets: *"The last two checks run over EVERY node, not just targets: **a stale narration behind a fresh voiceover** still means a human has an unanswered question, and the target being fresh does not make that question go away."* The implemented loop at 55-59 checks `node.state === 'needs-review' || node.state === 'modified'` — `stale` is not in it. The comment's motivating example is a case the code does not handle.

This is not merely a stale comment, because the scenario is reachable by the module's own design. `identity.ts:167-180` resolves a derived input to `record.output.hash` — the consumer's freshness compares two *records*, so a node going `stale` (its own inputs moved) does not change the hash its consumers see. Narration can be `stale` while voiceover, which consumes it, is `fresh`, and `assessRelease` will then return `releasable: true`. Whether that is intended (the target was honestly built from what it was built from) is a defensible design position — but the file asserts the opposite position in prose, three lines above the code that contradicts it.

Blast radius: this is the false-clean the system exists to refuse, and the ambiguity is load-bearing for anyone extending the gate. An agent reading 35-37 will believe stale upstreams block release and will not add the check; an agent reading 55-59 will believe they don't and may add it, changing release semantics. Both readings are equally supported by the artifact. The fix is to decide and make the artifact say one thing: either add `|| node.state === 'stale'` to the loop (and to the bullet list at 24-33), or rewrite the example at 35-37 to use a `needs-review` narration and state explicitly, as an invariant, that upstream staleness behind a fresh target is *in-scope-permitted* because the target's own provenance is intact.

### AUDIT-20260724-30 — `filename` is joined into a path without ever being constrained to a basename

Finding-ID: AUDIT-20260724-30
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/assets/resolve.ts:37, src/assets/resolve.ts:99-103

`resolveToLocalPath(pointer, destDir, filename)` documents `filename` as "the type-bearing basename the materialized file must carry (the basename of the authored declaration, e.g. `take-01.wav`)" (lines ~30-35), and then does `const destination = path.join(digestDir, filename);` (line ~102) with no check that the string is in fact a single path segment. The invariant lives entirely in prose. Two distinct failure modes follow. (1) A caller that passes the *declared* path rather than its basename — e.g. `assets/narration/take-01.wav`, which is exactly the shape stored in `episode.yaml` — produces a destination inside a subdirectory that `fs.mkdir(digestDir, {recursive: true})` (line ~103) never created, so `writeAtomically`'s `fs.rename` fails with a bare ENOENT that names a temp path, not the real cause. (2) A declaration whose basename contains `..` (or an absolute path, which `path.join` does not reject the way it would with `path.resolve`) writes outside `destDir` entirely, and `fs.rename` from the temp file happily crosses out of `digestDir` since it is the same filesystem.

The blast radius is that this is the *only* function in the module that trusts an input. Every other input is verified twice on purpose — the module doc is explicit that the store and the cache are untrusted boundaries and that content-addressing makes the check nearly free. A `filename` derived from an authored, third-party-editable manifest is a strictly less trustworthy input than the store bytes, and it gets no check at all. A downstream consumer reading this signature would reasonably conclude the callee normalizes, because everything around it does.

A reasonable fix is a guard at the top of `resolveToLocalPath`: refuse when `path.basename(filename) !== filename` or when `filename` is `''`, `'.'`, or `'..'`, naming the offending value and the pointer address in the refusal (consistent with FR-036's naming discipline elsewhere in this file). That converts a silent escape and a misleading ENOENT into one loud, self-explaining error, and moves the invariant out of the doc comment and into the code.

### AUDIT-20260724-31 — Validator has zero source-position awareness: non-adjacent spans can be spliced into a contiguous-looking quotation and still pass

Finding-ID: AUDIT-20260724-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    editorial-tooling/src/validator.mjs:86-112

`checkFidelity` performs exactly two classes of check: each span's `raw` appears *somewhere* in the source (line 90, `src.indexOf(spanBuf) < 0`), and `reconstruct(quote)` byte-matches `quote.text` (lines 101-112). Critically, `reconstruct` is called with the quote alone — `const r = reconstruct(quote)` (line 101) — so it has no access to `src` and cannot know where in the source any span sits. Nothing in this module checks that span *j+1* begins after span *j* ends, that spans do not overlap, or that they come from the same region at all.

The consequence is the canonical quote-mining fabrication mode. A bank can take "We shall be as a city upon a hill" from paragraph 1 and "the eyes of all people are upon us" from paragraph 40, stitch them as two spans of one quote, and record `text` as their concatenation. Every span is individually grounded, the reconstruction byte-matches the recorded text, and `validateBank` returns `state: 'passed'` with an empty `errors` array. The module docstring at lines 1-3 sells this as "the fidelity gate," and commit `028b9ab` frames the validator as "an independent validator: an acceptance gate distinct from the producer" — so a downstream consumer (or an unattended agent running `pc validate`) reads a `passed` verdict as "this quotation faithfully represents the source." It does not; it only means every fragment exists somewhere in the file.

Blast radius: the gate's entire stated purpose is preventing fabricated citations, and this is the fabrication shape that byte-exactness alone cannot catch. A reasonable fix is to have `checkFidelity` resolve each span to a concrete source position (using `span.offset` where present, or the unique match where the raw occurs once) and require strictly increasing, non-overlapping positions across a quote's spans — with any gap required to be declared as an elision edit rather than silently closed.

---

### AUDIT-20260724-32 — `span.offset` is accepted but never verified, and supplying any offset silences the ambiguity advisory

Finding-ID: AUDIT-20260724-32 (claude-02 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    editorial-tooling/src/validator.mjs:86-98

`span.offset` appears exactly once in the validator, at line 94: `if (span.offset === undefined && countOccurrences(src, spanBuf) > 1)`. It is used only as a *suppressor* for the location-ambiguity advisory. The validator never checks that `src` actually contains `spanBuf` at `span.offset` — the grounding check on line 90 is `src.indexOf(spanBuf) < 0`, which asks only whether the bytes occur anywhere.

This produces two defects from one omission. First, a recorded offset is unvalidated provenance: a bank can cite offset 4000 for a passage that only occurs at offset 12, and the gate certifies it. Downstream consumers that use `offset` to render a source excerpt, compute a page/line citation, or re-locate the quote after a source revision will point at the wrong text while carrying a `passed` verdict. Second — and this is the opened channel the fix-review lens would ask about — because the advisory is gated on `offset === undefined`, a producer emits *any* integer to make the location-ambiguity signal disappear. The one guard the validator has against genuinely ambiguous citations is disabled by an unchecked field, which inverts its purpose: the field that should *resolve* ambiguity instead *hides* it.

Blast radius: an ambiguous or mislocated citation ships certified. The fix is small and local — when `span.offset` is present, assert `src.indexOf(spanBuf, span.offset) === span.offset` (or a direct byte compare at that offset) and emit an error, not an advisory, when it does not hold; only then is the ambiguity suppression earned.

---

### AUDIT-20260724-33 — The miner-bin happy-path test never asserts the invented candidate was omitted — the US2 grounding contract is unasserted at the bin boundary

Finding-ID: AUDIT-20260724-33
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    editorial-tooling/test/miner-bin.test.mjs:23-27, 82-84

The fake model in Case 1 is constructed with deliberate care to exercise grounding: it returns `["Duty is ours; results are God's.", "A wholly invented line."]` (line 25) — one passage present in the fixture source, one fabricated. That is precisely the FR-014 / SC-004 contract. The test then asserts only that `quote-bank.yaml` *exists* (lines 82-84) and that stderr matches `/grounded|selected|omitted/` (line 87). It never opens the produced bank.

So the one assertion that would catch the feature's central regression is missing. If the miner stopped filtering ungrounded candidates and wrote both strings into the bank, this contract test still passes green: the file exists, stderr still says "selected", exit is 0. The stderr regex is especially weak — it matches any output containing the word "selected", which the mining report emits unconditionally. A test named a "contract test" that cannot fail when the contract is violated is worse than no test, because the green run is read as coverage.

Blast radius: fabricated quotes reach a bank with the bin-level suite green — and since `miner.test.mjs` exercises `mine()` in-process, the bin is the only place the end-to-end wiring (candidate → filter → YAML serialization) is covered. The fix is to parse `quote-bank.yaml` after the run and assert both directions: the grounded text is present as a quote, and no quote's `text` equals `"A wholly invented line."`. Asserting the report counts parsed out of stderr (selected 2, grounded 1, omitted 1) would strengthen it further.

---

### AUDIT-20260724-34 — Fetched stand-ins collide in a flat `.production/assets/` keyed only by basename

Finding-ID: AUDIT-20260724-34
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/inputs.ts:~215-221, ~242-268 (`assetDir`, `fetchAsset`), and the call site at ~159-188

`fetchAsset` materializes every fetched asset into ONE flat directory — `assetDir()` returns `path.join(episodeDir, '.production', 'assets')` — under a filename derived solely from the authored declaration: `const filename = path.basename(declaredPath);`. Basename is not unique across a manifest. An episode declaring `assets/narration/take-01.wav` and `assets/music/take-01.wav`, both held outside version control as `.asset` stand-ins, resolves both to the same destination `.production/assets/take-01.wav` inside a single `resolveInputs` loop (~85-87).

Both possible resolver behaviors are defects, and neither is guarded here. If `resolveToLocalPath` writes through, the second fetch overwrites the first: input A's returned `BuildInput` still carries `{path: '.production/assets/take-01.wav', hash: <A's hash, captured at ~177>}`, but the bytes now at that path are B's. The provider is handed A's path and reads B's bytes, and `pc build` records an input hash that does not describe what was fed in — the exact corruption the module header (~28-31, "the hash of THE BYTES BEING HANDED OVER") and the mismatch check at ~178-187 exist to make impossible. If instead the resolver returns the pre-existing file, the second input trips the mismatch check and the refusal accuses the asset store of returning wrong bytes when the real cause is a local name collision — a message that sends the operator to the bucket for a bug that is in this function. The same collision is reachable through a second channel with no code change: two concurrent `pc build` invocations for different targets in the same episode share `.production/assets/`.

Blast radius: a silently wrong input hash in the ledger is unfalsifiable after the fact — every downstream freshness and provenance answer is computed from it, and an unattended agent re-running `pc build` gets a green, recorded, wrong build. A fix is to make the destination collision-free while keeping the extension the comment at ~243-246 correctly insists on: namespace by content address (`.production/assets/<address>/<basename>`) or by the input's declared relative path, and assert the resolved destination is not already claimed by a different input in this run.

### AUDIT-20260724-35 — `invokeProvider` recursively deletes a caller-supplied directory with no containment assertion

Finding-ID: AUDIT-20260724-35 (claude-02 + claude-06 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/invoke.ts:~48-50

`invokeProvider` opens with `await fs.rm(request.outputDir, { recursive: true, force: true });` on a value that arrives verbatim from the caller. The doc comment on `InvokeRequest.outputDir` (~40) asserts "A directory this module OWNS: emptied before the run" — but ownership here is a comment, not a check. Nothing in this function verifies that `outputDir` is absolute, non-empty, under `.production/`, or even distinct from the episode directory or the repo root. `force: true` additionally suppresses the one signal (ENOENT) that would otherwise reveal a malformed path.

The reasoning for emptying is sound and well argued (~44-47: a leftover would be a spurious Rule-5 accusation, or worse would be ingested as this run's artifact). The problem is that the safety of the operation rests entirely on every present and future caller — `src/cli/build.ts` and `src/cli/validate.ts` today, plus anything that imports this exported function — computing the path correctly. This module is explicitly written as the boundary that does not trust its counterparty (~9-13: "the record must not depend on its honesty"); the same invariant-first posture should apply to the one destructive operation it performs. An `output_dir` that ever resolves to `episodeDir` or `''` (empty string → `fs.rm('', {force:true})`, or a `path.join` against an undefined segment producing `.`) destroys the operator's working tree with no confirmation and no recovery.

Blast radius: unrecoverable local data loss, triggered by a one-line caller bug rather than by anything an operator does wrong. The guard is cheap and belongs here, where the destructive call is: assert `path.isAbsolute(outputDir)`, assert `path.relative(episodeDir, outputDir)` is non-empty and does not start with `..`, and require the `.production/` prefix that the rest of the feature already treats as the disposable tree (`inputs.ts` `assetDir`/`assetCacheDir`, ~215-226).

### AUDIT-20260724-36 — `pc validate` with no target never runs validators declared on intermediate derived nodes, yet exits 0

Finding-ID: AUDIT-20260724-36
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/validate.ts:91-97 (`const requested = target !== undefined ? [target] : graph.targets;`), src/graph/build.ts:31,86 (`Node.validator`, derived-node construction)

`buildGraph` attaches `validator?: ValidatorDecl` to **every** reachable derived node (`src/graph/build.ts:31` in the `Node` interface, and the `...(decl.validator !== undefined ? { validator: decl.validator } : {})` spread when constructing derived nodes). But the gate's default scope is `graph.targets`, which `buildGraph` sets to exactly `manifest.targets` — the declared leaves, *not* the closure. So for the profile shape the sibling docstring itself uses as the canonical example (`podcast ← voiceover ← narration`), an episode that declares only `podcast` will never invoke a validator declared on `voiceover`, even though `voiceover` is a node in the graph, is built by `pc build`, and carries an explicit `validator` declaration the profile author wrote precisely so it would be checked.

The blast radius is a false clean, which is the exact failure the file's own docstring says the ledger exists to prevent: `pc validate` prints `podcast  passed`, emits `"valid": true`, and exits 0 while a declared validator never ran. A downstream consumer — CI, a release gate, or an unattended agent reading `valid` — will treat that as "every declared validator passed". The in-code justification ("validating a target nobody declared would answer a question the operator did not ask") does not cover this case: the operator *did* ask for `voiceover`, transitively, by asking for `podcast`, and the profile author asked for its validation explicitly. Note the asymmetry is silent — nothing in the report says "3 nodes have validators, 1 was checked".

A reasonable fix is either (a) default `requested` to every derived node in `graph.nodes` that carries a `validator`, keeping `graph.targets` only for ordering/reporting, or (b) if leaf-only really is the intent, make it explicit and loud: report the reachable derived nodes carrying validators that were *not* validated, so exit 0 cannot be read as "everything with a validator passed."

### AUDIT-20260724-37 — `follows` cycles are accepted and can deadlock status resolution

Finding-ID: AUDIT-20260724-37
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/graph/validate.ts:89-100

`validateGraph` only checks that an authored node’s `follows` target exists in `graphNodeIds`; it does not reject `follows` cycles. That admits both direct self-follow (`a: { path: "a.md", follows: "a" }`) and mutual authored cycles (`a follows b`, `b follows a`) because each target is an authored graph node under lines 93-100.

This matters because `resolveAuthoredNode` resolves the followed identity through the memoized content resolver. For a self-follow, resolving `a` stores the in-flight promise for `a`, then awaits `resolver.resolve("a")` again, which returns that same unresolved promise. For a mutual cycle, `a` awaits `b` while `b` awaits `a`. The blast radius is high: an episode that passes graph validation can make ordinary read paths such as `pc status`, `pc next`, and `pc release-check` hang instead of answering or refusing, and an unattended gate can stall without a named cause.

A reasonable fix is to make graph validation reject advisory cycles among authored `follows` edges, including the one-node self-cycle, while keeping `follows` excluded from dependency freshness propagation. That preserves the invariant that `follows` is not an input edge, but still makes the status resolver total over accepted graphs.

### AUDIT-20260724-38 — The delete-before-confirm test proves the original survives but never proves a stand-in was NOT written — the exact fabricated-record the file elsewhere calls out

Finding-ID: AUDIT-20260724-38
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/asset.test.ts:327-342

The unreachable-store test asserts only two things after the failure: `expect(code).toBe(1)` and that the original bytes are still on disk (`expect(await exists(file)).toBe(true)`, `expect(await fs.readFile(file, 'utf8')).toBe(contents)`). It never asserts `expect(await exists(\`${file}.asset\`)).toBe(false)`. Its sibling failure test — "with NO store configured" at ~465-482 — *does* make exactly that assertion, and states the reason in its own words: "A stand-in with no bytes behind it is a fabricated record — a content address referring to content nobody has." The invariant is articulated, and then not held on the path where it is most likely to break.

The two paths are not equivalent. The no-store path fails at *provider resolution*, before the verb has computed a hash or touched anything; the unreachable-store path fails at `put`/`has`, i.e. after the verb has already read the bytes and derived the address, which is precisely the point at which an implementation that writes the stand-in eagerly (write pointer → upload → delete original) would leave a `<file>.asset` behind. Blast radius: an implementation reordered to write-then-upload passes this whole suite while leaving a committable pointer to bytes no store holds. Downstream, `pc status`/`pc validate` read that pointer through `AssetPointerSchema` and see a well-formed asset; the failure surfaces much later as an unresolvable address in someone else's clone. Fix: add `expect(await exists(\`${file}.asset\`)).toBe(false)` and `expect(output.stdout).toEqual([])` to this test, and assert `output.stderr.join('\n')` is non-empty and names the store failure — right now a verb that returns 1 silently, printing nothing anywhere, passes.

---

### AUDIT-20260724-39 — FR-024 ("identical bytes are never stored twice") is never tested across two distinct files — all three dedupe tests re-add the same path after the original was removed

Finding-ID: AUDIT-20260724-39
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/asset.test.ts:174-243 (and the duplicate at 344-366)

The `describe('identical bytes are never stored twice (FR-024)')` block contains three tests, and after the first `assetAddCommand` call in each, the original file has been **removed** — that is the verb's own postcondition, asserted at line ~294 and ~351. So the second call in "adding the same bytes twice stores ONE object" (~175-204) and in "a file that already has a MATCHING stand-in is a no-op" (~206-222) is not adding the same bytes a second time at all: it is re-invoking on a path where only a stand-in remains. Both collapse into the same scenario as "re-adding an already-added file (original gone, stand-in present) is an idempotent no-op" at ~344-366. Three tests, one code path, and the two in the FR-024 block are named for a requirement they do not exercise.

The requirement FR-024 actually describes — two *different* files whose bytes are byte-identical produce one stored object at one address — has no test anywhere in this file. Blast radius: content-addressed dedupe across distinct sources is the whole economic argument for the store, and an implementation that keys on the stand-in's presence rather than on the content hash (or that calls `put` unconditionally on a fresh path) satisfies every assertion here while storing the same bytes N times. `expect(store.size()).toBe(1)` at line ~189 reads like proof of dedupe but only proves the second invocation short-circuited on the stand-in. Fix: add a test that writes `take-01.wav` and `alt-take.wav` in *separate* temp dirs with identical contents, adds both against one `MemoryAssetStore`, and asserts `store.size() === 1`, both stand-ins carry the same `asset`, and the second reports `stored: false` while `standin_written: true`.

---

### AUDIT-20260724-40 — Matching stand-in case never covers an original still present

Finding-ID: AUDIT-20260724-40
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/asset.test.ts:206-222

The test says “a file that already has a MATCHING stand-in is a no-op,” but its setup first calls `assetAddCommand`, which removes the original file. The second invocation is therefore the already-added path where only `<file>.asset` remains, not the hazardous state where both the original bytes and a matching stand-in exist beside each other.

That distinction matters because FR-023 requires the original bytes to move out of the working tree. An implementation could incorrectly skip removal whenever a matching stand-in exists, leaving the large asset in git, and this test would not catch it. The blast radius is high because this is exactly the safety invariant the command is meant to enforce. Add a case that explicitly writes both `file` and `file.asset`, preloads or confirms the store has the address, then asserts `assetAddCommand` removes `file` and reports `original_removed: true`.

### AUDIT-20260724-41 — `never-reviewed` is reported with `cause.code: 'followed-changed'` — the machine-readable cause states something that did not happen

Finding-ID: AUDIT-20260724-41
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `src/state/resolve.ts:353-358` (`reviewStatus`), with the `Cause` union at `src/state/resolve.ts:36-47`

`reviewStatus` handles two distinct situations with the same cause code:

```ts
const baseline = ledger.reviews[id]?.waived_hash;

if (baseline === undefined) {
  return report('needs-review', {
    code: 'followed-changed',                       // <- no baseline exists; nothing changed
    message: message.neverReviewed(id, followed, followedHash),
    identity: followed,
  });
}

if (baseline !== followedHash) {
  return report('needs-review', {
    code: 'followed-changed',                       // <- genuinely changed
    ...
```

The file's own doc comment at lines 30-34 makes `code` load-bearing: "`message` NAMES the responsible thing, and `identity` carries it structurally whenever there is one, **so an agent reads a fact instead of guessing from a state word**." The `message` here correctly says "never reviewed" (`message.neverReviewed`), but the structured field an unattended consumer branches on says `followed-changed`. The `Cause` union (lines 36-47) has no `never-reviewed` member at all, so this is not a typo in one branch — the state is unrepresentable in the machine channel.

Blast radius: any consumer that branches on `cause.code === 'followed-changed'` — a CLI that renders "the node you follow changed since you accepted it, here is the diff from `waived_hash` to current", a release explainer, or an unattended agent deciding whether to re-diff or to request first-time review — will take the changed-since-acceptance path for a node that has **no** `waived_hash`. It will diff against `undefined`, print a diff-from-nothing, or tell a human to "review the change" when the correct instruction is "review this node for the first time." The two cases require different human actions, which is exactly why the code channel exists. Fix: add `'never-reviewed'` to the `Cause` union at lines 36-47 and emit it in the `baseline === undefined` branch; the human-readable `message.neverReviewed` already distinguishes them, so only the structured field needs to catch up.

---

### AUDIT-20260724-42 — `IdentitySchema` is an unconstrained string, but an identity is interpolated straight into a filesystem path that is later `rm -rf`'d

Finding-ID: AUDIT-20260724-42
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/manifest/schema.ts:71 (`export const IdentitySchema = z.string();`), src/providers/build.ts:97,140

`schema.ts` constrains `ProfileNameSchema` to `/^[a-z0-9][a-z0-9-]*$/` with an explicit rationale: "`loadProfile` joins it into `<name>.yaml` … so a name carrying separators (or `..`) would escape those directories." That exact reasoning applies verbatim to `Identity`, and it was not applied. `IdentitySchema = z.string()` accepts the empty string, separators, `..`, leading dots, and NUL. Identities flow in from operator-authored YAML through `EpisodeManifestSchema.authored` (record keys), `EpisodeManifestSchema.targets`, and `ProfileSchema.targets`.

`build.ts:97` then does `const outputDir = path.join(context.episodeDir, 'dist', \`.pc-build-${id}\`)`, and `build.ts:140` does `await fs.rm(outputDir, { recursive: true, force: true })` in a `finally`. A target identity of `../../..` yields a recursive force-delete of a directory two levels above the episode root; `invokeProvider` is additionally spawned with that directory as its `output_dir`. Even without adversarial intent, a benign identity containing `/` (`narration/take-01`) silently creates a nested scratch directory whose parent the `finally` never removes, and an identity of `""` collapses `outputDir` to `dist/.pc-build-`, colliding across every empty-named node.

Blast radius: an adopter authoring a manifest — or an unattended agent generating one — can cause deletion outside the episode tree, and the file's own stated invariant ("the single place the 'no directory traversal' refusal lives, so every caller that stores a filesystem path in a schema inherits the same invariant") is false as written, because the identity channel bypasses `RelativePathSchema` entirely. Fix: give `IdentitySchema` the same shape-constraining regex `ProfileNameSchema` gets (bare token, no separators, no `..`, non-empty), refused at manifest-load time naming the field per FR-036 — not a defense-in-depth check at the one call site that happens to build a path today.

---

### AUDIT-20260724-43 — A failing `fs.rename` strands the ledger over bytes that were then deleted — contradicting the documented "in every one of those cases the ledger is untouched"

Finding-ID: AUDIT-20260724-43
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/providers/build.ts:85-87, 119-135

`buildTarget`'s JSDoc states: "Throws — naming what failed — if the target is not buildable, an input cannot be resolved, the provider fails or misbehaves, **or the ingest cannot be completed. In every one of those cases the ledger is untouched.**" (lines 85–87). That is false for the last clause. `record(...)` at line 119 writes the ledger; `await fs.rename(staged.tempPath, staged.destination)` at line 129 is the ingest's commit step and can throw for ordinary reasons — `EACCES`/`EPERM` on a read-only or root-owned `ai-generated/`, `EISDIR`/`ENOTEMPTY` when `destination` already exists as a directory (nothing in `stage` checks this), `EROFS`, `EMFILE`. When it does, the `finally` at line 135 deletes the staged bytes, so the outcome is: ledger asserts an `ArtifactRecord` with `output.hash = H_new`, and `H_new` exists nowhere on disk — while the caller is told the build failed.

The header comment at lines 42–45 narrows the exposure to "the one interruptible window is the single rename in step 6: an interrupt there," but a rename *error* is not an interrupt — it is a deterministic, reproducible path that produces a strictly worse state than the interrupt case (the interrupt leaves `H_old` bytes present; the error path leaves nothing). This is the same class of defect AUDIT-20260716-14 closed, moved one step later rather than removed.

Blast radius: a consumer building on the documented contract (a CLI retry loop, `pc validate`, `src/state/modified.ts`) reasons "the build threw, therefore no record was written" and will not reconcile. Fix: either roll the ledger back to `current` when the rename throws, or reorder so the rename failure is folded into the same failure domain as the record write — and correct the JSDoc at lines 85–87 either way, since it is currently a false invariant a downstream reader will rely on.

---

### AUDIT-20260724-44 — `record()` is an unsynchronized read-modify-write of the ledger — concurrent builds silently lose artifact records

Finding-ID: AUDIT-20260724-44 (claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/providers/build.ts:258-263 (`const current = await readLedger(...); await writeLedger(context.episodeDir, { ...current, artifacts: { ...current.artifacts, [id]: artifact } });`)

`record`'s doc justifies re-reading the ledger ("the copy loaded before the provider ran is a snapshot from before"), which correctly narrows the window relative to reusing `context.ledger` — but it does not close it. Between `readLedger` and `writeLedger` there is no lock, no compare-and-swap, and no temp-plus-rename discipline visible at this layer. Two `buildTarget` calls in flight — which is the obvious shape for a DAG builder fanning out independent targets, and the obvious shape for an operator running two `pc build` invocations — will both read the pre-write ledger and the second write will clobber the first target's `ArtifactRecord`.

The consequence is precisely the failure the module header is built to prevent: the losing build's bytes are committed to `dist/`/`ai-generated/` by its own `fs.rename`, while its record is silently dropped. The result is "an operator holding a file nobody can say the origin of" — a rumour — produced by the very function whose doc promises there is no path to one. Worse, the loss is silent: nothing re-reads or verifies the write.

Blast radius: high, and it grows with adoption, since serial building is the temporary condition and parallel building is the natural optimization someone adds later without touching this file. Note also that `reviews` (human decisions) live in the same document, so a concurrent review write loses human-authored data, not just a regenerable record. Fix: make the record write a compare-and-swap or take an exclusive lock over the ledger file for the read-modify-write span, and fail loud on conflict rather than last-writer-wins.

---

### AUDIT-20260724-45 — Every schema is non-strict, so a misspelled `impure` or `validator` key is silently stripped — downgrading a provenance claim and an independence guarantee to a silent default

Finding-ID: AUDIT-20260724-45
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/manifest/schema.ts:78-81, 87-98, 100-112, 114-131 (every `z.object({...})`, none `.strict()`)

Zod's default object behavior strips unknown keys. `EpisodeManifestSchema` refuses an unknown `version` loudly — "an unknown version is a refusal, never a best-effort parse (FR-005)" — but every sibling key is parsed best-effort. Two concrete, high-consequence instances:

1. `ProviderDeclSchema.impure` (lines ~89–98). An operator who writes `impure_reason:`, `impurity:`, or misindents `impure` under `cmd` gets a silently pure provider. `build.ts:112` then routes the output to gitignored `dist/` instead of committed `ai-generated/`, and `record` omits `producer_impure` — so the ledger affirmatively presents a non-reproducible artifact as reproducible. The whole FR-032 apparatus (the object-not-boolean shape, the non-empty-reason refine) is defeated by a typo that produces zero diagnostics.
2. `TargetDeclSchema.validator` (line ~112). `ValidatorDeclSchema`'s own doc says the declaration "is what makes a target's acceptance gate INDEPENDENT of its generator … an impure tool cannot certify its own output," and that a target with no validator "falls back to the producer's own `validation` verdict." A misspelled key therefore silently converts an independent gate into producer self-certification — a fallback that hides a failure mode, which the project's own guidance names a bug factory.

Blast radius: high. The reading an operator (or an unattended agent generating a profile from prose) reaches is "I declared it, therefore it is in effect"; the artifact never contradicts that, and the failure is invisible in output. Fix: `.strict()` on `EpisodeManifestSchema`, `ProfileSchema`, `TargetDeclSchema`, `ProviderDeclSchema`, `ValidatorDeclSchema`, and `AuthoredDeclSchema`, so an unrecognized key is refused naming the field, consistent with how `version` and `path` already behave.

---

### AUDIT-20260724-46 — Causal fallback turns non-input causes into misleading input chains

Finding-ID: AUDIT-20260724-46
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/chain.ts:197-210

`causalInputs()` falls back to every currently declared input whenever `status.cause.identity` is absent or is not in `node.inputs`. That is explicitly applied to `input-removed` at lines 197-199, but an `input-removed` state is caused by a formerly recorded input that is no longer declared. Returning all current inputs makes `pc explain` present unrelated surviving inputs as the causal path for the stale state.

The blast radius is high because an unattended consumer can act on the explanation as written and inspect or rebuild the wrong branch. In the documented `input-removed` case, the actual responsible identity is the removed one, but the chain will walk `spoken` or any other remaining input instead. A reasonable fix would make `input-removed` a distinct terminal explanation, or otherwise represent the removed identity without pretending current inputs caused the stale state; similarly, output-local causes like `output-edited` and `validation-failed` should not silently inherit the “all inputs” provenance behavior unless the contract says that is intentional.

### AUDIT-20260724-47 — File symlinks are followed even though tree symlinks are refused

Finding-ID: AUDIT-20260724-47
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/hash/path.ts:26-28

`hashPath` uses `fs.stat()`, which follows symlinks, then sends non-directories to `hashFile`. `hashTree` explicitly refuses symlinks because following them can escape the hashed root, but this wrapper still permits a symlink-to-file authored input and hashes the target bytes. That creates an inconsistent safety boundary: a directory symlink is refused, while a file symlink can point outside the episode and still be recorded as an in-episode input.

The blast radius is high because downstream `pc status` / `pc build` consumers can act on a manifest path that passed relative-path containment but actually resolves outside the episode through the filesystem. A reasonable fix is to make `hashPath` use `lstat`, reject symlinks before branching, and add coverage for file symlinks as well as directory/tree symlinks.

### AUDIT-20260724-48 — Waiver pins content observed at write time, not the content the human reviewed

Finding-ID: AUDIT-20260724-48
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/review.ts:145-168

`pc review` records `waivedHash: resolution.hash` after resolving the followed node at command execution time (lines 149-168). There is no way for the caller to provide the hash they actually reviewed, and no check that the followed content is still the same content shown by the earlier `pc status`/manual inspection. If the followed file changes between inspection and `pc review --waive`, the command writes a durable waiver for bytes nobody approved.

The blast radius is high because this is the human-in-the-loop safety gate: downstream `pc status` and release logic will treat that waiver as a real human decision and clear `needs-review`. A reasonable fix is to make the decision carry its subject, for example `--expect-hash <hash>` from status output, and refuse when the currently resolved hash differs before writing the ledger record.

### AUDIT-20260724-49 — Integration global setup does not serialize against the contract project’s builds

Finding-ID: AUDIT-20260724-49
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    vitest.config.ts:16-43

The config puts `globalSetup: ['tests/integration/global-setup.ts']` only inside the `integration` project at lines 25-35, while the `contract` project is a separate Vitest project at lines 37-43. That setup builds and snapshots `dist/`, but `tests/contract/build-emit.test.ts` also runs `npm run build` against the same repo `dist/`. Vitest project-level setup does not make the other project wait, so a full `vitest run` can still run the integration setup’s `npm run build` or snapshot copy while contract tests are rebuilding `dist/`.

The blast radius is high because this is the default test command surface, not a niche helper: a downstream agent or CI runner can see nondeterministic failures from half-written `dist/` or copied transient output, despite the comment at lines 31-34 claiming the race is solved. A reasonable fix is to make the shared build/snapshot a single top-level suite prerequisite for all projects, or move build-mutating contract checks into the same serialized path so there is only one owner of repo `dist/` during a full test run.

---

## Disposition (2026-07-24) — quote-bank feature graduated via override

Operator decision (**fix feature findings, then override**): the govern pass audited the whole
branch (`main...002-quote-bank`), so its 49 findings span three ownership buckets. The findings
that belong to the **quote-bank feature** (the `editorial-tooling` package + its tests/coverage)
were FIXED with regression tests; the rest are pre-existing / tool findings, out of scope for
quote-bank v1, and are tracked separately.

**Resolved — quote-bank feature (`editorial-tooling`):**
- **AUDIT-20260724-19, -20** — `ocr-fix` unanchored/empty-`before` acceptance + pristine-coordinate reconstruction (fabricated presentation could pass). Fixed in `b63e455` (+ fixtures `ocr-fix-missing-before/empty-before/at-out-of-bounds/multi-valid`).
- **AUDIT-20260724-31, -32, -09** — `span.offset` now verified; spans required in non-overlapping source order; a real NFD-vs-NFC fixture now proves the absence of normalization. Fixed in `5db65f2` (+ fixtures `offset-mismatch/spans-out-of-order/normalization-nfd`).
- **AUDIT-20260724-21** — model identity derived from the resolved command (no longer hardcoded `'claude'`), with an explicit `QUOTE_MINER_MODEL_ID` override. Fixed in `4c32c38` (+ `test/claude.test.mjs`).
- **AUDIT-20260724-33, -08, -14** — miner-bin test now asserts the ungrounded candidate is omitted; `editorial-tooling/**/*.mjs` brought under the eslint and file-size gates. Fixed in `6bd1025`.
- **AUDIT-20260724-17** — confirmed **FALSE POSITIVE**: `mine()` already enforces the FR-018 source-id mapping via `buildSourceMap` before any quote (miner.mjs), asserted in `miner.test.mjs`. No change.

**Deferred — out of scope for quote-bank v1 (tracked, not fixed here):**
- **Bucket B (~36 findings)** — pre-existing production-control **core** findings from the earlier episode/asset work (never merged to `main`, so the whole-branch diff re-surfaced them). NOT a quote-bank regression. Tracked as **TASK-6** (production-control core hardening). IDs: AUDIT-20260724-01, 02, 06, 07, 10, 11, 12, 13, 15, 16, 18, 22, 23, 24, 25, 26, 27, 28, 29, 30, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49.
- **Bucket C (3 findings)** — the stack-control **audit-barrage tool** itself (chunk under-transmission left the quote-bank fixtures un-audited; liveness-window/timeout scaling). Belongs upstream. Tracked as **TASK-7**. IDs: AUDIT-20260724-03, 04, 05.

Graduation recorded via `stackctl govern --override` (see the workflow journal).

---
slug: 004-voice-editions
targetVersion: ""
---

# Audit log — 004-voice-editions

## 2026-07-26 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260726-01 — Fixtures the derivation tests read are absent from the diff — only `.gitkeep` placeholders were committed

Finding-ID: AUDIT-20260726-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units.test.ts:32-178, voice-tooling/test/source-units-identity.test.ts:26-124, voice-tooling/test/source-units-invalid.test.ts:60-69 (fixtures under `voice-tooling/test/fixtures/sources/`)

These three files read twelve fixture documents by name — `basic-lf.md`, `crlf.md`, `whitespace-separator.md`, `multi-separator.md`, `frontmatter.md`, `frontmatter-not-first-line.md`, `trailing-whitespace.md`, `fenced-code.md`, `no-trailing-newline.md`, `repeated-blocks.md`, `reorder-a.md`, `reorder-b.md` — via `readFixture('sources', …)`, with no setup hook that creates them. The only fixture-tree entries anywhere in the audited diff are the placeholders listed in chunk `494bf79418727dbc`: `voice-tooling/test/fixtures/.gitkeep`, `fixtures/editions/.gitkeep`, `fixtures/sources/.gitkeep`, `fixtures/voices/.gitkeep`. No `.md` fixture appears in any chunk's file list, and `voice-tooling/.gitignore` was added in the same range (chunk `faee29b33f570360`).

Blast radius: if those files are untracked or ignored, the entire derivation suite fails at the first `fs.readFileSync` on any fresh clone or CI runner — and the T026 "whole-suite verification gate — tests/typecheck/eslint green" claim is machine-local, true only in the author's working tree. That is exactly the failure mode a verification gate exists to prevent, and it is invisible to anyone who only ever runs the suite in the tree where the fixtures were authored. Several of these fixtures are also whitespace-load-bearing in ways that survive git poorly even when tracked: `trailing-whitespace.md` asserts `'Alpha beta.   \n'` (source-units.test.ts:151), `crlf.md` asserts literal `\r\n` (line 88), `no-trailing-newline.md` asserts a missing final terminator (line 178), and `multi-separator.md` needs a tab-only line. Any `.gitattributes` `text=auto`/`eol` normalization, or an editor stripping trailing whitespace, silently rewrites the oracle.

A reasonable fix: confirm `git ls-files voice-tooling/test/fixtures/sources` lists all twelve; commit any that are missing; and add `voice-tooling/test/fixtures/** -text` (or equivalent) to `.gitattributes` so CRLF/trailing-whitespace fixtures are byte-preserved across checkouts. If the fixtures are instead meant to be generated, the generator belongs in the diff and must run before these tests.

### AUDIT-20260726-02 — Producer-drift fact is only reachable via a synthetic two-target fixture; the real single-edition upgrade path yields no drift signal at all

Finding-ID: AUDIT-20260726-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-freshness.test.ts:~47-62 (fact-2 docstring), ~190-225 (`driftEpisode`), ~240-300 (fact-2 assertions)

The test's own docstring states the mechanism precisely: "`producerDriftFor` (`src/state/resolve.ts`) reports drift by comparing `producer.tool`/`producer.version` ACROSS every artifact already recorded in one ledger." The test then manufactures the required second artifact by writing a stand-in provider (`drift-provider.cjs`) that lies about its tool name (`tool: { name: 'voice-revise', version: '${toolVersion}' }`) and by rewriting the fixture manifest to `manifest['targets'] = [TARGET, 'edition-drift']`. Both artifacts are built in the same run, from the same inputs, and never rebuilt.

The US3 acceptance scenario this is registered against is an *upgrade*: the operator bumps `voice-revise` and asks whether their existing editions went stale. In the ordinary voice-editions topology — one `edition` target, one recorded artifact — the cross-artifact comparison the docstring describes has nothing to compare against, so a genuine version bump reports **no drift whatsoever**, and after the next `pc build` the recorded version simply overwrites the old one, leaving still one artifact and still no signal. The test passes without ever exercising the path an operator actually walks: build → bump the tool → `pc status`. Nothing in this file distinguishes "drift is reported on upgrade" from "drift is reported only when two differently-versioned siblings coexist," yet the describe title and the ledger entry for T023 read as the former.

Blast radius: a downstream consumer (or an unattended agent reading the T023 ledger row as evidence) concludes the voice-editions feature reports producer drift on tool upgrade and builds/ships operator docs or a doctor rule on that premise. The observable behavior on a real single-edition episode is silence. A reasonable fix is to add a third leg that rebuilds the *same* target under a changed recorded tool version (rerun the stand-in provider at a second version against the same target, or otherwise force a second recorded version for `edition` itself) and assert what `pc status` reports then — and if the mechanism genuinely cannot report drift in the single-artifact case, say so explicitly in the docstring rather than letting the synthetic two-target shape stand in for the scenario.

### AUDIT-20260726-03 — Edition-body mutations invalidate the hash-keyed `edition_units` reference, so the verbatim and citation refusal tests may be certifying reference-resolution rather than the obligation they name

Finding-ID: AUDIT-20260726-03 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    `voice-tooling/test/fidelity-refuse.test.ts:47-74` (verbatim) and `:79-107` (citation)

Both refusal tests mutate bytes **inside the edition body**: `'The survey crew arrived…'` → `'The survey crew arriv3d…'` (lines ~50-54) and dropping `[^1]` from `"Historians credit the original engineer's calculations[^1]…"` (lines ~83-87). The sibling file establishes that ledger entries reference their destinations by derived-unit key, not ordinal: `voice-tooling/test/fidelity-uncorroborated.test.ts` records `E1 sha256:0d81f53d…`, `E2 sha256:9f4b011e…` per edition unit, and its accounting check states *"Every entry's `edition_units` reference resolves to an actual edition unit derived from the full edition file (confirmed via an `editionKeys` set membership check for every `edition_units` ref — zero unresolved)."* If destinations are keyed by `hash:occurrence`, then changing E1's or E2's bytes **breaks the reference before it breaks the obligation** — the mutated edition no longer contains a unit with the declared destination hash at all.

That makes both tests unable to distinguish the mechanism they claim to pin. The verbatim assertion is `result.failures.some(f => /verbatim/i.test(f) && /(differ|mismatch|byte)/i.test(f))` — a message like *"verbatim entry references an edition unit that does not resolve; bytes mismatch"* satisfies it just as well as a real byte-equality comparison. The citation test's `assert.equal(result.report.checks.citations?.state, 'failed')` carries the comment *"the citations check must be the one reporting the failure"* but asserts nothing exclusive, so it also passes if `citations` fails as a downstream consequence of an unresolvable destination rather than by detecting the absent `[^1]` marker. Worse, under hash-keyed destinations the byte-equality half of the verbatim check is **structurally unreachable by any content mutation** — every mutation dangles the reference first — which would make that comparison dead code with no test able to exercise it.

Blast radius: these are the flagship refusal tests for FR-023 and the verbatim op obligation. A later refactor that removes or breaks the actual citation-preservation or byte-equality logic would leave both tests green (the dangling-reference failure keeps them red-on-mutation), so the suite would certify a guarantee it no longer enforces — exactly the failure an unattended agent would trust. Confirming check: grep the ledger loader for how `edition_units` entries are keyed. If they are hash-keyed, the fix is to mutate the edition **and** update the ledger's `edition_units` hash to the mutated unit's real hash, so the reference resolves and only the named obligation breaks; additionally assert that no reference-resolution failure is present in `result.failures`, so the test fails if the wrong mechanism fires.

---

### AUDIT-20260726-04 — `unit_accounting` never tests the "exactly once" direction — a double-dispositioned unit is unverified

Finding-ID: AUDIT-20260726-04 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=low
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/unit-accounting.test.ts:1-120

The check under test is named for, and the T012 commit subject states, "exactly one disposition per source unit". The file covers three of the four arms of that contract: all-units-covered → ok (lines 34-49), one unit missing an entry → fail (51-74), an entry pointing at a unit that does not exist → fail (76-97). The fourth arm — **two ledger entries referencing the same source unit** — is never constructed. Nothing in this file distinguishes an implementation that counts dispositions per unit from one that builds a `Set` of covered unit keys and checks set-membership; the latter passes every test here while silently accepting a ledger that says a unit was both `cut` and rewritten.

That is precisely the failure the "exactly one" invariant exists to catch, and it is the direction that fails *open*: a contradictory ledger passes the fidelity gate rather than tripping it. Blast radius: `checkUnitAccounting` is contract step 3 feeding SC-001/FR-017, so a downstream consumer — including an unattended agent running `voice-fidelity` as its correctness gate — reads a green verdict on an edition whose ledger contains mutually exclusive dispositions for the same source text, and ships it. The header comment at lines 4-11 enumerates what is covered and does not admit the omission, so a reader auditing coverage from the comment concludes the contract is fully pinned.

A fix is one test: take the passing `coverage` array, push a second entry for `units[0]` with a different `op`, and assert `ok === false` with a failure naming the double-counted unit (and decide/pin whether `total` stays 3 or reports 4).

### AUDIT-20260726-05 — The entire `voice-tooling` package is excluded from every repo-level gate, and its replacement gates are never wired into anything that runs

Finding-ID: AUDIT-20260726-05
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    eslint.config.mjs:44-51 (with reference to the absence of any root `package.json` / `.github/workflows/*` change anywhere in the diff manifest)

The diff adds `'voice-tooling/'` to the root flat-config `ignores` array, removing ~1,900 lines of new TypeScript — the entire implementation surface of feature 004 — from `eslint .`. The justifying comment offers a compensating control: "its own package.json, tsconfig, dependencies, and gates (`node --test` + `tsc --noEmit`) … Root `eslint .` therefore leaves voice-tooling to its own package gates." That compensating control is not connected to anything. Walking the file lists for all seventeen chunks named in the prompt, the diff touches `voice-tooling/package.json`, `voice-tooling/tsconfig.json`, `voice-tooling/package-lock.json`, `.specify/feature.json`, `CLAUDE.md`, `eslint.config.mjs`, `profiles/`, `tests/fixtures/`, `tests/integration/`, and `tests/unit/graph/fixtures.test.ts` — and **no root `package.json`, no root `tsconfig.json`, and no CI workflow file**. Nothing in this feature causes the sub-package's 177 `node --test` cases or its `tsc --noEmit` to execute in the repo's aggregate verification. They ran because T026's operator ran them by hand, which the ledger records as a one-time event (`.stack-control/execute/voice-editions.ledger.jsonl:26`: "whole-suite gate GREEN: pkg 177/177+typecheck").

Blast radius: from the next commit forward, a change confined to `voice-tooling/src/**` can break the fidelity validator's unit tests, break its typecheck, and violate every lint rule in the root config, and the repo's own verification will report green. The only residual coverage is indirect — `tests/integration/voice-*.test.ts` spawn the real bins as subprocesses under the repo's vitest, so gross runtime breakage in the two happy paths those tests drive would still surface. Everything the 177 unit tests cover (multiset matching, unit accounting, op obligations, schema refusals) would not. A downstream contributor acting on this surface as written has no mechanical signal that they broke the validator.

The reasonable fix is to make the sub-package's gates part of the repo's gates rather than a note in a comment: a root `package.json` script that runs `npm --prefix voice-tooling test && npm --prefix voice-tooling run typecheck`, invoked by whatever CI entry point already runs `eslint .` and the vitest suite. The eslint ignore itself is defensible once the package's own gates actually run; today it is subtraction with no addition.

---

### AUDIT-20260726-06 — The eslint-ignore comment asserts typing discipline "is still enforced" in voice-tooling, but no gate there can enforce it

Finding-ID: AUDIT-20260726-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    eslint.config.mjs:49-50

The comment closes with: "(Typing discipline there — no any/as/ts-ignore — is still enforced, see voice-tooling verification.)" The two gates the same comment names as voice-tooling's own are `node --test` and `tsc --noEmit`. Neither enforces any part of that claim. `tsc --noEmit` does not diagnose `any` (it is a legal type; `noImplicitAny` only catches *inferred* `any`, never an explicit annotation), does not diagnose `as` assertions (they are a first-class language feature and the whole point is to silence the checker), and treats `@ts-ignore` as an instruction to *suppress* the very errors it would otherwise raise. The rules that do enforce this — `@typescript-eslint/no-explicit-any`, `no-unnecessary-type-assertion`, `@typescript-eslint/ban-ts-comment` — live in the root type-checked ruleset that line 51 has just switched off for this directory. The ledger (`voice-editions.ledger.jsonl:26`) is precise about what actually happened: "21 real violations fixed, 14 as-casts removed via new isRecord util, 0 any/as/@ts-ignore" — a manual audit performed once, at T026, over a snapshot. The comment converts that past-tense audit into a present-tense standing guarantee.

This is a distinct defect from AUDIT-BARRAGE-claude-01: that one is "the named gates don't run"; this one is "even when they run, they cannot check what the comment says they check." The blast radius is specifically the reader who does the responsible thing. An agent or contributor about to add `as unknown as Foo` in `voice-tooling/src/` will check whether the repo forbids it, find `/Users/orion/.claude/CLAUDE.md`'s "Never bypass typing — no `any`, no `as Type`, no `@ts-ignore`", then read this comment, conclude a gate is catching violations, and commit. Nothing fails. The `isRecord` util introduced at T026 to legitimately remove 14 casts will be the last such effort, because the pressure that produced it was a human reading files, not a rule.

The honest fix is either to give `voice-tooling` a minimal eslint config carrying just those three rules (it needs no prettier or idiom rules to do that, so the "out-of-scope mass-reformat" objection in the comment does not apply), or to rewrite the parenthetical to say what is true: typing discipline there was audited manually at T026 and is not mechanically gated.

---

### AUDIT-20260726-07 — `profiles/voice-editions.yaml` ships a command that cannot resolve to this feature's binaries and sends `npx` to an unclaimed public npm name

Finding-ID: AUDIT-20260726-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    profiles/voice-editions.yaml:17 and :21

Both tool bindings in the shipped profile are `npx`-invocations of a package named `voice-tooling` with a subcommand:

```yaml
    provider:
      cmd: [npx, voice-tooling, revise]
    validator:
      cmd: [npx, voice-tooling, fidelity]
```

This is wrong in two independent ways, and the second is the dangerous one. First, the shape does not match the binaries this very feature shipped: the manifest shows `voice-tooling/bin/voice-revise.mjs` (chunk 885876367b66f13c) and `voice-tooling/bin/voice-fidelity.mjs` (chunk faee29b33f570360) — two separate bins, not one `voice-tooling` dispatcher with `revise`/`fidelity` subcommands. Unless `voice-tooling/package.json` declares a third bin whose key equals the package name (which nothing in the ledger's T019 entry, "provider revise/request.ts(227)+model.ts(133)+emit.ts(69)+cli.ts(118)+bin", suggests), `npx voice-tooling revise` has no local bin to hit even after a workspace link. Second, and independent of the first: `voice-tooling` is an unscoped, brand-new, unpublished package name. When `npx` finds no matching local bin it falls through to the public registry. An operator who takes this profile at face value and runs a build causes an unattended fetch-and-execute of whatever the public npm registry serves for the bare name `voice-tooling` — a textbook dependency-confusion path, in a file that lives in the operator-facing `profiles/` directory rather than under `tests/`.

The header comment concedes the command is fake ("`edition`'s cmd is a PLACEHOLDER … a name-only recipe an operator resolves, not an invocation this repo's own tests ever execute") and defends it by precedent ("mirroring `editorial-audio.yaml`'s existing convention"). Precedent is why this is worth flagging rather than waving through: the convention is being propagated into a second file, and the project's own standing rule (`CLAUDE.md`: "Never implement fallbacks or use mock data outside of test code. Throw errors with a description of the missing functionality") points the other way. The blast radius is an operator or unattended agent that wires an episode to this profile and gets either a confusing npm 404 mid-build or arbitrary registry code executing with the build's privileges — not a named refusal telling them the recipe is unresolved.

A reasonable fix is to point the profile at the real, in-repo entry points (`[node, voice-tooling/bin/voice-revise.mjs]` / `[node, voice-tooling/bin/voice-fidelity.mjs]`, which is exactly what `tests/integration/voice-revise.test.ts` already does), or, if the profile genuinely must stay abstract, to use a scoped name that cannot be squatted and that fails closed.

---

### AUDIT-20260726-08 — T026 knowingly ships a payload-extraction defect, and the ledger's "extra-strict, not false-clean" characterization does not hold in the symmetric direction

Finding-ID: AUDIT-20260726-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unreachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    `.stack-control/execute/voice-editions.ledger.jsonl:26` (governing `voice-tooling/src/payload/extract.ts` and `voice-tooling/test/op-obligations.test.ts:112`, both outside this chunk)

The final ledger entry closes the feature with a defect deliberately left in the validator's core: "extract.ts numeric/citation `[^1]` double-count LEFT as confirmed known-issue for governance (fix would break op-obligations.test.ts:112 numerics===2; not low-risk; display already corrected via countProseNumerics)." The T016 entry (line 16) describes the mechanism: "extractPayload numeric regex catches digit inside `[^1]` citation marker -> T016 workaround strips markers for numeric display count, but op-survival still double-counts (extra-strict, not false-clean)."

The reassurance in that parenthetical is the part I want to challenge, because it is what justified shipping. Payload survival is a multiset containment test (T014, line 13: "survivesMultiset via freq-map decrement NOT set-dedup"). Phantom numerics contaminate *both* sides of that test, and the two directions have opposite consequences. On the destination side, a phantom is over-supply: a source unit asserting the prose fact "1" is satisfied by any surviving citation marker `[^1]` in the destination, even if the edition dropped the fact entirely. That is a **false clean** — a represented/merged unit passing fidelity while a numeric claim silently vanished — which is precisely the failure mode the fidelity contract exists to prevent, and it is the opposite of what the ledger asserts. On the source side, a phantom is over-demand, producing false refusals of faithful editions whenever citation numbering legitimately changes (most naturally under `merged`, where two units' footnotes get renumbered into one destination). "Extra-strict" describes only the second direction.

The second half of the note is the more durable problem: the reason given for not fixing it is that the fix "would break op-obligations.test.ts:112 numerics===2." That test asserts an extraction count that is only correct *because* the bug is present — the defect has been pinned as the contract, so the test now actively defends it against repair, and any future contributor who fixes `extract.ts` sees a red suite and reverts. Blast radius: the deterministic validator is the feature's entire trust anchor (T017 shipped a README section on exactly what it proves), and a false-clean path through it means an operator's `pc build` accepts an unfaithful edition with a passing coverage report and no signal. I would not treat "display already corrected via `countProseNumerics`" as mitigation — correcting the human-visible count while leaving the verdict path contaminated makes the report *more* misleading, not less, because the displayed number no longer matches the number the verdict was computed from.

A reasonable fix is to exclude citation spans from the numeric extraction in `extract.ts` (the T016 `countProseNumerics` workaround already demonstrates the span-stripping logic; the defect is that it was applied to display only), then re-derive `op-obligations.test.ts:112`'s expectation from the corrected semantics rather than preserving `numerics===2`. If the false-clean direction is judged unreachable, that argument needs to be made against `match.ts`'s actual multiset code and recorded — the current note asserts the conclusion without it.

---

### AUDIT-20260726-09 — The bins `chdir` into the package before resolving arguments, so relative operator-supplied paths resolve against `voice-tooling/`

Finding-ID: AUDIT-20260726-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=low/latent, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    `.stack-control/execute/voice-editions.ledger.jsonl:19` (governing `voice-tooling/bin/voice-revise.mjs` and `voice-tooling/bin/voice-fidelity.mjs`, both outside this chunk)

The T019 entry records this as a fix: "FIX: bins chdir into pkg before tsx register() (repo-root cwd picked wrong tsconfig `@/` -> latent voice-fidelity.mjs bug)." The underlying problem is real — `tsx`'s `register()` resolves `@/` path aliases from the nearest tsconfig relative to cwd, so invoking the bin from the repo root picked up the root tsconfig and mis-resolved the sub-package's imports. But `process.chdir()` is process-global state, and unless the bin resolves every `argv` path to an absolute form *before* changing directory, the fix relocates the failure rather than removing it: every relative path the caller passes on the command line now resolves against `voice-tooling/` instead of the caller's cwd.

I could not read either bin (they sit in chunks 885876367b66f13c and faee29b33f570360), so I state this conditionally: if the `chdir` precedes `path.resolve()` on the argv-supplied source/edition/voice paths, then `node voice-tooling/bin/voice-fidelity.mjs ./episodes/foo/source.md` from the repo root reads `voice-tooling/episodes/foo/source.md` — and given that the source-hash check runs first (T011, line 11: "check-source-hash.ts … FIRST"), the operator gets a file-not-found or a hash mismatch rather than anything naming the real cause. The evidence that this path is under-exercised is that the integration tests pass: T018/T019 drive the bins from vitest, where fixture paths are built from `import.meta.url` and are already absolute, so the tests are structurally blind to the defect the `chdir` introduces.

This interacts directly with finding 03. The moment `profiles/voice-editions.yaml` is wired to the real binaries, `pc build` will spawn them from the repo root with paths expressed relative to the repo root — the exact invocation shape the tests never cover and the `chdir` breaks. Blast radius: the feature's two entry points work from the test harness and from inside `voice-tooling/`, and fail confusingly from the one directory an operator or a build actually calls them from. The fix is to resolve all argv paths to absolute before `chdir`, or to avoid the global mutation entirely by giving `tsx`'s register call an explicit tsconfig path — which addresses the original alias problem without taking cwd hostage. Either way the cwd-independence deserves a fixture that invokes a bin from the repo root with a relative argument.

---

### AUDIT-20260726-10 — Shared profile ships unrunnable placeholder commands

Finding-ID: AUDIT-20260726-10
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    profiles/voice-editions.yaml:4-21

The committed `voice-editions` profile declares `provider.cmd: [npx, voice-tooling, revise]` and `validator.cmd: [npx, voice-tooling, fidelity]`, while the actual package exposes binaries named `voice-revise` and `voice-fidelity`, not a `voice-tooling` executable with subcommands. The comments also explicitly call the command a `PLACEHOLDER` and say real per-episode wiring points elsewhere. That makes the shared profile look valid to graph/status consumers but fail when an adopter actually runs the target from the profile as written.

The blast radius is high because this is an operator-facing reusable profile for the feature: an unattended consumer can select `profile: voice-editions`, pass static validation, and then hit a provider/validator execution failure instead of the claimed voice-editions workflow. A reasonable fix is to make the committed profile name real runnable commands, or remove the provider/validator commands from the shared profile if this system has a first-class way to require episode-local wiring.

### AUDIT-20260726-11 — Completion ledger records a known validator defect as left in place

Finding-ID: AUDIT-20260726-11
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    .stack-control/execute/voice-editions.ledger.jsonl:16-26

The execution ledger marks T026 as the whole-suite green completion gate while also recording that `extract.ts` still double-counts numeric payload inside citation markers like `[^1]`: line 16 says the numeric regex catches citation digits and op-survival still double-counts; line 26 says the issue was “LEFT as confirmed known-issue for governance.” That is not just bookkeeping: it documents an unresolved validator correctness bug inside the feature completion record.

The blast radius is high because downstream adopters rely on the fidelity validator to decide whether a voice edition passes. A source/edition pair with footnote citations can be refused for an artificial numeric payload obligation introduced by the citation syntax itself, so a valid edition can fail validation. A reasonable fix is to exclude citation spans before numeric payload extraction in the op-survival path and pin the behavior with a regression fixture using citation markers containing digits.

### AUDIT-20260726-12 — Declared input hashes are provably never verified against the bytes read; the tests pin acceptance of a fabricated hash

Finding-ID: AUDIT-20260726-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise.test.ts:48-49, 67-68 (also 91-95, 106-114, 144-166)

Every `BuildRequest` fixture in this file declares an input hash that cannot possibly match the file it points at — `hash: 'sha256:' + 'a'.repeat(64)` for `draft.md` and `'sha256:' + 'b'.repeat(64)` for `v.yaml` (lines 48-49 in `buildRequest`, lines 67-68 in the discrimination test). The tests then assert `parseReviseRequest(raw)` **succeeds** and returns `parsed.source.bytes.toString('utf8') === SOURCE_TEXT`. Since T026 reports the whole suite green, this is not a claim about what `request.ts` might do — it demonstrates that `parseReviseRequest` reads the bytes off disk and silently ignores the declared `hash` field entirely. No test anywhere in this file asserts that a declared hash which disagrees with the bytes read is refused.

The blast radius is provenance corruption in exactly the mechanism this feature exists to guarantee. The declared hash is the harness's statement of *which version of the source* this build was authorized against. If the source file changes between request composition and provider execution (an operator edit, a concurrent build, a `git checkout` mid-run), `voice-revise` revises the NEW bytes while the request's integrity field still names the OLD ones — a TOCTOU window with no detector at the point of use. Whether the resulting edition ships with false provenance then depends on which hash `emit.ts` records in the coverage ledger: if it records the declared hash, `check-source-hash.ts` will later compare a lie against a lie and pass. That path is outside this chunk, so I cannot close it, but the provider-side hole is confirmed here.

A reasonable fix is a fail-loud precondition in `parseReviseRequest`: after reading each input's bytes, compute the digest and refuse with a named cause when it disagrees with the declared hash (`declared sha256:aaa… for <path> does not match bytes on disk sha256:…`), plus a fixture in this file asserting that refusal. This is squarely the project's "throw errors instead of tolerating a missing guarantee" rule — an ignored integrity field is a fallback that hides a failure mode. The test fixtures should then carry real digests, which also removes the current situation where the fixtures teach a reader that the field is decorative.

### AUDIT-20260726-13 — `computeVerdict` cannot see a never-declared check, so SC-004 is enforced only against declared-and-skipped obligations

Finding-ID: AUDIT-20260726-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/report-types.test.ts:≈228-237, ≈288-295, ≈313-317

`computeVerdict` derives the top-level verdict purely from the `CheckResult` entries **present** in `report.checks`. The diff pins this directly: the test `'report interface: verdict is optional in CoverageReport'` builds `{ checks: { source_hash: passed() } }` — a single check — and the `'a decided failed() check'` test builds `{ source_hash: passed(), some_check: failed(...) }`, an invented two-entry map. Both are accepted as well-formed reports, and the one-check report yields `'passed'`. There is no closed vocabulary of required checks and no test asserting that a report missing an applicable obligation is rejected.

This makes the stated SC-004 invariant one-sided against its dominant failure mode. The invariant is written (lines ≈313-317) as "a `passed` top-level verdict never appears alongside an unrun *applicable* obligation," and the mechanism implements it as "no check may be in state `not-run` with `aborted: true`." But the way an applicable obligation actually goes unrun in practice is not that someone sets it to `not-run` — it is that `run.ts` never adds the entry at all (an early `return`, a `continue` on a thrown loader, a check added to the orchestrator behind a condition that is false, a key typo like `unit_accounting` → `unitAccounting`). In every one of those cases `computeVerdict` sees only passing checks and emits `'passed'` over a validation run that never executed the obligation. For an unattended agent extending the validator, that is the quiet-wrong outcome: the gate reports green and nothing in the type system or the test suite objects.

The fix is to make the required set data rather than an emergent property of orchestrator control flow: declare the v1 obligation vocabulary (`source_hash`, `ledger_structure`, `unit_accounting`, `verbatim_quotes`, `citations`, `numeric_literals`, `lexicon`, `uncorroborated_units`, `semantic_claim_fidelity`, `voice_conformance`) as a constant, have `computeVerdict` refuse to return `'passed'` when any required key is absent from `report.checks`, and add a fixture asserting that a report with a missing required key yields no verdict. Note this cuts against the current permissive `Record<string, CheckResult>` shape that `some_check` / `customField` rely on, so the fixtures in this file need updating alongside it.

### AUDIT-20260726-14 — The abort marker is an optional untyped flag, so forgetting it fails OPEN to `passed` — and a test codifies the fail-open

Finding-ID: AUDIT-20260726-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/report-types.test.ts:≈167-181, ≈296-311

Two tests together pin a fail-open safety gate. The first (`'explicit-abort not-run … → no verdict'`) establishes that an abort blocks the verdict only when the producer passes `{ aborted: true }`. The second (`'not-run WITHOUT the aborted marker never blocks, even with an "aborted"-sounding reason string'`) is an explicit regression guard that a `not-run` lacking the marker **must** yield `'passed'`. The no-reason-sniffing rule behind that is correct — text matching on `reason` would be worse. The problem is the shape it settled on: the only thing standing between "validation aborted after `source_hash` failed" and a green verdict is one optional boolean on an otherwise-identical state, and the type system is specifically prevented from enforcing it. The test `'check-result: index signature permits arbitrary count fields'` asserts that `CheckResult` accepts `customField: 'value'` and `nestedData: { nested: true }`, which means the index signature is wide enough that `notRun('aborted: …', { aborded: true })` (typo) and `notRun('aborted: …', { aborted: 'true' })` (string) both type-check cleanly and both produce a non-blocking `not-run`. Neither channel has a fixture.

Blast radius: a `passed` coverage report emitted over a run that aborted mid-way — precisely the outcome SC-004 exists to forbid, reached by a single-character mistake at any future abort site, with no compile error and no test failure. This is the "fallback that hides a failure mode" bug-factory the project guidelines name: the default behaviour of the safety-relevant field is to not trip.

The invariant-first fix is to stop representing abort as an optional attribute of `not-run` and make it its own state: `state: 'aborted'` (blocking, requires a `cause`) versus `state: 'not-run'` (non-blocking, requires an inapplicability `reason`). Then abort is unforgettable — a producer that wants the blocking state must name it, and `computeVerdict`'s switch is exhaustive over a discriminated union rather than sniffing an optional flag. Failing that, at minimum add fixtures for the non-boolean-truthy and misspelled-marker channels, and tighten the marker's declared type so `aborted: 'true'` is a type error rather than a silently ignored extra field.

### AUDIT-20260726-15 — The two edition fixtures this test requires do not appear anywhere in the diff

Finding-ID: AUDIT-20260726-15
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units-edition.test.ts:21-22, 28-29

This test reads `readFixture('editions', 'edition-ledger-a.md')` and `readFixture('editions', 'edition-ledger-b.md')` at lines 21-22 and 28-29. Scanning every chunk's file list in this audit, the only thing added under that directory is `voice-tooling/test/fixtures/editions/.gitkeep` (chunk `494bf79418727dbc`) — the `.gitkeep` placeholder that exists precisely because the directory is otherwise empty. Neither `edition-ledger-a.md` nor `edition-ledger-b.md` appears in any chunk, and chunk `faee29b33f570360` adds a `voice-tooling/.gitignore` whose contents I cannot see from here.

If those fixtures are untracked — either never `git add`ed, or matched by a broad pattern in the new `voice-tooling/.gitignore` — then the T026 "whole-suite verification gate: tests green" claim holds only on the machine that authored them. A fresh clone or a CI runner gets a `readFixture` throw at line 21 and this file dies at collection, taking the entire FR-011/D7 edition invariant with it. That is the worst variant of a broken gate: it does not report "invariant violated," it reports "file not found," which reads as an environment problem rather than a missing guarantee. The same exposure applies to every other `readFixture` consumer in the sibling chunks (`source-units.test.ts`, `source-units-identity.test.ts`, `golden-markdown.test.ts`), which read from `fixtures/sources/` — also added in the diff as a bare `.gitkeep`.

I could not run git in this invocation, so I cannot distinguish "the fixtures are committed and the chunk file lists I was given are simply incomplete" from "the fixtures are untracked." The check is one command: `git ls-files voice-tooling/test/fixtures` and `git check-ignore -v voice-tooling/test/fixtures/editions/edition-ledger-a.md`. If they come back tracked, close this finding; if not, commit the fixtures and narrow the ignore pattern. Worth doing regardless: a clean-clone run of the voice-tooling suite is the only thing that actually substantiates T026's claim, since the author's working tree cannot tell tracked from untracked files apart at test time.

### AUDIT-20260726-16 — `not-run` without an explicit inapplicability marker can false-clean the validator

Finding-ID: AUDIT-20260726-16
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/report-types.test.ts:156-168

The new verdict tests assert that a `not-run` check “never blocks” unless it carries `aborted: true`, even when the reason text mentions an aborted path. That makes the absence of `aborted` do double duty as “this check was inapplicable,” but the report shape has no explicit field proving inapplicability. A future applicable obligation accidentally emitted as `notRun('skipped due to missing input')` would still produce `verdict: passed`, violating SC-004’s stated invariant that a passed verdict never appears alongside an unrun applicable obligation.

Blast radius is high because this is the feature’s deterministic acceptance gate: downstream consumers can receive a false passed verdict and accept an edition whose applicable check did not run. A reasonable fix is to make inapplicability explicit, for example `notRun(..., { applicable: false })` or a named allow-list of inapplicable check states, and add a test proving an applicable-but-unrun check blocks the verdict.

### AUDIT-20260726-17 — Multiset discipline is per-source-unit only, so a merge lets one destination occurrence discharge several source units' obligations

Finding-ID: AUDIT-20260726-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/payload/match.ts:79-98 (`payloadSurvives`), with `survivesMultiset` at :32-50

`payloadSurvives(sourcePayload, destUnion)` takes exactly **one** source payload and a union of destination payloads. The module header (:3-8) states the property it exists to enforce: "each source-side occurrence must be discharged by a DISTINCT destination-side occurrence. One destination occurrence can never satisfy two source obligations." That property holds *within* a single source unit — the frequency-map decrement at :36-48 is correct — but the API shape makes it structurally unenforceable *across* source units that share a destination. In a merge (source units A and B both dispositioned into destination unit D — a shape a voice edition will hit constantly, since condensing several source paragraphs into one is the normal operation), a caller iterating source units calls `payloadSurvives(A, union([D]))` and then `payloadSurvives(B, union([D]))`. `remaining` is rebuilt from scratch on the second call. If A contains `1978` once and B contains `1978` once, and D contains `1978` once, both calls return `ok: true` — one destination occurrence has corroborated two source obligations. That is precisely the false-clean the module claims to prevent, moved one level up.

Blast radius: this is a **false-clean**, not a false refusal. The fidelity checker is the gate that authorizes shipping an edition; a merge that silently drops half the numerics/citations/quotes it claimed to carry forward passes the check and gets reported as faithful. Downstream consumers (an operator, or an unattended agent reading the coverage report) act on a "payload survives" verdict that was never actually proven for merges. The bug is invisible to the unit tests in this chunk's sibling files because a one-source-one-dest fixture cannot expose it.

A reasonable fix: make the accounting unit an *entry* (or a whole destination unit), not a single source unit — e.g. `payloadSurvives(sourcePayloads: readonly UnitPayload[], destUnion)` that unions the source side and decrements a single shared `remaining` map, retaining per-source attribution by recording which source contributed each shortfall. If the intended semantics really is per-source-independent (i.e. merges are deliberately checked leniently), that is a scope boundary that must be stated here as the mechanism's invariant plus its exception, and the coverage report must not label a merge-bearing entry's payload check as a full pass. Either way there needs to be a fixture with two source units → one destination unit sharing a payload value.

---

### AUDIT-20260726-18 — Source allow-list parse errors escape `runFidelity`

Finding-ID: AUDIT-20260726-18
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:175-181, voice-tooling/src/fidelity/run.ts:230-235

`runFidelity` catches unreadable edition ledger extraction and source unit derivation, but the source citation allow-list path is outside any error boundary. `checkSourceCitationAllowlist(input.source)` at lines 175-181 can throw when source frontmatter YAML is malformed or when `citation_allowlist` has an invalid shape; the later `parseSourceCitationAllowlist(sourceText)` at lines 230-235 has the same throw path. If the embedded ledger’s `source.hash` matches those exact malformed source bytes, the source-hash gate passes first, then the validator throws instead of returning either a decided refusal or the required no-verdict result.

The blast radius is high because the CLI calls `runFidelity` directly and downstream tooling expects the validator’s structured three-outcome contract. A malformed but hash-matched source can produce an uncaught process failure with no `CoverageReport` shape and no named obligation state, which breaks FR-030/SC-006 behavior for a realistic bad input. A reasonable fix is to wrap the source allow-list parsing/checking inside `runFidelity` and convert thrown parse/schema errors into the contract’s explicit refusal shape, with a regression test that keeps `source.hash` valid while corrupting only the source frontmatter.

### AUDIT-20260726-19 — `represented` entries with zero declared destinations silently pass the obligation check

Finding-ID: AUDIT-20260726-19 (claude-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    `voice-tooling/src/fidelity/check-op-obligations.ts` (~L116–142, the `const destRefs = entry.edition_units ?? [];` block through `checkPayloadSurvival`)

For a non-`cut` entry the code does `const destRefs = entry.edition_units ?? [];`, then loops over `destRefs` to resolve destinations. If `edition_units` is absent or `[]`, that loop body never runs: `destContents` stays `[]`, `anyDestMissing` stays `false`, and control falls into `checkPayloadSurvival`, which computes `unionPayload([])` — an empty union. `payloadSurvives(sourcePayload, emptyUnion)` only fails if `sourcePayload` is non-empty. Since `isEmptyPayload` is true for any source unit with no quote, no citation, no numeric, and no lexicon hit — i.e. ordinary prose, which is the majority of a draft's units — an entry declaring `op: represented` with **no destination at all** passes the adversarial core cleanly. It is counted in `opCounts.represented`, contributes to `uncorroboratedUnits` (which is explicitly *report-only* per D12/FR-022), and produces zero failures.

This is a hole in the exact guarantee the module claims to enforce. The file's own header calls this "the adversarial core," and the module already re-affirms two structural invariants defensively "for a ledger built by other means" (`checkVerbatim`'s `destRefs.length !== 1` guard, `checkMergedSharedDestination`'s shared-destination guard) — but not this one. The asymmetry is the tell: the author reasoned about `verbatim` and `merged` arity and skipped `represented`. Blast radius: a producer (including the LLM-driven `voice-revise` path this feature ships) can drop arbitrary source prose from the edition by labelling it `represented` and emitting an empty `edition_units`, and `voice-fidelity` reports PASS. The unit-accounting check (T012) is satisfied — the unit *has* a disposition — so nothing else catches it. Fix: for `op !== 'cut'`, push a named failure when `destRefs.length === 0`, symmetric with `checkVerbatim`'s arity guard.

---

### AUDIT-20260726-20 — `bin/voice-revise.mjs` mutates process-global cwd, breaking relative operator input and any relative model command spawned downstream

Finding-ID: AUDIT-20260726-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    `voice-tooling/bin/voice-revise.mjs:35` (`process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));`)

The shim `chdir`s into `voice-tooling/` before `register()` so tsx resolves the package's own `tsconfig.json` for the `@/*` alias. The 20-line comment justifies the safety of doing this unconditionally on one premise: "every path this process touches (the `BuildRequest`'s input paths and `output_dir`) arrives already resolved to an absolute path (contract 'Input' — FR-030)." That premise covers exactly one caller — `pc build`. It does not cover the two other paths this same comment acknowledges:

1. **Hand invocation.** The comment itself cites the contract's "Runnable by hand" example as a reason the shim must self-register tsx. An operator running `voice-tooling/bin/voice-revise.mjs --source ./draft.md --out ./editions` from the repo root gets those relative paths resolved against `voice-tooling/`, not their shell's cwd — silently reading the wrong file, or writing the edition into the tooling package. There is no absolute-path precondition enforced in this shim, and nothing in the diff shows `runReviseCli` refusing a relative path. That is a fallback-shaped failure mode: it produces a plausible-looking wrong result rather than an error, which the project's "no fallbacks — throw instead" rule exists to prevent.
2. **The spawned model subprocess.** `voice-revise` is an impure provider that spawns a model command (the feature ships `tests/fixtures/voice-revise/stub-model.mjs` and `profiles/voice-editions.yaml`). Any child spawned after this `chdir` inherits `voice-tooling/` as its cwd, so a model command or fixture path expressed relative to the invoking project resolves wrong.

The fix is to stop reaching for a global process mutation to solve a module-resolution problem. tsx supports pointing at a specific tsconfig without changing cwd (`TSX_TSCONFIG_PATH` set to `<pkgdir>/tsconfig.json` before `register()`), which achieves the stated goal with no cwd side effect. If `chdir` is kept, the shim must first resolve every incoming path argument against the *original* `process.cwd()` and refuse non-absolute paths with a named error — not assume FR-030 holds for callers the comment itself says exist.

---

### AUDIT-20260726-21 — Unvalidated `JSON.parse` result: a well-formed-JSON request missing `inputs` crashes instead of refusing

Finding-ID: AUDIT-20260726-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:74-94

`request = JSON.parse(requestText)` (line 76) assigns an `any` straight into `let request: ValidateRequestWire` — no runtime validation of the wire shape at all. The only guard is the `try/catch` around the parse itself, which catches *syntax* errors, not shape errors. Line 84 then does `request.inputs['source']` **outside any try block**. For a syntactically valid but shape-invalid request (`{}`, `{"target":"x"}`, or a request that spells the field `Inputs`/`input`), this throws `TypeError: Cannot read properties of undefined (reading 'source')`, which escapes `runFidelityCli` as a rejected promise. The contract names three outcomes (passed / decided-failure / cannot-decide); an unhandled rejection is a fourth: no `ValidateResponse` on stdout, no coverage report on stderr, just a stack trace.

Line 94 (`request.artifact.path`) is inside the read `try`, so a missing `artifact` degrades to the misleading diagnostic `could not read the source or artifact from disk: Cannot read properties of undefined (reading 'path')` — an unrelated error message for a schema problem. So the same class of defect produces two different wrong behaviors depending on which field is absent. This also violates the project's "never bypass typing" rule: the declared `ValidateRequestWire` type is a claim the code never checks, which is exactly the shape that makes downstream reasoning unsound.

Blast radius: an orchestrator that constructs the `ValidateRequest` slightly wrong (or bumps the contract) gets a crash with empty stdout. A harness that reads exit code plus stdout cannot distinguish "validator crashed on my malformed request" from "validator could not decide" — both are exit 1 with no stdout. An unattended build loop would plausibly treat the empty-stdout crash as the FR-030 cannot-decide path and route it to the wrong handler. Fix: validate the request against the wire schema (a hand-rolled type guard over `version`/`target`/`artifact`/`inputs`, or the same schema machinery used for the ledger/voice docs) before touching any field, and return a named `voice-fidelity: ValidateRequest.<field> ...` refusal on failure.

### AUDIT-20260726-22 — `quoteBankDeclared` hardcoded `false` and all non-`source`/`lexicon` inputs silently dropped

Finding-ID: AUDIT-20260726-22
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:84-126

The CLI reads exactly two keys out of `request.inputs` — `source` (line 84) and `lexicon` (line 103) — and silently ignores every other declared input. Line 125 hardcodes `quoteBankDeclared: false`, justified by the comment "No quote-bank input exists on this v1 wire contract (D14) — always false." But `inputs` is typed `Record<string, WireBuildInput>` (line 26): nothing prevents a caller from declaring `quote_bank`, and nothing in this code *notices* if they do. The D14 quote-dialect conditional (shipped in T015, `check-payload`/`classify-op-failures`) is therefore permanently unreachable through the CLI, and a declared quote bank produces no error, no warning, and no `not-run` check entry.

This is the failure mode `report.ts`'s own header docstring says must never occur — "a `passed` top-level verdict never appears alongside an unrun *applicable* obligation" — with the twist that `computeVerdict` cannot even detect it, because the obligation is never recorded as a check at all (see AUDIT-BARRAGE-claude-03). It is also a hardcoded value standing in for configuration, and a fallback that hides a failure mode, both named bug-factories in the project guidelines.

Blast radius: an operator wires a quote bank into the build graph, sees `state: "passed"` and a clean coverage report, and reasonably concludes quote-dialect fidelity was checked. It was not. Silent under-checking of a fidelity validator is the worst outcome the feature has, because the artifact it green-lights carries the validator's authority. Minimum fix: enumerate the accepted input keys and *refuse by name* on any unrecognized key (`voice-fidelity: unsupported declared input "quote_bank"`), so the v1 boundary is enforced rather than assumed. Better fix: thread `quote_bank` through to `quoteBankDeclared`, since the checker already exists.

### AUDIT-20260726-23 — Failure-classification regexes match against messages that embed arbitrary payload content, so one kind's failure flips other named checks

Finding-ID: AUDIT-20260726-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/classify-op-failures.ts:30-35 (regex constants), cross-referenced with the message format at :118-121

`QUOTE_SURVIVAL_FAILURE = /(?:^|\s)quote /i`, `CITATION_FAILURE = /(?:^|\s)citation /i`, `NUMERIC_FAILURE = /(?:^|\s)numeric /i`, and `LEXICON_FAILURE = /lexicon term /i` are applied to `checkOpObligations`'s flat failure strings. Those strings interpolate the *payload item itself* into the message body — this file constructs the same shape at :118-121: `` `op obligation: entry for source unit ${srcRefLabel}, op=${entry.op}: ${KIND_LABEL[kind]} ${item} does not survive into declared destinations (destination unresolved)` ``. `item` is raw source content — a quoted span, a citation marker, a lexicon term. So a single failing quote whose text happens to contain the word "numeric ", "citation ", or "quote " matches two or three patterns at once, and the coverage report flips `numeric_literals` and/or `citations` to `failed` when no numeric or citation obligation actually failed. In a corpus about citation practice and quote banks, quoted prose containing the words "citation" or "quote" is not a contrived input — it is the expected input.

The regexes are also anchored only on a preceding whitespace/start boundary with a trailing space, with no anchoring to the message's *structural* position (immediately after `op=<op>: `), so any occurrence anywhere in the string wins. `LEXICON_FAILURE` has no leading boundary at all.

Blast radius: the coverage report is the artifact an operator or unattended agent acts on. A check reported `failed` with no corresponding real defect sends the consumer to hunt a numeric-literal drift that does not exist, and repeated spurious reds are exactly how a validator earns a blanket suppression. Direction is over-report rather than under-report today, so this is `high` rather than `blocking`. A reasonable fix is to stop classifying by regex over rendered prose: have `checkOpObligations` return structured failures (`{kind, message}`) and let this module switch on `kind`, keeping the regexes (if at all) only as a legacy fallback with an anchored `^op obligation: .*op=[a-z]+: (quote|citation|numeric|lexicon term) ` prefix match.

### AUDIT-20260726-24 — `treatment` is a first-class CoverageEntry field with zero validation coverage, and D21's unknown-key acceptance turns a typo into silence

Finding-ID: AUDIT-20260726-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/ledger-schema.test.ts:22-41, :62, :285-302

`VALID_LEDGER` carries `treatment: compressed` on the `represented` entry (~line 33) and the round-trip test asserts `representedEntry.treatment === 'compressed'` (~line 62), so `treatment` is a real, typed field in the loader's output. But the suite pins *nothing* about it: no test that `represented` requires a treatment, no test that `verbatim`/`merged`/`cut` must not carry one, no test that its value comes from a closed set. Compare this to `reason`, which gets four dedicated tests (required-for-cut, absent, whitespace-only, forbidden-on-non-cut) — the asymmetry is conspicuous for two fields that sit side by side in the same entry shape.

The gap compounds with the last test in the file (`accepts an entry carrying an unknown extra key (additive extensibility, D21)`, ~lines 285-302), which pins that unknown keys are *accepted and preserved*. Those two facts together mean an operator or an agent authoring a ledger that writes `treatement: compressed`, or omits `treatment` entirely on a `represented` entry, gets a clean `loadLedger` — the misspelling is swallowed as a D21 extension and the real field is `undefined`. Nothing in this suite would catch a loader that permits it.

Blast radius: this is the structural gate in front of the fidelity validator. If `check-op-obligations` (T013) branches on `treatment` to decide what a `represented` op must satisfy, an `undefined` treatment either throws deep in the validator with a non-named error, or — worse — falls through the branch and lets a `represented` disposition pass without its per-op obligation. The feature's stated guarantee is that a certified edition has a checked disposition for every source unit; a silently-untyped disposition undermines exactly that. A reasonable fix: add the four `treatment` tests mirroring the `reason` set, and make D21's unknown-key acceptance explicitly *not* extend to near-miss spellings of known keys (or at minimum pin the closed set of treatment values so a wrong value is a named refusal).

---

### AUDIT-20260726-25 — Lexicon obligation test asserts only the `lexiconApplicable` flag, on a fixture whose lexicon term demonstrably does NOT survive into the destination

Finding-ID: AUDIT-20260726-25 (claude-01 + claude-02 + claude-03 + claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/test/op-obligations.test.ts:119-125 (the `a lexicon makes lexiconApplicable true` test), fixtures at :32-58

The test is:

```ts
const result = checkOpObligations(faithfulLedger(src, ed), src, ed, ['Gamma']);
assert.equal(result.lexiconApplicable, true);
```

It asserts nothing else — not `result.ok`, not `result.failures`, not `result.payloadChecked.lexiconTerms`. So the only contract it pins is `lexicon != null && lexicon.length > 0`, which is a property of the argument, not of the checker.

Worse, the fixture it runs against is one where the lexicon term *fails*. `FAITHFUL_SOURCE` contains `'Gamma one with 42.'` and `'Gamma two cites [^c].'` (capital G, two source units), while the shared merged destination in `FAITHFUL_EDITION` is `'Merged gamma line with 42 and [^c].'` — **lowercase** `gamma`. The sibling file pins lexicon matching as byte-exact and case-sensitive (`payload-extract.test.ts`: `lexicon: byte-exact case-sensitive — "Bridge" does NOT match "bridge"`). So under the declared semantics this ledger has two lexicon-term shortfalls and `result.ok` must be `false`. The test passes either way: if the checker enforces lexicon survival, the test silently swallows a real failing case; if it does not enforce it (only counts it), the test silently blesses a validator that reports `lexiconApplicable: true` in the coverage report while performing no lexicon obligation at all.

Blast radius: the lexicon is declared-voice payload — the one payload class that is voice-specific rather than mechanical. A consumer reading the coverage report sees `lexiconApplicable: true` and concludes the declared lexicon was corroborated across the edition. This is exactly the false-clean the validator exists to prevent, and it is the single highest-value assertion in this file that was left off. A reasonable fix: assert `result.ok === false` with the exact lexicon-shortfall failure strings for `Gamma` on this fixture, and add a separate positive fixture where the term genuinely survives case-exactly, asserting `ok === true` and `payloadChecked.lexiconTerms === 2`.

---

### AUDIT-20260726-26 — Contract-legal optional `lexicon` / quote-bank input is hard-refused as "more than one source draft"

Finding-ID: AUDIT-20260726-26
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/request.ts:104-186 (discrimination comment at :24-30; refusal at :168-176)

`parseReviseRequest` classifies inputs by "does `loadVoice` accept the bytes": everything that parses as a voice document goes to `voiceMatches`, and **everything else** goes to `otherEntries`. It then requires `otherEntries.length === 1`, refusing with `` `target ${target}: expected exactly one source draft input, found ${otherEntries.length}` `` otherwise. The file's own header comment (lines 27-30) concedes the gap: *"an optional `lexicon`/`quote-bank` input may also appear per the contract, but the fixture wiring T019 targets never declares one."* So a request the contract permits — source + voice + quote-bank — is refused, and refused with a diagnosis that names the wrong cause: it reports two competing *source drafts* when the operator actually declared one source and one lexicon.

Blast radius: an operator (or an unattended agent) wiring a profile per `contracts/voice-revise-provider.md` and the FR-024 quote-bank conditional gets a hard build refusal whose message points at the source-draft count, sending them to delete a legitimately declared input or to rewrite FR-007-related code. The failure is loud, which caps this below `blocking`, but the diagnosis actively misleads and a documented capability is unreachable. Note also that this is a scope boundary stated as "we exclude the counterexample the fixtures don't cover" rather than as an invariant — the invariant that would make this correct is *"exactly one non-voice, non-lexicon input is the source"*, which requires the classifier to recognize a lexicon at all.

A reasonable fix: classify by type for all three roles (voice / lexicon / source) so a lexicon entry is bucketed out before the source-count check, or — if v1 genuinely accepts only two inputs — refuse a third input with a message that names it as an unsupported input kind rather than as an ambiguous source draft, and cover it with a fixture.

---

### AUDIT-20260726-27 — The model is handed no instruction at all, so only the deterministic test stub can satisfy the documented output contract

Finding-ID: AUDIT-20260726-27 (claude-02 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/revise/model.ts:82-83 (payload assembly), :62-79 (contract claim)

`invokeModel` builds its entire stdin payload as `JSON.stringify({ version: 1, ...input })` — i.e. `{version, target, source:{identity,hash,text}, voice:{identity,hash,doc}}`. There is no task instruction, no system prompt, no ledger-schema description, and no statement of the per-unit disposition obligations anywhere in this chunk. Yet the doc comment at lines 66-68 asserts the captured stdout is *"the raw edition text — markdown INCLUDING its leading `ledger:` frontmatter block"*, and `resolveModelCommand`'s own error text advertises `VOICE_REVISE_MODEL="claude -p"` as the intended real configuration (lines 33-38).

A bare `claude -p` handed that JSON blob with no instruction will emit conversational prose, not an edition with a coverage ledger enumerating one disposition per source unit. The only producer that can satisfy the contract is one whose *entire* behavioral specification lives in the operator's env-var argv (or a stub like `tests/fixtures/voice-revise/stub-model.mjs`). That is the "configuration that should be data ending up as code" trap inverted: the load-bearing prompt is neither code nor declared data — it is absent, and the US2 green signal comes from a stub that hardcodes the shape the real path cannot produce.

Blast radius: the impure half of the feature works in tests and does not work for a real model wiring; the downstream `voice fidelity` validator will refuse the result with a ledger-structure error, so it fails loudly rather than silently — hence `high` and not `blocking`. Fix: construct the model prompt in `model.ts` (source text + voice directives + the ledger contract the validator enforces) and pin it with a test asserting the payload contains the disposition obligations, so the prompt is a reviewable artifact rather than an operator's shell string.

---

### AUDIT-20260726-28 — 32 MiB stdout cap silently truncates the edition and returns it as success

Finding-ID: AUDIT-20260726-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/model.ts:80, 92-98, 128

```ts
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
...
child.stdout.on('data', (chunk: Buffer) => {
  outputBytes += chunk.length;
  if (outputBytes <= MAX_OUTPUT_BYTES) { stdoutChunks.push(chunk); }
});
```

Once the cap is crossed, every subsequent chunk — including the one that crossed it — is dropped, and the `close` handler then `resolve()`s the accumulated prefix as if it were the complete edition. Nothing records that truncation happened: no error, no stderr line, no flag on the return value. `emitEdition` writes that prefix to `<target>.md` and `cli.ts` prints a `BuildResponse` with exit code 0. This directly contradicts the function's own contract at line 78: *"never returns fabricated or partial output"* — a truncated edition is precisely partial output.

Blast radius: a truncated edition is a *valid-looking* build product. It carries whatever `ledger:` frontmatter appeared in the first 32 MiB while missing an arbitrary tail of the narration, so the ledger claims dispositions for units the markdown no longer contains. Whether the fidelity validator catches that depends on where the cut lands (a cut inside the frontmatter fails loudly; a cut in the body may surface as unit-accounting rather than as "your output was truncated"). The magic number is also unexplained — there is no comment justifying 32 MiB for a narration rewrite.

Fix: on crossing the cap, `child.kill()` and `reject()` with an error naming the limit and the byte count, so the refusal is loud; keep the cap, drop the silent path.

---

### AUDIT-20260726-29 — Model identity is not recorded, so model swaps are invisible

Finding-ID: AUDIT-20260726-29
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/cli.ts:102-103, voice-tooling/src/revise/emit.ts:59-63

The revise provider records `tool.version` from `voice-tooling/package.json` only, then emits `{ name: 'voice-revise', version: toolVersion }`. The feature contract says `tool.version` must carry the real model identity so a model swap behind a fixed command surfaces as producer drift; this implementation has no path from `resolveModelCommand()`/`invokeModel()` to the emitted version.

Blast radius is high because downstream freshness/provenance consumers will treat outputs from different model versions as produced by the same tool version. A reasonable fix would make the model adapter return or resolve a model identity and include it in `tool.version`, or refuse when the configured model command cannot provide the identity needed for drift detection.

### AUDIT-20260726-30 — Companion status can regress to `stale` without failing this test

Finding-ID: AUDIT-20260726-30
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-inputs.test.ts:224-245

The test title and comments claim the companion is “accepted” and that `follows` “never triggers a rebuild”, but the only state assertion is `expect(editionNode?.state).not.toBe('modified')` on line 232. If adding `companion` incorrectly caused `edition` to report `stale`, this test would still pass through the state check, even though that is exactly the bad behavior the contract is trying to prevent: a non-input advisory node would be treated as rebuild-relevant.

The later byte and ledger assertions only prove `pc status` did not write files; they do not prove the status model remains clean. `pc validate` can also pass over an unchanged artifact while `pc status` still reports it stale. A reasonable fix is to assert the exact clean state after adding the companion, e.g. `expect(editionNode?.state).toBe('fresh')`, ideally also checking the cause remains the normal OK cause and that no cause names `companion`. The blast radius is high because this acceptance test can green-light an implementation that blocks release or sends agents to rebuild an edition merely because a human-safe companion note was added.

### AUDIT-20260726-31 — The FR-028 "edition confined to `.ai/`" test asserts a constant and never routes anything

Finding-ID: AUDIT-20260726-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-zoning.test.ts:175-185

The final block is titled `'the voice edition output path assertion'` and its `it()` name claims "the impure voice edition is routed under impureOutputRoot (`.ai/`) by the build gate (FR-028)". The body (lines 180-182) is: copy a fixture, discard the returned directory, call `impureOutputRoot()`, and assert it equals `'.ai'`. No build runs, no edition is produced, no output path is inspected, and the copied fixture is unused — it is created purely so the test has an `await` in it. The only real assertion is that a constant-returning helper returns the constant `.ai`, which is tautological with respect to the requirement: if the build gate stopped routing editions to `impureOutputRoot()` altogether, or routed them to a hardcoded sibling path, this test would still pass.

Blast radius: the file header, the task ledger (T021), and the commit subject `5280317 test(voice): regression — voice edition confined to .ai/ …` all record this as *regression coverage* for FR-028/SC-005. A downstream maintainer refactoring the edition emit path will read the green suite as evidence that edition confinement is pinned, and will ship a regression that lets an impure voice edition land in the human-safe zone — the exact failure the content-zone-segregation work exists to prevent. A test that overstates its own coverage is more dangerous than a missing test, because a missing test is visible.

A real fix builds the clean fixture's `edition` target (the fixture already wires `targets: ['edition']`, per tests/unit/graph/fixtures.test.ts:211-227) and asserts the produced artifact's on-disk path is under `<dir>/.ai/`, plus the negative case: an edition mis-declared outside `.ai/` is refused by the build gate with a named refusal. If building the edition inside this test is genuinely out of reach (it needs the stub model), then the honest move is to delete this block and state plainly in the file header that the build-gate half of FR-028 is covered elsewhere — naming where — rather than leaving a constant-check wearing the requirement's name.
```

```

## 2026-07-27 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260727-01 — `npm test` discovers zero `.ts` test files on Node 20, so the suite gate can pass green having run nothing

Finding-ID: AUDIT-20260727-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/package.json:8 (and the absent `engines` field)

`"test": "node --import tsx --test"` passes **no path or pattern**, so Node's test runner falls back to default discovery from cwd. In Node 20 the default discovery patterns only match JavaScript extensions (`**/*.test.?(c|m)js`, `**/test/**/*.?(c|m)js`, etc.); TypeScript extensions were not added to the default glob until the Node 22 line. Every test file in this package is `.ts` (`test/fidelity-pass.test.ts`, `test/pre-checks.test.ts`, …). On Node 20 this command finds zero files, reports `tests 0`, and **exits 0**. Passing a directory (`--test test/`) would not help either — the extension filter still applies to discovered files; only explicitly-enumerated paths bypass it.

The package pins `"@types/node": "^20"` and declares no `engines` field, so nothing in the repo states which runtime this is expected to run under. Blast radius: commit `90ea572` claims a "whole-suite verification gate — tests/typecheck/eslint green (T026)", and `.stack-control` ledger entries record that gate as satisfied. A CI runner or a fresh contributor on Node 20 gets a silently-green `npm test` that executed none of the 20+ RED/GREEN tests this feature's TDD sequence depends on — the exact failure mode where an unattended agent concludes "suite green, proceed" while the fidelity validator is entirely unverified.

Fix: enumerate the files so discovery filtering cannot apply — `"test": "node --import tsx --test test/*.test.ts"` (shell-expanded, works on Node 20+) — **and** add `"engines": { "node": ">=20" }` (or `>=22` if the default-glob behavior is intentionally relied on) so the runtime assumption is declared rather than ambient.

---

### AUDIT-20260727-02 — The bin shims `process.chdir()` into the package root, silently rebasing every relative path the operator passes

Finding-ID: AUDIT-20260727-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/bin/voice-fidelity.mjs:32, voice-tooling/bin/voice-revise.mjs:29-41

Both shims mutate the process's working directory before doing anything else, and never restore it. The in-file justification (voice-fidelity.mjs:25-27) is: *"Safe to do unconditionally: every path this process touches … arrives already resolved to an absolute path, so nothing downstream depends on the inherited cwd."* That claim is asserted, not enforced, and the very same comment block establishes a caller for whom it is false: lines 8-10 advertise that the binary is *"Runnable by hand"* per the contract. An operator running `./voice-tooling/bin/voice-fidelity.mjs --request ./req.json` from the repo root has `./req.json` resolved against `voice-tooling/` — either ENOENT on a file that plainly exists, or, worse, a **silent hit on a different file** if a same-named file exists inside `voice-tooling/`. Any relative `output_dir` in a `BuildRequest` would likewise write the edition into `voice-tooling/` instead of the caller's tree.

Enumerating the channels this opens beyond the one it fixes: the *value* channel — every relative path in argv, in the request JSON, and in any path nested inside a request (artifact, inputs, `output_dir`) is now resolved against a directory the caller never chose; the *state* channel — anything the CLI does with `process.cwd()` for diagnostics or provenance now reports the tool's install location rather than the invocation site; the *composition* channel — a future caller that legitimately spawns with `cwd` set (the comment notes `src/providers/run.ts` currently does not) has that choice silently discarded. None of these has a fixture: no test in the package invokes the shim as a subprocess from a foreign cwd, so the chdir's blast radius is entirely unexercised, and the `.mjs` files are outside both `tsc --noEmit` and (per the package's own scripts) the typecheck surface.

The stated problem — tsx's `register()` resolving the nearest `tsconfig.json` from cwd — has a targeted fix that does not mutate global process state: set the tsconfig explicitly before registering (`process.env['TSX_TSCONFIG_PATH'] = path.join(pkgRoot, 'tsconfig.json')`), or capture `const invocationCwd = process.cwd()` and resolve every incoming relative path against it before use. If `chdir` is kept, the "all paths are absolute" precondition must be *enforced* — refuse a request containing any relative path with a named error — rather than documented.

---

### AUDIT-20260727-03 — `verbatim` destinations donate payload supply to a shared component but never consume any — re-opening the cross-unit false-clean AUDIT-20260726-17 closed

Finding-ID: AUDIT-20260727-03 (claude-01 + claude-02 + codex-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-op-obligations.ts:196-208 (dispatch), :331-372 (`buildComponentRemaining`), :277-322 (`assignComponents`)

`buildComponentRemaining` unions the payloads of **every** non-cut entry's destinations into one `RemainingSupply` per component — the `coverage.forEach` at :341 filters only `entry.op === 'cut'`, so a `verbatim` entry's destination contributes its full payload to the pool. But the dispatch at :196 routes `verbatim` to `checkVerbatim` and *only* the `else` branch calls `checkGroupedSurvival`, so a verbatim entry **consumes nothing** from that pool. The header comment at :86-92 claims "Verbatim (byte-equality) and represented … flow through the SAME grouped path so the invariant is structural" — they do not: verbatim is a net supplier. The multiset invariant AUDIT-17 established ("one destination occurrence can no longer discharge two source obligations") therefore holds only among represented/merged entries and is violated the moment a verbatim destination joins the component.

Reachability is cheap, because component membership is driven purely by shared destination refs (:302-321). Entry A: `op=verbatim`, source S_A → destination D. Entry B: `op=represented` (or `merged`, which *requires* naming a destination another entry names), source S_B → destination D. A and B are unioned into one component; supply = payload(D) = payload(S_A) verbatim. B's obligation is then discharged entirely by bytes that provably came from S_A, and B never has to appear in the edition at all. `lexiconTerms` make this near-certain in practice — a declared lexicon is shared project vocabulary, so any lexicon term in S_B is very likely also present in the verbatim copy of S_A. Quotes and citations shared across two source units (a repeated pull-quote, a repeated `[1]` citation) hit the same hole. The result is a green `op_obligations` check on an edition where a source unit's payload was silently dropped — a false clean on exactly the adversarial guarantee this file exists to provide.

Blast radius: the fidelity verdict is the gate an unattended producer is checked against, so a false clean here means dropped source content ships as "faithful." A reasonable fix is to make verbatim consume what it supplies: after the byte-equality check passes, call `consumeAgainstRemaining(remaining, extractPayload(destContent, lexicon))` (or equivalently `sourcePayload`, since they are byte-equal) so the verbatim destination's occurrences are withdrawn from the component pool before any represented/merged entry can claim them. A fixture is needed for the two-entry shape above (verbatim S_A→D, represented S_B→D, S_B's only payload a lexicon term also present in S_A) asserting a failure.

### AUDIT-20260727-04 — Fixtures the US1 pass test depends on (`faithful-source.md`, `faithful-edition.md`) appear in no chunk of the diff

Finding-ID: AUDIT-20260727-04
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/fidelity-pass.test.ts:16-21, 48-53 (`loadFaithfulFixture`); cross-file: voice-tooling/test/fixtures/sources/, voice-tooling/test/fixtures/editions/, voice-tooling/.gitignore

`loadFaithfulFixture()` reads `readFixture('sources', 'faithful-source.md')` and `readFixture('editions', 'faithful-edition.md')`, and both tests in this file are total losses if those bytes are absent. The diff's own chunk manifest lists `voice-tooling/test/fixtures/.gitkeep`, `fixtures/editions/.gitkeep`, `fixtures/sources/.gitkeep`, and `fixtures/voices/.gitkeep` (chunk `494bf79418727dbc`) — i.e. the chunker did include zero-byte placeholder files — but **no chunk lists `faithful-source.md` or `faithful-edition.md`**, nor any fixture for `golden-markdown.test.ts` (chunk `6c9e0010785d9e83`). A `voice-tooling/.gitignore` is added in chunk `ac767d83a6b91407`, which is a plausible mechanism for fixtures being present on the author's disk but untracked; commit `5101c46` ("track fixtures .gitattributes…") suggests fixture tracking was already once a problem here.

If the fixtures are untracked, the consequence is not a subtle one: `voice-tooling`'s US1 test file cannot load on any fresh clone or CI runner, and the T026 "whole-suite verification gate — tests/typecheck/eslint green" claim in commit `90ea572` is green only against a dirty working tree. That is the worst failure mode for a validator package whose entire value proposition is deterministic reproducibility. Blast radius: an adopter or CI cloning the repo gets a hard failure on the flagship US1 test, and the fidelity validator's headline guarantee is unverified in the shipped artifact.

I could not run `git ls-files` to confirm. Verification is one command: `git ls-files voice-tooling/test/fixtures` — if `faithful-source.md`/`faithful-edition.md` are absent, `git check-ignore -v voice-tooling/test/fixtures/sources/faithful-source.md` names the offending rule, and the fix is to narrow the ignore rule and commit the fixtures.

### AUDIT-20260727-05 — The shape-guard tests never cover `JSON.parse` results that are `null`, an array, or a scalar — `typeof null === 'object'` re-opens the exact TypeError class the fix closed

Finding-ID: AUDIT-20260727-05
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/fidelity-cli.test.ts:36-103 (all three test cases)

All three cases feed the bin a JSON **object**: `{}`, an object missing `inputs`, and an object with `artefact` misspelled. The fix under audit added a shape guard in front of `request.inputs['source']` / `request.artifact.path`. Channel-enumeration on that guard: the *value* channel it must cover is everything `JSON.parse` can return, not just records — `null`, `[]`, `5`, `"string"`, `true`. The dangerous member is `null`: the idiomatic guard `typeof parsed !== 'object'` lets `null` straight through, and `parsed.version` then throws `TypeError: Cannot read properties of null (reading 'version')` — byte-for-byte the failure signature AUDIT-20260726-21 was opened to eliminate, complete with the raw stack trace and empty stdout. The array case is the mirror image: `[]` is a record by `typeof`, so a guard that only checks `typeof` accepts it and every field lookup silently yields `undefined`, potentially producing a *named* refusal for the wrong reason or, worse, sliding past a guard that treats `undefined` as "not present, use default."

There is a `voice-tooling/src/util/is-record.ts` in chunk `fdbfd5eb97ea6889`, which suggests the implementation may well handle `null` correctly — but nothing in this file, which explicitly claims to be the process-boundary regression test for this bug class, pins it. A guard is only as good as its fixtures, and the one input most likely to defeat a hand-rolled guard is the one input not tested.

Blast radius: `pc validate` (or any orchestrator) handing the bin a `null` body — trivially producible by a caller that serializes an absent request — gets an uncaught crash instead of a named refusal, i.e. the finding regresses in production while the regression test stays green. Fix: add cases for `null`, `[]`, `42`, and `"just a string"` to `runFidelityBin`, each asserting the same named-refusal / no-`TypeError` pair.

### AUDIT-20260727-06 — Fact 2 never exercises a producer VERSION CHANGE — it fabricates cross-target inconsistency, leaving the actual FR-027 upgrade scenario unobserved

Finding-ID: AUDIT-20260727-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-freshness.test.ts:227-318 (the `driftEpisode` / `T023 fact 2` block), plus the file docstring at :45-55

The docstring at :45-55 asserts the mechanism under test is `producerDriftFor`, which "reports drift by comparing `producer.tool`/`producer.version` ACROSS every artifact already recorded in one ledger." The test then satisfies that precondition artificially: it stands up a *second, independent target* (`'edition-drift'`, :253-256) built by an impostor script that self-reports `tool: { name: 'voice-revise', version: '0.0.0-t023-drift-probe' }` (:220). Two artifacts, one ledger, two versions → drift. That is a valid exercise of `producerDriftFor`, but it is *not* the scenario the test's own heading claims ("a producer/tool VERSION change is reported as DRIFT"). No version ever changes in this test. Nothing is upgraded and nothing is re-observed against a newer tool.

The operator scenario FR-027/US3-scenario-2 actually describes is: `voice-revise` is upgraded, the operator runs `pc status`, and the existing edition reports drift rather than stale. On the intra-ledger comparison mechanism this test documents, that scenario produces **no signal at all** — a ledger containing one edition built by one tool at one recorded version has nothing to compare against, and the currently-installed tool version is never consulted. Note that this is exactly the shape of `singleTargetEpisode` (:73-92), the flagship single-target profile Fact 1 uses: for that episode, a tool upgrade is neither `stale` (no input moved) nor `drift` (no sibling artifact) — it is invisible. Drift only appears in the transient window where the operator has rebuilt *some* targets against a new version and not others.

Blast radius: this test is the artifact a downstream reader (human or an unattended agent extending the feature) will cite as evidence that FR-027/D18 is discharged by reuse, with the docstring explicitly arguing "no `src/` change" is needed. Acting on that as written, an agent will not build the missing surface — comparing the recorded producer version against the *currently resolvable* tool version — and provenance staleness after a real upgrade ships silently unreported. A reasonable fix: either (a) add a fact that bumps the tool version between two builds of the *same* target and asserts the reported state, or (b) if intra-ledger-only comparison is the deliberate v1 boundary, state that boundary in the docstring as an invariant plus its in-scope exception ("drift is a cross-artifact ledger property; a whole-episode rebuild at a new version is indistinguishable from never having upgraded, and that is accepted because…") rather than letting the heading claim the broader guarantee.
```

```

### AUDIT-20260727-07 — The "model-version change" half of US3 scenario 2 is asserted only in prose — the model is never varied, and no assertion ties model identity to `producer`

Finding-ID: AUDIT-20260727-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-freshness.test.ts:62 (`BUILD_ENV`), :186-231 (`driftProviderSource`), :265-318

T023's stated contract (commit 8e44180: "voice-edit restales edition (report-only), **model-version change is drift not stale**") has two halves. The model is injected into every real build through `VOICE_REVISE_MODEL: \`node ${STUB_MODEL}\`` at :62 — that env var is the only model lever the fixture has. The test never changes it. Not one assertion in the file reads a model name or model version out of `producer`, and `BuildProducerJsonSchema` (:243-245) validates exactly two fields, `producer.tool` and `producer.version`, both of which describe the *wrapper binary*, not the model that produced the prose.

So the "model-version change" fact is discharged by substituting a stand-in provider that lies about being `voice-revise` at a different *tool* version (:220), and by a docstring that asserts the equivalence ("the SAME tool name the real `voice-revise` binary reports … the only lever this file needs to create genuine producer drift"). The equivalence is the load-bearing claim and it is untested: if `producer` carries no model identity, then swapping `VOICE_REVISE_MODEL` from one model to another produces an edition with byte-different content, identical declared input hashes, and an identical `producer` record — reported as `fresh`, with no drift. The test's structure actively conceals that, because it routes around the model lever entirely.

Blast radius: an operator or agent reading this file concludes the model-provenance half of FR-027 is covered and ships. In practice the highest-value provenance fact in the whole feature — *which model wrote this edition* — is unrecorded and therefore undetectable when it changes, and an edition produced by an entirely different model reads as fresh and in-provenance. Fix: assert what `producer` actually contains for a real `voice-revise` build, and add a fact that changes `VOICE_REVISE_MODEL` between two builds and pins the resulting reported state — whichever state the design intends. If model identity is genuinely out of scope for the recorded producer in v1, the docstring must say so explicitly instead of naming the fact "model-version change."
```

```

### AUDIT-20260727-08 — Lexicon test asserts only the boolean flag over a fixture that must FAIL the lexicon obligation

Finding-ID: AUDIT-20260727-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/op-obligations.test.ts:130-135 (and the fixtures at :36-62)

The only lexicon-aware test in the file is:

```ts
const result = checkOpObligations(faithfulLedger(src, ed), src, ed, ['Gamma']);
assert.equal(result.lexiconApplicable, true);
```

It asserts nothing about `result.ok`, `result.failures`, or `result.payloadChecked.lexiconTerms`. That matters because the fixture it feeds is *not* lexicon-faithful: `FAITHFUL_SOURCE` carries `Gamma` with a capital G in two source units (`'Gamma one with 42.'`, `'Gamma two cites [^c].'`, :43/:45), while the declared merged destination in `FAITHFUL_EDITION` reads `'Merged gamma line with 42 and [^c].'` — lowercase (:56). `payload-extract.test.ts:59-62` pins lexicon matching as byte-exact and case-sensitive (`"Bridge"` does NOT match `"bridge"`, per R4/D11). So with lexicon `['Gamma']` the source supplies two `Gamma` obligations and the declared destinations supply zero. If lexicon terms are genuinely part of the per-op obligation (FR-020 lists them as payload, and `payloadChecked.lexiconTerms` is a reported field), this call must produce two lexicon shortfalls and `ok === false` — and the test silently swallows that.

Both horns are defects. If the validator *does* enforce lexicon obligations, this test is quietly exercising a failing set while its name ("a lexicon makes `lexiconApplicable` true") reads as a happy-path assertion — the next person to touch the fixture will trust it. If the validator does *not* enforce them, the entire lexicon channel is a no-op and the whole suite stays green: no test anywhere in this chunk asserts that a dropped lexicon term produces a failure, and no test asserts a non-zero `payloadChecked.lexiconTerms`. Blast radius: a producer can drop every declared house term from an edition and the fidelity verdict still reads pass — precisely the false-clean this validator exists to prevent. The test also cannot distinguish the two plausible readings of `lexiconApplicable` ("a lexicon was declared" vs. "lexicon terms were actually found in the source"), since `Gamma` is present in the source under both. Fix: assert the full result of this call (expected failures with `kind: 'lexicon'`, per-unit attribution, `ok === false`, `payloadChecked.lexiconTerms === 2`), and add a separate genuinely-faithful lexicon fixture whose destination preserves the term byte-exactly, asserting `ok === true` with a non-zero `lexiconTerms` count.

### AUDIT-20260727-09 — Lexicon applicability test passes on a lexicon-survival failure

Finding-ID: AUDIT-20260727-09
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/op-obligations.test.ts:124-128

The test named `checkOpObligations: a lexicon makes lexiconApplicable true` only asserts `result.lexiconApplicable === true`, but it reuses the “faithful” fixture where the declared lexicon term does not actually survive byte-exactly. The source has `Gamma` in two units at lines 43 and 45, while the merged edition destination has lowercase `gamma` at line 59; `payload-extract.test.ts:68-70` explicitly pins lexicon matching as case-sensitive.

That means this test is green whether lexicon survival is correctly enforced or completely broken. The blast radius is high because declared lexicon terms are part of the fidelity payload when a lexicon exists; a downstream consumer could see the validator marked applicable and assume the voice-specific payload was corroborated. A reasonable fix is to split this into a negative assertion for the current fixture, expecting lexicon shortfall failures, plus a separate positive fixture where `Gamma` survives case-exactly and `result.ok` remains true.

### AUDIT-20260727-10 — `unitId` test set is fully satisfied by an implementation that ignores `content_hash`, so a colliding durable identity would ship green

Finding-ID: AUDIT-20260727-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units-identity.test.ts:75-124 (with voice-tooling/test/source-units-edition.test.ts:55-59)

Every `unitId` assertion in the suite varies exactly one of `sourceId` or `occurrenceIndex` and holds the other two components fixed. Test at :75 varies only the source (`'source-alpha'` vs `'source-beta'`, with `contentHash` and `occurrenceIndex` asserted equal at :86-88). Test at :101 varies only `occurrenceIndex` (`first` vs `third`, whose `contentHash` is asserted *equal* at :108). The edition test at :55 asserts equality for inputs that are equal in all three components. Nothing anywhere asserts that two units differing **only** in `contentHash` get different ids. Consequently `unitId = (src, u) => \`${src}:${u.occurrenceIndex}\`` passes 100% of this file, plus the edition invariant.

That degenerate implementation is not a strawman-with-no-consequence: because `occurrence_index` is defined as the index *among units sharing a content_hash* (:23-40), every unit with distinct content in a source carries `occurrenceIndex === 0`. Under a hash-blind id, *all* distinct units in a source collapse to the single id `src:0`. The fidelity layer's unit-accounting check — "exactly one disposition per source unit" (commit 9de3b07, T012) — keys off durable identity; a colliding id makes an edition that dispositions one unit look like it dispositioned all of them, i.e. a false PASS on the feature's central guarantee. The suite that exists to pin durable identity would not catch it.

Fix: add one assertion in the `unitId` test — take two same-source units with different `contentHash` and equal `occurrenceIndex` (`repeated-blocks.md` `first` (occ 0, "Repeat me.") vs `second` (occ 0, "Different content.")) and assert their ids differ. That is a two-line addition and closes the only unconstrained component.

---

### AUDIT-20260727-11 — No fixture pins deriveUnits behavior on an unterminated frontmatter block or an empty document — a silent zero-unit result makes unit accounting vacuously pass

Finding-ID: AUDIT-20260727-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units.test.ts:88-116; voice-tooling/test/source-units-invalid.test.ts (whole file)

The frontmatter tests cover exactly two shapes: a well-formed leading block that gets stripped (:88), and a `---` that is not on the first line and is therefore ordinary content (:106). The shape in between — first line is exactly `---` with **no** closing `---` anywhere — is unpinned. The two natural implementations diverge sharply: "scan to the next `---`, and if there is none, treat the whole file as frontmatter" yields **zero units**, while "only strip when a terminator is found" yields the whole document as content. Nothing in this suite says which. The same hole exists for an empty or whitespace-only document; only the edition test ever asserts `units.length > 0` (source-units-edition.test.ts:34), and it does so for a fixture guaranteed to have body content.

The zero-unit branch is the dangerous one because it fails *silently in the passing direction*. A source that derives to zero units makes the T012 unit-accounting check ("exactly one disposition per source unit") trivially satisfied — no units, no unaccounted units — so an edition claiming faithful coverage of a source whose frontmatter delimiter was mistyped would be reported as PASS rather than refused. FR-008's stated contract is "refuse invalid input **before any unit**" and D20 is quoted in source-units-invalid.test.ts:9-10 as "an unreadable or non-UTF-8 source fails before any unit is processed"; a malformed-frontmatter source that produces zero units is precisely the case that contract exists to catch, and it is the one case with no fixture.

Fix: add fixtures + assertions for (a) first line `---` with no closing delimiter, (b) an empty document, (c) a whitespace-only document, and assert the intended outcome explicitly — either a named refusal or a specific unit set. Whichever way the design record resolves it, a zero-unit derivation should be a refusal at the fidelity boundary rather than a vacuous pass, and this suite is where that gets nailed down.

---

### AUDIT-20260727-12 — `unit_accounting` has no test for the double-disposition case — the "exactly once" half of its own stated invariant

Finding-ID: AUDIT-20260727-12 (claude-01 + claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/test/unit-accounting.test.ts:1-120

The file's own docblock (lines 1-11) and the T012 commit subject both state the contract as **"exactly one disposition per source unit"** (FR-017, SC-001). The four tests cover: all units accounted once → `ok` (34-49); one unit *omitted* → failure (51-74); an entry referencing a *non-existent* unit → failure (76-101); prefix normalization (103-120). There is no test in which **two coverage entries reference the same `(hash, occurrence)` pair**. That is precisely the case that separates "at least one disposition" from "exactly one," and it is the only one of the four possible cardinalities (0, 1, 2+, unknown) left unfixtured.

The blast radius is that the check's headline guarantee is unenforced by the suite. The most natural implementation of the two behaviors that *are* tested is a `Set` of covered unit keys plus a reverse membership scan — and that implementation passes all four tests while accepting a ledger that disposes the same source unit twice (e.g. once `cut`, once `kept`). A downstream consumer — the `fidelity/run.ts` orchestrator, or an unattended agent trusting the verdict — would then certify an edition whose ledger is internally self-contradictory about what happened to a unit, which is exactly the failure `unit_accounting` exists to catch. The fix is one test: build `coverage` from `units.map(...)`, push a second entry for `units[0]` with a different `op`, and assert `ok === false` with a failure naming that unit as doubly accounted.

Triage note: an untracked backlog file `task-21 - unit-accounting-no-double-disposition-test.md` is present in the working tree, so this may already be captured. I am reporting it anyway because the audit-log excerpt supplied to me was empty and the gap is live in the committed code.

---

### AUDIT-20260727-13 — `voice-tooling` is a standalone npm install root wired into `pc build`, but nothing installs its dependencies on a fresh clone

Finding-ID: AUDIT-20260727-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `voice-tooling/package-lock.json` (new file, this chunk) + `profiles/voice-editions.yaml:19-24`

The profile binds the `edition` target's provider and validator to `node voice-tooling/bin/voice-revise.mjs` and `node voice-tooling/bin/voice-fidelity.mjs` (lines 19-24). Per the ledger, those bins `register()` tsx before importing TypeScript sources (`T019`: "bins chdir into pkg before tsx register()"; `T001`: "node --import tsx --test … node_modules ignored"). That makes `tsx` — and whatever YAML parser `schema/ledger.ts` uses (`T005`: "hand-validation via yaml pkg") — hard runtime dependencies of `pc build`, resolved out of `voice-tooling/node_modules`.

This chunk adds `voice-tooling/package-lock.json` as its own lockfile. npm workspaces hoist to a single root lock and do **not** emit a nested `package-lock.json`, so the presence of this file is strong evidence `voice-tooling` is a standalone install root rather than a root workspace member. Consequently a fresh clone that runs the repo's normal install and then `pc build` on an `edition` target spawns a bin whose `node_modules` does not exist, and fails with a bare `ERR_MODULE_NOT_FOUND: tsx` — from inside a subprocess, surfaced as a provider failure with no hint that the real cause is an uninstalled sibling package. Nothing in this chunk (profile comment, ledger, CI config) declares the extra install step; the profile comment at lines 3-13 discusses resolution risk at length and never mentions that the target it points at needs its own `npm install`.

Blast radius: the feature's single operator-facing entry point is broken on any machine that has not manually installed the sub-package — which is every fresh clone and every CI runner. The failure is late (build time, not install time) and misattributed. A reasonable fix is to make `voice-tooling` a declared root workspace (deleting the nested lock), or to fail loud and early with a named precondition check in the bins ("voice-tooling dependencies not installed; run `npm install` in voice-tooling/") plus a documented install step in the profile comment.

---

### AUDIT-20260727-14 — ESLint ignore for `voice-tooling/` carries a justification comment asserting a typing gate that no gate implements

Finding-ID: AUDIT-20260727-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `eslint.config.mjs:44-51`; corroborating record `.stack-control/execute/voice-editions.ledger.jsonl` (T026)

The new ignore entry excludes the entire `voice-tooling/` tree — the bulk of the feature's new source — from root `eslint .`, and closes with: "(Typing discipline there — no any/as/ts-ignore — is still enforced, see voice-tooling verification.)" That parenthetical is false as written. The package's declared gates are `node --test` + `tsc --noEmit` (ledger T001/T026). `tsc` under `strict` does not reject `any`, does not reject `as` casts, and treats `@ts-ignore` as a silent suppression — the three things the comment claims are "still enforced" are precisely the three `tsc` cannot see. What actually happened is a one-time manual sweep at T026 ("21 real violations fixed, 14 as-casts removed via new isRecord util, 0 any/as/@ts-ignore"), i.e. a point-in-time audit, not an enforcement mechanism. There is no `voice-tooling/eslint.config.*` in this chunk's file list to supply one.

This is the load-bearing part: a checked-in config comment is the artifact a future contributor (or an unattended agent) reads to decide whether a gate covers them. Read as written, it says "adding `as any` here will be caught." It will not be — the sweep's result decays from the first commit after T026, silently, with green CI. The same substitution shows up in the ledger's final gate entry, which records "whole-suite gate GREEN" for a run whose eslint leg was made green in part by removing this package from it ("eslint fixed (voice-tooling ignored-no-config …)"); "whole-suite" is no longer an accurate description of that gate's scope.

Blast radius: ~2.5k lines of new source permanently outside the repo's lint gate, with an in-repo claim that they are not. Rating this `high` rather than `blocking` because nothing breaks at runtime today — the cost is a gate hole that widens invisibly. Minimal honest fix: either add a `voice-tooling/eslint.config.mjs` with `@typescript-eslint/no-explicit-any` + `ban-ts-comment` and wire it into the package's gate command, or correct the comment to state plainly that typing discipline there is **unenforced** and was last verified manually at a named commit.

---

### AUDIT-20260727-15 — Model stdout is silently truncated at 32 MiB and the truncated text is returned as the edition

Finding-ID: AUDIT-20260727-15 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/revise/model.ts:63, 86-91, 122

`invokeModel` counts bytes and *drops* every chunk past the cap, but never records that it did:

```ts
child.stdout.on('data', (chunk: Buffer) => {
  outputBytes += chunk.length;
  if (outputBytes <= MAX_OUTPUT_BYTES) { stdoutChunks.push(chunk); }
});
```

There is no post-loop check of `outputBytes > MAX_OUTPUT_BYTES`, so a model that emits more than 32 MiB exits 0, passes the `stdout.trim().length === 0` guard at line 113, and `resolve(stdout)` at line 122 hands back a text that is missing its tail. `emitEdition` then writes that truncated markdown to `<target>.md` and the CLI prints a *success* `BuildResponse`. The module's own docblock promises the opposite: "never returns fabricated or partial output" (lines 73-74).

Blast radius: a truncated edition is a *quietly wrong* artifact, not a loud failure. The paired `voice fidelity` validator will refuse it for missing payload — but the operator's diagnosis surface says "source content dropped by the model," not "the tool cut it off," and on a chunk boundary the truncation can land mid-`ledger:` block, producing an unparseable file with a green provider exit. Fix: track a `truncated` flag and `reject` naming the cap and the observed byte count. The cap is also a magic number with no fixture exercising it — the value channel it opens (any output at or over the cap) has no test.

### AUDIT-20260727-16 — `target` is interpolated straight into a filesystem path with no validation in the emit layer

Finding-ID: AUDIT-20260727-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/emit.ts:46-47 (with voice-tooling/src/revise/request.ts, not in this chunk)

```ts
const outputPath = `${target}.md`;
const fullPath = path.join(outputDir, outputPath);
```

`emitEdition` treats `target` as a bare filename stem, but performs no check that it is one. `path.join('/x/.ai', '../../secrets.md')` normalizes out of `outputDir` without error, and the returned `BuildResponse.outputs[0].path` would then carry a `..`-relative path that the runner records as a declared output. Nothing in this chunk constrains `target` to `[A-Za-z0-9._-]+`; the only guard would be in `parseReviseRequest` (chunk `713190d5`), which this module does not depend on by type.

This matters more than a generic traversal note because FR-028/029 — voice editions *confined to `.ai/`* — is a headline invariant of this feature, and `mkdir(outputDir, {recursive: true})` at line 50 means a `target` containing a separator (`sub/edition`) fails with ENOENT rather than being refused by name, while `../x` succeeds and escapes the zone. Blast radius: an unattended build driven by a profile/manifest whose `target` is operator- or template-derived can write outside the content zone with a success exit, defeating the zoning audit that runs *pre-build*. Fix: validate `target` in `emitEdition` itself (refuse anything containing `/`, `\`, or a leading `.`), and assert `path.resolve(fullPath).startsWith(path.resolve(outputDir) + path.sep)` before writing. Add a fixture for `target: '../escape'`.

### AUDIT-20260727-17 — The expensive impure model call runs before the cheap `readPackageVersion` precondition it depends on

Finding-ID: AUDIT-20260727-17 (claude-08 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=low, codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/revise/cli.ts:88-103

`runReviseCli` spawns the model at line 88 and only afterwards, at line 102, calls `readPackageVersion()` — which throws on an unreadable or version-less `package.json` (lines 46, 50, 54). A broken install therefore burns the full model invocation (billable, non-deterministic, potentially minutes) and then discards its output with a refusal that had nothing to do with the model. `resolveModelCommand` is correctly hoisted above the spawn at line 85; `readPackageVersion` should sit beside it.

Blast radius: no incorrect artifact is produced — the run fails loud either way — so this is cost and diagnosis-clarity, not correctness. Fix: move `const toolVersion = readPackageVersion();` above the `invokeModel` await so every cheap, deterministic precondition is discharged before the one irreversible side-effecting step. (Minor related hygiene at line 48: `JSON.parse(raw)` is outside the `try`, so a malformed `package.json` surfaces a bare `SyntaxError` that does not name `pkgPath`, unlike every other refusal in this file.)

### AUDIT-20260727-18 — `runFidelity` computes the verdict from `checks` alone, so any op-obligation failure whose kind isn't bucketed into one of the four named checks yields `passed: true` with a non-empty `failures[]`

Finding-ID: AUDIT-20260727-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/fidelity/run.ts:~262-283 (`failures.push(...opResult.failures.map((f) => f.message));` … `classifyOpFailures`), and voice-tooling/src/fidelity/run.ts:~350-368 (`finalize`)

`runFidelity` unconditionally folds every op-obligation failure message into the local `failures` array (`failures.push(...opResult.failures.map((f) => f.message));`), and then, separately, derives which *named checks* to mark failed from `classifyOpFailures(opResult.failures)` plus `findUnresolvedDestinationChecks(...)`. The verdict is then computed from the check map only — `const verdict = computeVerdict({ checks });` in `finalize` — and `finalize` never looks at the `failures` array it was handed. The two data paths are therefore allowed to disagree: if a structured failure kind is emitted by `checkOpObligations` that `classifyOpFailures` does not map into `verbatim_quotes` / `citations` / `numeric_literals` / `lexicon` (a new kind, a renamed kind, a kind that is legitimately none of the four, or an entry whose destination classification returns an empty set), the run returns `{ report: { verdict: 'passed' }, passed: true, failures: ['<the violation>'] }`.

Blast radius: this is a silent false clean bill of fidelity — precisely the outcome the whole feature exists to prevent. A downstream consumer (the `voice-fidelity` CLI, a gate, or an unattended agent) reads `passed` / `report.verdict` and ships an edition that violates a declared obligation, with the evidence sitting unread in a sibling field. It is also a fix-induced channel: AUDIT-20260726-23 replaced regex-over-message bucketing with structured-kind bucketing, which is strictly better, but it made the mapping *closed* — an unmapped kind now falls through silently instead of matching a broad regex. The fix moved the failure mode rather than removing it.

A reasonable fix is a fail-loud invariant in `finalize`: when `verdict === 'passed'` and `failures.length > 0`, that is a defect in the orchestrator's own classification, not a pass — throw (or mark a named check failed with the unclassified messages). Per the project's no-fallbacks rule, an unclassifiable failure must surface as an error, never as a pass. A fixture that feeds `checkOpObligations` a failure kind outside the four buckets and asserts a non-pass would pin it.
```

```

### AUDIT-20260727-19 — Empty lexicon terms can still escape as uncaught exceptions

Finding-ID: AUDIT-20260727-19
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:228, voice-tooling/src/payload/extract.ts:131-135

`extractPayload` throws when any declared lexicon term is the empty string, but `runFidelity` calls `checkOpObligations` without a guard at line 228. That path extracts source and destination payloads using the supplied `input.lexicon`, so a malformed-but-type-valid lexicon like `['']` escapes the orchestrator instead of producing a structured refusal/cannot-decide result. The blast radius is high because the feature explicitly distinguishes validator refusals from thrown crashes, and a downstream CLI/API caller can hit this with a blank lexicon item.

A reasonable correction is to validate `input.lexicon` at the `runFidelity` boundary or catch payload-extraction failures around the op-obligation phase and return a named non-passing result.

### AUDIT-20260727-20 — Golden suite reads eight `sources/` fixtures that appear nowhere in the diff — the fixture dir ships as `.gitkeep` only

Finding-ID: AUDIT-20260727-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/golden-markdown.test.ts:27,~47,~76,~95,~114,~133,~163,~205 (every `readFixture('sources', …)` call site)

Every one of the eight tests in this file loads a fixture off disk: `setext-heading.md`, `setext-with-hyphens.md`, `mdx-import.md`, `mdx-export.md`, `jsx-component.md`, `html-block.md`, `html-with-blank-lines.md`, `loose-list.md`. None of those eight files appears in this chunk's diff, and none appears in any of the 22 sibling chunks' file lists. What *does* appear in the sibling lists is `voice-tooling/test/fixtures/sources/.gitkeep` (chunk `494bf79418727dbc`) plus `voice-tooling/.gitignore` (chunk `ac767d83a6b91407`). A `.gitkeep` is only needed for a directory git would otherwise not track — i.e. an empty one — and a `.gitignore` in the package is the mechanism by which generated fixture bytes would be excluded. The commit that introduced this file is titled "golden **fixtures** pinning deriveUnits behavior" (7907707), so the fixtures were understood to be part of the deliverable.

That leaves two possible states, and both are defects. (a) The fixture bytes are untracked/ignored: T024's entire golden corpus fails on a fresh clone and in CI with a file-not-found from `readFixture`, and the "verified green" claim in 90ea572 was made against a working tree that had local, unshared files. (b) The fixtures are materialized at runtime by some other test module (a `writeFixture` in `support.ts`): then `golden-markdown.test.ts` reads bytes it never writes, which makes it order-dependent under `node:test`'s per-file isolation and silently passes or fails depending on which files ran first — the classic shape of a test that pins nothing.

Blast radius: the surface being pinned (`deriveUnits`, D6 byte-exact unit derivation) is the foundation of the whole fidelity validator — unit accounting, payload multiset matching, and citation checks all key off unit content and `contentHash`. If this golden corpus is not actually executing in CI, the one artifact that would catch a silent change in separator handling is inert while reporting green. A reasonable fix: commit the eight fixture files as tracked bytes under `voice-tooling/test/fixtures/sources/` (they must be tracked with the EOL-normalization-disabling `.gitattributes` already added in 5101c46, since these goldens assert exact `\n` terminators), delete the now-unneeded `.gitkeep`, and confirm `voice-tooling/.gitignore` does not shadow the fixtures path. If instead the fixtures are meant to be generated, the generation must happen inside this file (or a shared `before` hook it owns), not in a sibling test module.

### AUDIT-20260727-21 — Contract-permitted third input (lexicon / quote-bank) is refused, and the refusal misdiagnoses it as a duplicate source draft

Finding-ID: AUDIT-20260727-21
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/request.ts:~19-25 (doc comment), ~145-152 (`otherEntries.length > 1` refusal)

The file's own header comment concedes the gap: *"Exactly two inputs is the v1 shape (an optional `lexicon`/`quote-bank` input may also appear per the contract, but the fixture wiring T019 targets never declares one)"*. But the code does not treat that acknowledged third input as a distinct role — it falls into `otherEntries` (it will not parse as a voice document), and the very next guard fires:

```ts
fail(
  `target ${target}: expected exactly one source draft input, found ${otherEntries.length} ` +
    `(${otherEntries.map((e) => e.identity).join(', ')}) — voice revise cannot tell which one is the source draft`,
);
```

So a profile that declares the contract-legal `{draft, voice, quote-bank}` shape does not merely fail — it fails *with the wrong diagnosis*, telling the operator the request has two source drafts and implicating FR-007/D5's single-source rule, which is not what went wrong. Blast radius: an operator (or an unattended agent) wiring up the FR-024 quote-bank conditional gets a refusal that points at the wrong invariant, and the natural "fix" is to delete a legitimate input. The single-source constraint (T020) and "input the parser has no role for" are different failures and must be named differently. A reasonable fix is a third discrimination arm — either a positive type test for the lexicon/quote-bank shape, or an explicit `fail` naming *unrecognized input role* when a non-voice, non-source input is present — plus a fixture for the three-input request, which the diff has none of.

---

### AUDIT-20260727-22 — SC-004's "applicable but unrun" invariant is asserted in prose but pinned nowhere — `not-run` is unconditionally non-blocking, so the AUDIT-13/-16 required-key guard is satisfied by emitting `not-run`

Finding-ID: AUDIT-20260727-22
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/report-types.test.ts:31 (`fullChecks` lexicon entry), ~205-222 (`verdict-invariant (AUDIT-14): a not-run (inapplicable) NEVER blocks…`), ~326-352 (`sc-004-invariant`)

The `sc-004-invariant` doc comment states the contract as "a `passed` top-level verdict never appears alongside an unrun **applicable** obligation," and the AUDIT-13/-16 fix makes `computeVerdict` refuse a verdict unless every `REQUIRED_CHECKS` key is **present**. But the only other tested rule is that `not-run` *never* blocks — the test explicitly named "a `not-run` (inapplicable) NEVER blocks, even with an 'aborted'-sounding reason string" pins that `computeVerdict` does not and cannot distinguish an inapplicable `not-run` from an applicable one. Presence is therefore trivially satisfiable: an orchestrator that emits `lexicon: notRun('…')` **while a lexicon is in fact declared** produces a full required set with zero blocking states, and `computeVerdict` returns `passed`. That is precisely the false-pass class AUDIT-13/-16 was filed against, just relocated from "key absent" to "key present but hollow."

This is the round-0 self-red-team channel the fix opened: the guard moved the failure from the *absence* channel to the *state* channel, and the state channel has no fixture. The evidence is entirely inside this file — `fullChecks()` hardcodes `lexicon: notRun('no lexicon declared')` (line ~31) and every "→ passed" test inherits it, so nothing in the suite ever pairs a declared lexicon with a `not-run` lexicon check.

Blast radius: a downstream consumer (the `voice fidelity` gate, or an unattended agent reading the report) treats `verdict: passed` as "every applicable obligation ran and passed." A single orchestrator bug or a check behind a false condition emits `not-run` instead of running, and the edition ships with a green verdict. A reasonable fix is a fixture at the report layer asserting that `notRun` requires an applicability discriminator (e.g. a `not-run` whose reason names an *applicable* input is rejected or blocks), plus an orchestrator-level test that a declared lexicon can never yield `lexicon: not-run`.

---

### AUDIT-20260727-23 — The missing-required-key regression guard is exercised on only 2 of the 10 required checks, so a guard implemented over an incomplete key list still passes green

Finding-ID: AUDIT-20260727-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=reachable, fix-debt=no; reachable, high blast radius — NOT calibrated down (real signal preserved, SC-003).
Surface:    voice-tooling/test/report-types.test.ts:~186-203 (`verdict-invariant (AUDIT-13/-16)…`), ~344-351 (tail of `sc-004-invariant`)

The regression guard for the AUDIT-13/-16 fix deletes exactly two keys across the whole file: `unit_accounting` (in the dedicated regression test, twice — once by deletion, once by typo) and `citations` (in `sc-004-invariant`). The other eight required obligations — `source_hash`, `ledger_structure`, `verbatim_quotes`, `numeric_literals`, `lexicon`, `uncorroborated_units`, `semantic_claim_fidelity`, `voice_conformance` — are never individually dropped. If `computeVerdict`'s presence check is implemented against a hand-maintained list that omits one of those eight (a plausible way to write it, and the exact class of typo the test itself acknowledges by adding the `unitAccounting` case), the whole suite stays green while the false-pass the fix targets remains reachable for eight of ten checks.

The file also never asserts that its own `fullChecks()` vocabulary is the same set as the implementation's `REQUIRED_CHECKS`, so the test's notion of "the full required set" and the validator's can diverge in the direction of the test being a superset without any failure.

Blast radius: this is the sole regression guard for a fix that exists to stop a silently-passing verdict. Partial coverage of a guard against silent passes is itself a silent pass. Fix: drive the deletion test from the exported `REQUIRED_CHECKS` list — `for (const key of REQUIRED_CHECKS) { const c = fullChecks(); delete c[key]; assert.equal(computeVerdict({checks: c}), undefined, key) }` — which both closes the eight-key hole and makes vocabulary drift loud.

---

### AUDIT-20260727-24 — `target` is read off the wire and flows into the emitted filename with no refusal fixture — the value channel of an attacker/agent-controlled string is unaudited

Finding-ID: AUDIT-20260727-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise.test.ts:~96 (`assert.equal(parsed.target, 'edition')`), ~234-236 (`emitEdition(dir, 'edition', editionText, '0.1.0')` → `outputs: [{ path: 'edition.md' }]`)

`parseReviseRequest` accepts `target` from the request wire (the test only asserts it round-trips as `'edition'`), and `emitEdition`'s second parameter is that same target, which the test shows becomes the output filename (`'edition'` → `edition.md`, written at `path.join(dir, 'edition.md')`). The file validates `version` to the literal `1` — there is a dedicated refusal test for that — but there is no fixture anywhere in the diff showing that a `target` other than `'edition'` is refused, nor that a `target` containing a path separator or `..` is refused. If `target` is unconstrained, a request declaring `target: '../../../etc/whatever'` (or any non-`edition` value) writes outside `output_dir`, defeating the FR-028/029 confinement of voice editions to `.ai/` that the sibling integration test claims to enforce — because that integration test presumably supplies a well-formed `output_dir`, not a hostile `target`.

This is the channel-enumeration driver applied to the parse surface: the request grammar added a `target` field, and only its one happy value has a fixture. The state channel (what other targets are reachable) and the composition channel (target joined onto `output_dir`) are both unfixtured.

Blast radius: arbitrary file write outside the `.ai/` zone driven by a JSON field, in a tool whose entire premise is zone confinement plus auditability. Minimum fix: a refusal test asserting `parseReviseRequest` names the cause for any `target !== 'edition'` in v1, and an `emitEdition` test asserting a target containing `/`, `\`, or `..` is refused rather than resolved.

---

### AUDIT-20260727-25 — The declared-hash verification fix has exactly one fixture (source, wrong hex) — absent, malformed, and voice-input hash channels are all unfixtured

Finding-ID: AUDIT-20260727-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=reachable, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/revise.test.ts:~192-229 (`parseReviseRequest (AUDIT-20260726-12)…`)

The AUDIT-12 fix adds hash verification of every declared input against bytes on disk. The regression test covers exactly one shape: a well-formed-but-wrong `sha256:` + 64 hex chars on the **source** input. Every other reachable input to the new verification code is unfixtured:

- **Absent** — an input entry with no `hash` key at all. This is the single most likely real-world input (any emitter written before the fix, or any hand-authored request), and if the verifier skips inputs lacking a hash, the fix is defeated by omission rather than by tampering.
- **Malformed** — a bare hex digest with no `sha256:` prefix, an uppercase-hex digest (a correct digest in the wrong case would compare unequal and refuse a *valid* input), a wrong-length digest, an empty string, a non-string value.
- **Wrong input position** — a mismatched hash on the **voice** input. Discrimination is by `loadVoice`-acceptance, so if hash verification runs after (or only on) source discrimination, a tampered voice document is never checked; the two failure orders are indistinguishable from the fixtures present.

Blast radius: this fix exists to make declared provenance trustworthy — the ledger's whole value is that the bytes hashed are the bytes used. A silent skip on the absent-hash path means every legacy request passes verification while appearing verified, which is worse than no verification because the report now attests to it. Add one fixture per channel above; the uppercase-hex and voice-side cases in particular have opposite failure modes (false refusal vs. false accept) and both need pinning.

---

### AUDIT-20260727-26 — The accepting-path fixture names its inputs `source`/`voice`, so the type-based discriminator the file exists to lock down is never actually exercised

Finding-ID: AUDIT-20260727-26
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/one-source.test.ts:60-80 (esp. 69-71, 77-78)

The header of this file (lines 3-5) states the load-bearing mechanism precisely: `parseReviseRequest` "discriminates source vs. voice by TYPE (whatever `loadVoice` accepts is the voice; the request's one remaining non-voice input is the source)". That type-discrimination is the *only* reason "exactly one source" can be enforced at all, and it is the thing T020 claims to lock down. But the one accepting-path test — case (a), lines 60-80 — declares its inputs under the keys `source:` and `voice:` (lines 70-71) and then asserts `parsed.source.identity === 'source'` and `parsed.voice.identity === 'voice'` (lines 77-78). Those assertions are satisfied identically by a *name-based* implementation that simply reads `inputs.source` and `inputs.voice`. Nothing in this file — or, per its own header, in the sibling `revise.test.ts`, which covers only the zero-source and zero/multi-voice refusals — ever presents a voice input under a key other than `voice` on a path that is expected to succeed. Cases (b) and (c) use off-name keys only for *sources*, and only in refusal paths where the count is already wrong.

Blast radius: if `parseReviseRequest` is ever refactored to key off input names (or was written that way and the type-dispatch comment is aspirational), the entire T020 regression stays green while a real operator request such as `inputs: { draft: <md>, style-guide: <voice.yaml> }` is either refused as "two source drafts" or, worse, silently classes the voice YAML as the source draft and feeds a style guide to the model as the text to revise. The green suite would assert the opposite of what happened. The same fixture gap also leaves `identity` derivation unpinned: `source.identity` flows into the coverage ledger's `source.identity` field that the fidelity validator later reconciles, and no test here shows what identity a non-canonically-named input receives.

A reasonable fix is to rename the keys in case (a) to something role-neutral (`draft` and `style`), assert the resulting identities are `draft`/`style`, and add a case where the *voice* is declared under a non-`voice` key and is still correctly classed as the voice. That is a two-line fixture change that converts an echo-assertion into an actual discriminator test. (Distinct from the already-captured backlog item on a malformed lexicon input being misdiagnosed as a source — that is about a voice that fails `loadVoice`; this is about a well-formed voice under an unexpected key.)

---

### AUDIT-20260727-27 — Declared input hashes in the `ValidateRequest` are shape-checked but never verified against the bytes actually read

Finding-ID: AUDIT-20260727-27 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:41-49, 155-184, 191-198

`WireBuildInput.hash` is validated only for *presence and non-emptiness* (`typeof value['hash'] === 'string' && value['hash'].trim().length > 0`, lines 46-47). After that, `hash` is never read again anywhere in `runFidelityCli`: the CLI does `fs.readFileSync(sourceInput.path)` (164), `fs.readFileSync(request.artifact.path)` (165), and `fs.readFileSync(lexiconInput.path)` (177), and then builds `FidelityInput` (191-198) whose fields are `source`, `sourceIdentity`, `edition`, `quoteBankDeclared`, `lexicon` — *no hash field at all*. So the declared hashes cannot be verified downstream in `run.ts` either; they are structurally unable to reach it. The audited range's own commit subject claims "verify declared input hashes" (c95f991), which makes this gap easy to mistake for covered.

The sharp case is `artifact.hash`. The build system declares "I intend to publish the edition whose bytes hash to H"; the validator then validates *whatever is at `artifact.path` right now*, which after a concurrent rebuild, a stale working tree, or a wrong path in a generated request is a different document than the one the verdict will be attached to. `source.hash` is partly protected by accident — `runFidelity` compares source bytes against the *ledger's* `source.hash` — but that is a different declaration (authored by the edition builder) than the request's, so agreement between the two is never asserted. `lexicon.hash` has no compensating check anywhere: a lexicon file mutated after the build hashed it silently changes which terms the `lexicon` obligation enforces, and the report still says `passed`.

Blast radius: a downstream build system that trusts a `{"state":"passed"}` response as "these exact declared inputs produced this exact declared artifact" gets a guarantee the validator never made. An unattended agent wiring voice-fidelity into a build gate would reasonably assume the hashes it is required to supply are load-bearing. Fix: after each `readFileSync`, compute the sha256 of the bytes and compare against the corresponding declared `hash` (normalizing the `sha256:` prefix the way `run-support.ts:46-48` does); on mismatch, refuse with a named diagnostic naming the field, the declared hash, and the computed hash. If verifying is deliberately out of v1 scope, the wire type should not accept a `hash` field it ignores.

### AUDIT-20260727-28 — `findUnresolvedDestinationChecks` fabricates "does not survive" failures when only SOME declared destinations are unresolved

Finding-ID: AUDIT-20260727-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/classify-op-failures.ts:109-113, 128-143

The unresolved-destination detector triggers on `.some()`:

```ts
const destRefs = entry.edition_units ?? [];
const anyUnresolved = destRefs.some((ref: UnitRef) => !editionByKey.has(unitRefKey(ref)));
if (!anyUnresolved) { continue; }
```

but the diagnostics it then synthesizes assert a *total* failure for every payload item in the source unit: `` `${KIND_LABEL[kind]} ${item} does not survive into declared destinations (destination unresolved)` ``. `edition_units` is an array precisely because a `represented`/`merged` source unit can be split across two or more edition units. If one of those two destinations resolves and the other does not, the payload may be fully present in the resolved destination — `checkOpObligations` (unit-local multiset over the declared destination set, T013/T014) would have emitted no payload failure at all. This function then invents one failure line per quote, per citation, per numeric, per lexicon term, each stating as fact that the item does not survive, and flips the corresponding named checks (`verbatim_quotes`, `citations`, `numeric_literals`, `lexicon`) to `failed`.

Blast radius: this is a false *refusal* with a factually wrong diagnostic, on a validator whose entire purpose is an honest verdict. A downstream consumer — especially an unattended agent asked to "fix the fidelity failures" — reads `numeric literal 42 does not survive into declared destinations` and goes hunting for a missing `42` that is in fact present in the edition, in the destination the ledger declared. The real defect (one destination ref no longer resolves) is stated only in the parenthetical. A reasonable fix: partition `destRefs` into resolved/unresolved, and only synthesize per-item payload diagnostics for items that are actually absent from the union of the *resolved* destinations; when the resolved subset already carries the payload, emit a single destination-accounting failure naming the unresolved ref and attribute it accordingly, rather than blaming every payload item.

---

### AUDIT-20260727-29 — A non-`cut` entry with an empty/absent `edition_units` produces failures that flip no named check

Finding-ID: AUDIT-20260727-29
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/classify-op-failures.ts:27-33, 106-113

Two attribution paths exist, and there is a hole between them. `CHECK_FOR_KIND` is a `Partial<Record<OpFailureKind, PayloadCheckName>>` that deliberately omits `destination` and `structural`, so `classifyOpFailures` silently drops those kinds (line 46: `if (check !== undefined)`). The doc comment states `structural` failures — explicitly including "empty destination" — "attribute to no single named payload check", and delegates `destination` to `findUnresolvedDestinationChecks`. But that function cannot pick up an empty-destination entry either: `destRefs = entry.edition_units ?? []` followed by `destRefs.some(...)` returns `false` on an empty array, so `anyUnresolved` is `false` and the entry is `continue`d at line 111-113. Same for any failure attached to a `cut` entry, skipped outright at line 106.

The consequence is that the failure string exists in the `failures` array while all ten named checks in the coverage report remain un-flipped. That directly contradicts the sibling doc comment at lines 38-40 — "this ensures no payload obligation failure can silently vanish without flipping a named check to `failed`" — and whether it is a *false clean* depends entirely on how `run.ts` derives the verdict: if the verdict is computed from the ten check states (which commit `7b06064`, "verdict requires full check set", suggests), an edition whose ledger declares `op: represented` with no destination is refused by `checkOpObligations` but reported as ten-of-ten `passed`. That is the exact false-clean failure mode this feature exists to prevent, and nothing in this file makes the required invariant ("the verdict MUST be derived from `failures.length`, not from check states, because structural failures are intentionally unattributed") explicit or mechanically enforced.

A reasonable fix is to make non-attribution impossible to lose: either add a `structural`/destination-accounting entry to the named check set, or have `run.ts` assert `failures.length === 0 ⟺ all checks passed` and fail loudly when they disagree. At minimum, the invariant belongs in an executable assertion, not in a doc comment on the module that doesn't own the verdict.

---

### AUDIT-20260727-30 — Unsupported quote-bank input escapes as an exception instead of a validator refusal

Finding-ID: AUDIT-20260727-30
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-payload.ts:139-143

`assertQuoteDialectSupported` throws when `quoteBankDeclared` is true. This is a request-shape problem, not an internal invariant violation, and the audited range explicitly includes “validator refuses (not throws) on bad source/request.” Because `runFidelity` calls this guard before building a report, an adopter can hit an uncaught exception path instead of receiving a structured `decided: false` or decided-failed refusal report.

The blast radius is high because a downstream CLI or unattended agent can crash on a declared quote-bank input rather than producing the coverage-report contract the feature exists to provide. A reasonable fix is to make this branch return a structured refusal through the orchestrator’s normal result channel, with the unsupported quote-bank dialect named in `failures[]` and the checks left in a consistent abort/not-run state.

### AUDIT-20260727-31 — FR-028's *refusal* half is untested, and the one test that claims to cover build-gate routing asserts a constant

Finding-ID: AUDIT-20260727-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    tests/integration/voice-zoning.test.ts:175-185 (and the file docblock, lines 11-15)

The file's docblock states the regression covers two things: "an impure voice edition output is routed to the dot-zoned `.ai/` root (impureOutputRoot) **and the build gate refuses any mis-routed edition**" (lines 12-13). Neither is exercised here. The only test that names the build gate — `'the impure voice edition is routed under impureOutputRoot (`.ai/`) by the build gate (FR-028)'` (lines 176-184) — discards the fixture (`await cleanVoiceFixture();` at line 180, return value unused), never invokes `pc build`, and reduces to `expect(impureOutputRoot()).toBe('.ai')`. That asserts a constant against its own literal: it stays green if routing regresses to `dist/`, if the build gate is deleted, or if the voice provider writes outside `.ai/` entirely. Nothing anywhere in this chunk builds a *mis-routed* edition and asserts refusal — `voice-revise.test.ts` only checks the happy path's `output.path` prefix (line ≈152), which is the positive case, not the gate.

Blast radius: T021 is the ledger-recorded regression test for SC-005 / FR-028-029. A downstream agent reading tasks.md ("T021 complete") plus a green suite concludes voice editions are mechanically confined to `.ai/`. They are not — the confinement claim rests on one tautology and one positive-path prefix check. A future refactor that lets an impure edition land in `dist/` (the exact hazard FR-028 exists for) ships green.

A real fix has two parts: (a) delete or replace the constant assertion with one that builds and asserts `answer.output.path` starts with `impureOutputRoot()` — i.e. move the check to where a build actually happens; and (b) add the missing negative: a profile/target whose declared output path is outside `.ai/`, asserting `pc build` refuses by name. Note this may partially overlap the parked backlog item `task-33 - fr028-zoning-test-asserts-constant`; the *refusal-half gap* is the additional, un-parked channel.

### AUDIT-20260727-32 — Byte input and string input derive different units for a BOM-prefixed source

Finding-ID: AUDIT-20260727-32
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/units/derive.ts:29-40, 59-62

`deriveUnits` accepts `string | Uint8Array` and funnels both through the same pipeline, but the two paths are not equivalent for a document that begins with a UTF-8 BOM (`EF BB BF`). The byte path goes through `new TextDecoder('utf-8', { fatal: true })` (line 61); WHATWG `TextDecoder` defaults to `ignoreBOM: false`, which means it **strips** a leading BOM from the decoded output. The string path (line 37, `typeof input === 'string' ? input : …`) leaves the `\uFEFF` in place. The same source document therefore yields two different unit decompositions depending only on which overload the caller reached for.

The divergence is not cosmetic. First, the first unit's `content` differs by one code point, so its `contentHash` differs, so its `unitId` differs — a coverage ledger written from one call path will not resolve against units derived on the other, and the fidelity validator's unit-accounting check (exactly one disposition per source unit) will report unmatched units with no hint as to why. Second, and worse, `stripLeadingFrontmatter` compares `stripTerminator(first) !== FRONTMATTER_DELIMITER` (derive.ts:~91); with a BOM present the first line is `"\uFEFF---"`, frontmatter is **not** stripped, and the entire YAML frontmatter block becomes a source unit that the edition must now account for. An operator hits an unexplainable refusal on a Windows-authored or editor-BOM'd markdown source. Third, the byte path silently violates the `SourceUnit.content` contract as documented on line 10 ("Exact bytes of the unit's lines, original terminators included, unnormalized") — the BOM was normalized away.

A reasonable fix: normalize at the single entry point rather than at one of two — either strip a leading `\uFEFF` from `text` immediately after line 37 (documenting BOM removal as part of D6 decoding, so both paths agree), or pass `{ fatal: true, ignoreBOM: true }` and refuse a BOM-prefixed source by name. Whichever is chosen, it needs a fixture pair asserting `deriveUnits(bytes, id)` and `deriveUnits(new TextDecoder().decode(bytes), id)` produce identical `contentHash` sequences, since that equivalence is the load-bearing assumption of accepting both input types at all.

### AUDIT-20260727-33 — Fenced-code matching closes on any same-character fence prefix

Finding-ID: AUDIT-20260727-33
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/units/derive.ts:128-168

`groupUnits` opens and closes fenced-code state using only the marker character: `fenceChar = marker`, then closes when `marker === fenceChar`. `fenceMarker` returns only the first character of any line that begins with three or more backticks/tildes. That means an opening ```` fence can be closed by a shorter ``` line, and an in-block code line beginning with ``` plus content is also treated as a closing fence.

This violates the byte-exact D6 fenced-code exception as a durable unit-identity primitive: a source using a longer outer fence specifically to contain shorter backtick fences will derive different unit boundaries and hashes than a matching-fence implementation. The blast radius is high because downstream ledgers depend on these hashes; affected documents become mechanically unverifiable or, worse, reproducible only with this buggy parser. A reasonable fix is to track the opening fence character and length, and only close on a fence of the same character with length >= opening length and no non-whitespace trailing content, with fixtures for longer fences and embedded shorter fences.

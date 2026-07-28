---
slug: 005-voice-producer-protocol
targetVersion: ""
---

# Audit log — 005-voice-producer-protocol

## 2026-07-28 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260728-01 — Root lint gate now excludes the largest new TypeScript package, and the comment claims an enforcement that no gate performs

Finding-ID: AUDIT-20260728-01
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    eslint.config.mjs:44-51

The diff adds `'voice-tooling/'` to the **global** ignores block (line 51), so `eslint .` at the repo root now skips the entire sub-package — roughly 20 source files including `run.ts` (358L), `check-op-obligations.ts` (268L), `schema/ledger.ts` (303L). The justifying comment states voice-tooling's own gates are "`node --test` + `tsc --noEmit`" (lines 44-45) and then asserts on lines 49-50: "Typing discipline there — no any/as/ts-ignore — is still enforced, see voice-tooling verification." Neither named gate enforces that. `tsc --noEmit` under `strict` does not reject an explicit `any`, does not reject an `as` assertion, and does not reject `@ts-ignore` (only `ts-expect-error` interacts with the compiler, and permissively). The "verification" being pointed at is the one-shot manual sweep recorded in `.stack-control/execute/voice-editions.ledger.jsonl:26` ("21 real violations fixed, 14 as-casts removed via new isRecord util, 0 any/as/@ts-ignore") — a snapshot, not a gate.

Blast radius: this is the surface a downstream contributor or unattended agent consults to answer "is my voice-tooling change linted?" As written, they read "still enforced" and proceed. In fact the next `any` or `as` added to `check-op-obligations.ts` lands with nothing failing — CI green, root lint green, package gates green — which is precisely the class of regression the T026 sweep just spent a commit removing, and it silently voids the project-wide "Never bypass typing" rule in the one package where it was hardest to hold. The exclusion is also stated in the smell form ("we exclude voice-tooling because linting it would be an out-of-scope mass-reformat") rather than as an invariant plus an in-scope exception; there is no stated invariant that survives the exclusion.

A reasonable fix: add `voice-tooling/eslint.config.mjs` with `parserOptions.project: ./tsconfig.json` and at minimum `no-explicit-any` / `no-unnecessary-type-assertion` / `ban-ts-comment`, and add `lint` to the package's gate script so the claim on line 49 becomes true; or scope a root config object at `voice-tooling/**/*.ts` pointing at that tsconfig instead of a blanket ignore. If the decision really is "no lint here," the comment must say that plainly rather than assert enforcement.

### AUDIT-20260728-02 — T026 is ledgered `reviewClean:true` while recording an unresolved validator over-strictness defect that a test now pins in place

Finding-ID: AUDIT-20260728-02
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    .stack-control/execute/voice-editions.ledger.jsonl:26 (and :16); affected code named there: `voice-tooling/src/payload/extract.ts`, `voice-tooling/test/op-obligations.test.ts:112`

Line 16 (T016) records: "extractPayload numeric regex catches digit inside [^1] citation marker → T016 workaround strips markers for numeric display count, but op-survival still double-counts (extra-strict, not false-clean); extract.ts should exclude citation spans from numerics". Line 26 (T026, the whole-suite verification gate) then closes the feature with `reviewClean:true` and: "extract.ts numeric/citation [^1] double-count **LEFT as confirmed known-issue for governance** (fix would break op-obligations.test.ts:112 numerics===2; not low-risk; display already corrected via countProseNumerics)."

Two problems. First, "extra-strict, not false-clean" is offered as mitigation, but for a *validator* over-strictness is the user-visible failure mode: it refuses editions that are faithful. The concrete trigger is narrow but real — a footnote marker digit that collides with a prose numeral. Source unit `3 canoes[^3]` extracts the multiset `{3,3}`; an edition that legitimately renumbers or relocates that marker under the allow-list resolution (`check-payload.ts` deliberately permits citations to vanish on cut, per line 15's note) extracts `{3}`, `survivesMultiset` decrements to a shortfall, and `check-op-obligations` reports a payload-survival failure on a faithful `represented`/`merged` op. The operator sees a named refusal with no correct remedy. Second, and worse for the audit trail: the stated reason not to fix is that `op-obligations.test.ts:112` asserts `numerics === 2` — i.e. the suite now *pins the defective extraction as expected behavior*. A test encoding a known-wrong expectation converts a fixable bug into a protected invariant, and the "251 green / 177 green" suite counts cited throughout both ledgers are therefore not evidence on this path.

Third, mechanically: "LEFT as confirmed known-issue for governance" is a deferral routed through the governance record, and it is attached to a row marked `reviewClean:true`. The verification gate should not be able to report clean while carrying an open correctness item. Reasonable fix: exclude citation spans from numeric extraction in `extract.ts` (the remedy T016 already identified), update `op-obligations.test.ts:112` to the corrected expectation with a fixture that has a marker/prose digit collision *and* a renumbered-marker edition, and re-ledger T026 — rather than leaving the defect load-bearing behind a green suite.

### AUDIT-20260728-03 — Shared profile only works from repo-root cwd

Finding-ID: AUDIT-20260728-03
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    profiles/voice-editions.yaml:20-24

The committed shared profile invokes `node voice-tooling/bin/voice-revise.mjs` and `node voice-tooling/bin/voice-fidelity.mjs` with repo-relative paths. The actual subprocess runner does not set `cwd` when spawning commands (`src/providers/run.ts:115-117`, validator mirrors this at `src/providers/validate-run.ts:113-114`), so those paths resolve relative to the operator’s current working directory, not relative to the profile file or package root. An operator running `pc build --episode /path/to/episode` from anywhere except the repo root will pass profile loading but fail at provider startup.

The tests do not cover the shipped profile shape: `tests/integration/voice-revise.test.ts:49-50` builds absolute bin paths, then writes an episode-local `voice-editions.yaml` with those absolutes at `tests/integration/voice-revise.test.ts:120-127`, shadowing the shared profile. Blast radius is high because a downstream adopter can select `profile: voice-editions` exactly as shipped and hit a build-time failure in the feature’s main workflow. A reasonable fix is to make profile command resolution stable by using installed bin names, absolute package-root expansion, or a command-resolution mechanism relative to the loaded profile/package root, with a test that loads `profiles/voice-editions.yaml` unmodified from a non-repo cwd.

### AUDIT-20260728-04 — Component-shared supply lets an entry be corroborated by destinations it never declared

Finding-ID: AUDIT-20260728-04 (claude-01 + claude-02 + claude-03 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-op-obligations.ts:5-10, 216-219, ~412-455 (`buildComponentRemaining`)

The file header states the guarantee precisely: "it resolves each entry's declared source_unit and declared edition_units exactly as written and checks the op's mechanical obligation against **THOSE declared destinations only**" (lines 5-10). The implementation does not do this for `represented`/`merged`. `assignComponents` unions entries transitively over *shared* destination refs, and `buildComponentRemaining` then builds one `RemainingSupply` from the union of **every** destination in the component (`for (const destRef of entry.edition_units ?? []) { keys.add(unitRefKey(destRef)); }` accumulated per root). `checkGroupedSurvival` (called at line 218) consumes each entry's source payload against that whole-component supply — not against the subset the entry actually declared.

Concretely: entry A is `merged` → `[D1, D2]`, entry B is `merged` → `[D2, D3]`. They share D2, so union-find puts them in one component and the supply is `payload(D1) ∪ payload(D2) ∪ payload(D3)`. A quote that exists only in **D3** now discharges A's obligation, even though A never named D3. The check reports `ok` for a ledger whose declared mapping is false. This is precisely the false-clean shape the module was written to eliminate — the AUDIT-17 fix correctly stopped one destination *occurrence* from discharging two obligations, but in doing so it widened each entry's admissible destination set from "declared" to "declared, plus anything transitively reachable." The blast radius is that `voice-fidelity` — the only mechanical gate on a model-declared coverage ledger — emits a pass verdict on a ledger the operator is being asked to trust, and the operator has no other instrument. Multi-destination `merged` entries are the normal case for this op, so the chain is reachable in ordinary ledgers, not just adversarial ones.

A fix preserves both invariants at once by making the bookkeeping per-destination instead of per-component: keep one shared `RemainingSupply` **per destination key** (so a destination named by two entries still supplies its payload once), and have each entry consume against only the counters for the destinations it declared, in declared order. Sharing accounting survives; the declared-destination boundary is restored. Either way the header comment at lines 5-10 and the implementation must be brought into agreement — as written, one of them is lying to the next reader.

---

### AUDIT-20260728-05 — `occurrenceIndex` is never exercised on byte-identical units — a hash-only implementation passes every test in this chunk

Finding-ID: AUDIT-20260728-05
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units.test.ts:32-178, voice-tooling/test/unit-accounting.test.ts:22-120

`occurrenceIndex` / `source_unit.occurrence` exists for exactly one reason: two source units can have identical bytes (and therefore identical `contentHash`), and the coverage ledger must still bind each one to its own disposition. Nothing in this chunk pins that behavior. In `source-units.test.ts` every fixture (`basic-lf.md`, `whitespace-separator.md`, `multi-separator.md`, `crlf.md`, `fenced-code.md`, `no-trailing-newline.md`, `trailing-whitespace.md`) produces units with distinct content — `'Alpha beta.\n'` / `'Gamma delta.\n'` — so `occurrenceIndex` is only ever read as an opaque value inside `deepEqual` comparisons (line ~140, `map((u) => [u.content, u.contentHash, u.occurrenceIndex])`) and never asserted to be `0, 1` for a repeated unit. In `unit-accounting.test.ts`, `SOURCE_TEXT = 'Alpha line.\n\nBeta line.\n\nGamma line.\n'` (line 23) likewise yields three distinct hashes, and *every* coverage array is built by `units.map((unit) => ({source_unit: {hash: ..., occurrence: unit.occurrenceIndex}}))` — so the occurrence field always agrees by construction.

The consequence: an implementation of `deriveUnits` that hard-codes `occurrenceIndex: 0`, or a `checkUnitAccounting` that keys its match set on `hash` alone and ignores `occurrence` entirely, passes all four accounting tests and all eleven derivation tests here. That is not a hypothetical shape — hash-only keying is the obvious first implementation, and the "missing entry" test (omitting the middle unit, which has a unique hash) does not distinguish it. Blast radius: a real source document with a repeated paragraph (a refrain, a repeated stage direction, a duplicated boilerplate line — entirely normal in the narrative material this tool exists for) would have N identical units collapse to one ledger identity. The fidelity verdict then reports "every unit accounted for" while N-1 units were silently never dispositioned. That is a false clean on the single guarantee the feature sells, and it is quiet — no error, no refusal.

A reasonable fix: add a `duplicate-units.md` fixture whose body is `Alpha beta.\n\nAlpha beta.\n\nGamma delta.\n`, assert `deriveUnits` yields three units where units[0] and units[1] share a `contentHash` but carry `occurrenceIndex` 0 and 1; then in `unit-accounting.test.ts` assert that a ledger carrying only `{hash, occurrence: 0}` for that hash **fails** with an unaccounted-unit failure naming occurrence 1.

---

### AUDIT-20260728-06 — No test for double-accounting: the "exactly once" half of the unit-accounting contract is unpinned

Finding-ID: AUDIT-20260728-06
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/unit-accounting.test.ts:1-120

The file's own header states the contract it is testing: "a ledger accounting for every derived source unit **exactly once**" (line 5), and the commit that introduced the check calls it "exactly one disposition per source unit" (9de3b07). The four tests cover *at-least-once* (missing entry → fail), *no-extras-that-don't-exist* (unknown hash → fail), and the happy path. There is no test where the same `{hash, occurrence}` appears **twice** in `coverage`. The `push` in the third test (line ~85) adds an entry with a *bogus* hash, which exercises the unknown-unit path, not the duplicate path.

An implementation that builds a `Set` of covered unit keys and then checks `derivedKeys ⊆ coveredKeys` and `coveredKeys ⊆ derivedKeys` — the natural set-based implementation — satisfies every assertion in this file while accepting a ledger that says unit 2 was both `cut` and `verbatim`. That is precisely the state the check exists to refuse: two contradictory dispositions for one unit means the accounting is ambiguous and the downstream verdict is computed over an ill-defined coverage set. Blast radius: a model that emits a duplicated entry (a plausible failure mode for a model asked to declare an index mapping — see TASK-29, `revise/ledger-build.ts` in chunk `f2899e55`) yields a passing fidelity report over an ambiguous ledger, and whichever entry the payload check happens to consume first decides the outcome non-deterministically.

Fix: add a test that duplicates one entry (same hash, same occurrence, differing `op`) and asserts `result.ok === false` with a failure string naming the doubly-accounted unit. Assert `result.total` is still the derived-unit count (3), not the coverage-entry count, so the report's denominator is pinned too.

---

### AUDIT-20260728-07 — D6.2 "single leading frontmatter block" has no fixture for an unterminated or a second block — the failure mode is a silently emptied document

Finding-ID: AUDIT-20260728-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/source-units.test.ts:113-135

The file claims coverage of D6.2, "strip **only a single** leading `---`...`---` frontmatter block" (header line ~11). Two tests exist: frontmatter is stripped (`frontmatter.md` vs `basic-lf.md`), and a `---` that is not the first line is ordinary content (`frontmatter-not-first-line.md`). Neither covers the two channels the word "single" actually opens: (a) a document whose first line is `---` but which has **no closing `---`**, and (b) a document with two consecutive `---`-delimited blocks, where only the first may be stripped.

Case (a) is the dangerous one. A scanner that strips from line 1 to the next `---` and finds none has two plausible behaviors — treat the entire file as frontmatter (returning zero units) or treat the opener as content. Nothing in this test file, and nothing in the fixture set visible here, chooses between them. If the implementation picks "whole file is frontmatter", `deriveUnits` returns `[]`, and — per finding 02 — a ledger with empty `coverage` then satisfies unit accounting *vacuously* (`total: 0`, no missing units, no unknown units). The whole pipeline reports a clean fidelity verdict on a document from which every unit vanished. Note the differential-oracle style used in the frontmatter test (`deepEqual` of two `map` results, line ~127) is structurally blind to this class: two empty arrays compare equal. Case (b) is the milder channel — over-stripping a second block deletes real content from the edition, again with no error.

Fix: add `frontmatter-unterminated.md` (first line `---`, key/value lines, no closing delimiter) and assert the specified behavior explicitly — I'd expect refusal or "not frontmatter, all content", but the point is that the artifact must *state* one and the test must pin it. Add `frontmatter-double.md` asserting the second `---` block survives as ordinary unit content. Also add a bare `assert.ok(units.length > 0)` to the existing frontmatter test so it can never pass vacuously.

---

### AUDIT-20260728-08 — `edition_units` element values (negative / non-integer / non-number) are an unpinned channel — only the too-large index is fixtured

Finding-ID: AUDIT-20260728-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise-protocol.test.ts:88-96 (parseModelOutput non-cut validation) and :203-236 (buildEdition out-of-range)

`parseModelOutput`'s validation of the non-cut case is pinned only as "requires a non-empty edition_units array" (test at :88-96, matching `/requires a non-empty edition_units array/`). Nothing in this file asserts that the *elements* are integers in range: there is no fixture for `edition_units: [-1]`, `[0.5]`, `["0"]`, `[null]`, or `[0, 0]` (a duplicate destination). The only element-level guard exercised anywhere is `buildEdition`'s upper-bound check, and only via the single value `5` on a 2-unit edition (:203-236, `/edition_units index 5 is out of range/`).

This is the classic channel-enumeration gap: the *value* channel of a model-declared index is much wider than "too big." A negative index is the dangerous one — if the provider resolves destinations with `editionUnits.at(i)` rather than `editionUnits[i]`, `-1` silently wraps to the *last* edition unit and produces a fully-resolved, structurally valid, hash-keyed ledger that maps the wrong source unit to the wrong destination. That defeats the whole point of the protocol (the ledger is the fidelity evidence), and it fails *quietly*: `checkUnitAccounting` sees one disposition per source unit, `checkOpObligations` sees a resolvable destination. A string `"0"` is similarly hazardous: `"0" < length` and `"0" >= 0` both coerce truthy in a naive numeric comparison, so a range check written with `<`/`>=` accepts it while `arr["0"]` happens to work — until a two-digit string like `"10"` compares lexically. A duplicate index across two `verbatim` entries would let two distinct source units both claim the same edition unit, which is precisely the multiset accounting the prior AUDIT-17 fix was about.

Blast radius: the consumer here is the validator pipeline that downstream agents treat as the fidelity gate. A wrong-but-resolvable mapping yields a `passed` verdict on an edition that is not faithful — a false clean, which is worse than a crash. Fix: add `parseModelOutput` fixtures rejecting non-integer, negative, and non-number elements (validate at the wire boundary, where the model's output is untrusted), plus a `buildEdition` fixture for `-1` and for a duplicated destination index, asserting a named refusal rather than a built edition.

### AUDIT-20260728-09 — `buildEdition` is exercised only for `verbatim` on an identity edition — `cut`, `merged`, and `represented` have no provider fixture

Finding-ID: AUDIT-20260728-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/revise-protocol.test.ts:114-236

Every `buildEdition` test in this file uses the same model output shape: `edition: SOURCE_TEXT` (edition body byte-identical to source) with `coverage: [{op:'verbatim', edition_units:[0]}, {op:'verbatim', edition_units:[1]}]`. The round-trip test at :114-155 asserts `obligations.opCounts.verbatim === 2` — confirming that the only op path the provider's ledger-building code has been unit-tested on is `verbatim`.

The ops the commit message calls out as the reason this layer exists ("model declares index mapping, provider builds hash-keyed ledger") are exactly the ones untested. `cut` is structurally distinct: it carries a `reason` and *no* `edition_units`, so the provider must emit a ledger entry with a null/absent destination — the code path where an "empty destination guard" (AUDIT-19) and "unresolved-dest vs survival" (AUDIT-28) live. `merged` is the many-to-one path where two source-unit entries name the same edition unit, which is legitimate for merge but illegitimate for two verbatims — and nothing here pins that the provider distinguishes them. `represented` carries the optional `treatment` note, which is pinned through `parseModelOutput` (:35-43) but never followed through into the built ledger, so there is no test that the treatment survives into the hash-keyed entry at all.

Blast radius: an adopter running `voice-revise` for anything other than a no-op revision immediately exercises untested provider code. Since the built ledger *is* the evidence the validator checks, a defect in the `cut` or `merged` construction path produces either a spurious refusal (annoying, visible) or a resolvable-but-wrong ledger (invisible). Fix: add at least three `buildEdition` fixtures — a `cut` entry (assert the ledger entry has no destination and carries the reason), a `merged` pair mapping units 0 and 1 to edition unit 0 (assert `opCounts.merged === 2` and `obligations.failures` empty), and a `represented` entry asserting `treatment` reaches the ledger.

### AUDIT-20260728-10 — CheckResult helper tests leave discriminant overwrites unguarded

Finding-ID: AUDIT-20260728-10
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/report-types.test.ts:49-53, voice-tooling/test/report-types.test.ts:286-301

The new tests assert that helper `fields` accept arbitrary extra data, including `customField` and `nestedData`, but they never pin the invariant that helper-owned keys such as `state` and `reason` cannot be overwritten by that arbitrary payload. That matters because the helpers are the contract boundary for report states: a checker passing through metrics with a `state` key could silently turn `passed(...)` into a blocking or misleading state, or overwrite the reason on `failed(...)` / `aborted(...)`.

Blast radius is high because downstream verdict computation depends entirely on these discriminants. A reasonable fix is to add collision fixtures for each helper-owned key and make the implementation preserve helper-authored `state` / required `reason` regardless of supplied metadata, or reject reserved metadata keys explicitly.

### AUDIT-20260728-11 — `inputs` present-but-empty is untested — the exact crash site AUDIT-20260726-21 exists to close has no fixture

Finding-ID: AUDIT-20260728-11
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/fidelity-cli.test.ts:34-89

The header comment (lines 1-6) states the bug precisely: `cli.ts` "used to read `request.inputs['source']` / `request.artifact.path` straight off a bare `JSON.parse` result with no shape guard." Three record-shaped cases follow. Walk what each actually pins: the `{}` case (line 34) fails on `version`; the missing-`inputs` case (line 52) omits `inputs` wholly; the bad-artifact case (line 76) misspells `artifact` and supplies `inputs: {}` — but its only stderr assertion is `/voice-fidelity: ValidateRequest\.artifact/` (line 91), which fires before `inputs` is ever examined. **No test in this file sends a structurally complete request whose `inputs` is present but lacks `source`** (`{version, target, artifact, inputs: {}}`), and none sends `inputs.source` with a wrong shape (a bare string, or an object missing `path`/`hash`).

That is the crash site itself. `request.inputs['source']` on `inputs: {}` yields `undefined`; whatever the CLI does next with it — `.path`, `readFileSync`, a hash compare — throws the raw `TypeError` with empty stdout that the fix was written to eliminate, and every assertion in this file stays green. Applying the channel-enumeration driver: the fix added a validation surface, and the *interior* of `inputs` is an entirely unfixtured channel. The value channel (which `inputs` payloads are accepted) and the state channel (`inputs` present, key absent) are both open. Blast radius: an external caller (`pc validate` is named at line 12) that omits or misnames the source input gets the fourth outcome — no `ValidateResponse`, no named refusal, an unnamed crash — which is exactly the contract violation this feature claims to have closed, with a green suite asserting otherwise.

A fix is two more cases in the same style: `inputs: {}` with an otherwise-valid request, asserted on `/voice-fidelity: ValidateRequest\.inputs\.source/`; and `inputs: {source: 'not-an-object'}`, asserted the same way. Both must keep the existing empty-stdout and `doesNotMatch(/TypeError/)` assertions.

### AUDIT-20260728-12 — No accept-side test at the process boundary — an over-strict guard, or a broken success path, keeps all 8 tests green

Finding-ID: AUDIT-20260728-12
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/fidelity-cli.test.ts:1-140 (whole file)

Lines 7-12 assert this file's reason for existing: it "exercises the REAL `bin/voice-fidelity.mjs` entry point end-to-end (not just the in-process `runFidelityCli` function), because the bug was specifically about what reaches the process boundary (stdout/stderr/exit code)... the same thing an external caller actually observes." Every one of the eight tests then asserts a *refusal*: `notEqual(code, 0)`, `stdout.trim() === ''`, a named-refusal stderr match. Nothing anywhere in this file drives the boundary to a success or to a decided-failure.

Consequence: the contract has three legitimate outcomes (passed / decided-failure / cannot-decide, per line 5-6), and this file — by its own claim, the only one that observes them where a caller does — pins none of them. A guard that over-rejects (requires `version` to be a string, rejects an `inputs` object carrying an extra key, rejects `target` values other than `'edition'`) breaks every real integration while all eight tests pass. So does a bin that resolves its loader wrong on the success path, or one that writes the `ValidateResponse` to stderr, or one that exits non-zero on a *passed* verdict. The refusal tests are structurally incapable of catching any of it, because "non-zero exit, empty stdout" is precisely what a totally-broken bin produces.

Blast radius is the integration surface itself: an adopter wiring `pc validate` to this bin gets no test-backed guarantee that any request is ever accepted. The fix is one e2e that pipes a well-formed request over the existing `faithful-*` fixtures and asserts exit 0 plus a `JSON.parse`-able `ValidateResponse` on stdout with `verdict: 'passed'`, and one that drives a known-failing edition and asserts the decided-failure exit code and stdout shape. (Caveat: I cannot read `voice-tooling/src/fidelity/cli.ts` or the integration tests in the other chunks; if a boundary-level accept test exists elsewhere, this narrows to "the file that claims boundary ownership doesn't own the accept side" — still worth co-locating.)

### AUDIT-20260728-13 — The only lexicon test asserts a flag while its own fixture violates the obligation it names — the lexicon-survival check is entirely unpinned

Finding-ID: AUDIT-20260728-13
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/op-obligations.test.ts:125-130 (and the `payloadChecked.lexiconTerms` assertions at :115-120)

`test('checkOpObligations: a lexicon makes lexiconApplicable true')` calls `checkOpObligations(faithfulLedger(src, ed), src, ed, ['Gamma'])` and then asserts exactly one thing: `assert.equal(result.lexiconApplicable, true)`. It never asserts `result.ok`, `result.failures`, or `result.payloadChecked.lexiconTerms`. That matters because the fixture it reuses does **not** satisfy the lexicon obligation: source units `s2` (`'Gamma one with 42.'`, :43) and `s3` (`'Gamma two cites [^c].'`, :45) both carry the term `Gamma`, and both are declared `merged` into the single destination `e2` — which reads `'Merged gamma line with 42 and [^c].'` (:59), **lowercase**. Lexicon matching is pinned byte-exact case-sensitive by `payload-extract.test.ts` (`'"Bridge" does NOT match "bridge"'`, ~:90), so `Gamma` does not survive into the declared destination. If `checkOpObligations` enforced lexicon survival at all, this call would return `ok: false` with two shortfalls.

The consequence is that the lexicon path has no enforcement test anywhere in this file. Every other assertion of `payloadChecked.lexiconTerms` in the diff is `0` (:115-120, :~150). An implementation that accepts the `lexicon` parameter, sets `lexiconApplicable = terms.length > 0`, and then **ignores lexicon terms completely** when building the per-entry obligation multiset would pass this entire suite green. That is a false-clean in exactly the class of defect the validator exists to prevent (D14/FR-020 declared-lexicon terms), and it ships as "covered" because a test with `lexicon` in its name exists.

Blast radius: a downstream operator reads a green fidelity run as "the voice lexicon survived the edition" when the validator may never have checked. Reasonable fix: split into two tests — one asserting the *negative* (this exact fixture must produce `kind: 'lexicon'` shortfalls attributed to `s2` and `s3`, with `payloadChecked.lexiconTerms === 2`), and one positive fixture where the destination preserves `Gamma` byte-exactly and `ok` is `true`.

---

### AUDIT-20260728-14 — An entry that declares the same destination twice doubles its own payload supply — the intra-entry channel opened by the multiset-consumption fix has no fixture

Finding-ID: AUDIT-20260728-14
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/op-obligations.test.ts:230-290 (the AUDIT-20260726-17 and AUDIT-20260727-03 tests)

The FIX-1 test (:~238-290) establishes the invariant that a shared destination's payload is *consumed once* across a group: one destination `1978` cannot discharge two merged obligations, two destination `1978`s can. Every fixture in the file builds that supply from *distinct* destination refs — `edition_units: [ref(e2)]`, `[ref(dOnce)]`, `[ref(d)]`. Nothing exercises `edition_units: [ref(e0), ref(e0)]`, i.e. one entry naming the same destination occurrence twice.

This is the value channel the consumption fix opened. If the supply pool is built by iterating `edition_units` and unioning each resolved unit's payload multiset (which is what "destination union" in the file header comment at :10-11 implies), then a duplicate ref contributes its payload twice, and a producer can manufacture arbitrary supply by repeating a destination ref — restoring precisely the cross-unit false-clean AUDIT-20260726-17 was fixed to close. The tests give no evidence either way: the checker is fed hand-built ledger objects here (the file deliberately bypasses `loadLedger` for the defensive branches at :~195 and :~400), so even if `loadLedger` deduplicates refs, `checkOpObligations` itself is documented-as-defensive and this branch is unguarded by any assertion.

Blast radius: a false-clean verdict on an edition where a source unit's payload never appears — the validator's whole reason to exist. Reasonable fix: add a fixture with `edition_units: [ref(d), ref(d)]` for two merged sources each needing `1978`, where `d` contains `1978` once, and assert it still fails with one `numeric` shortfall; plus a structural guard + test rejecting duplicate refs within one entry.

---

### AUDIT-20260728-15 — `payloadSurvives` is never negatively exercised on `quotes` or `citations` — an implementation that ignores both kinds passes every assertion in this file

Finding-ID: AUDIT-20260728-15
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/test/payload-match.test.ts:78-118

There are exactly three `payloadSurvives` tests, and in all three the `quotes` and `citations` kinds are arranged so that a *totally missing* per-kind check is indistinguishable from a working one. Test at 78-92 (`source discharged by the destination union -> ok`) has `citations: ['[^1]']` present in the union, so it passes whether or not citations are checked. Test at 94-113 (`per-kind shortfall reported, ok is false`) has `quotes: ['kept']` on both sides and no citations at all, so `missingByKind.quotes` is `[]` either way; the only two kinds that actually drive `ok: false` are `numerics` and `lexiconTerms`. Test at 115-118 is empty-vs-empty. Concretely: a `payloadSurvives` whose per-kind loop is `for (const k of ['numerics','lexiconTerms'])` and which fills `quotes: []`/`citations: []` into `missingByKind` unconditionally is green across this entire file.

That is precisely the false-clean the file's own header (lines 3-5) claims to be adversarial about, and it lands on the two highest-value kinds: `quotes` is the verbatim-fidelity payload the whole feature exists to protect, and `citations` is the no-fabrication payload. `survivesMultiset` being well-tested in isolation (lines 25-59) does not cover this — the untested seam is the per-kind *wiring* in `payloadSurvives`, not the multiset primitive it delegates to.

Blast radius: if the wiring is wrong (or is later refactored to be wrong), the fidelity validator emits a clean verdict on an edition that dropped or fabricated quoted text — an invisible false clean, the worst failure mode for a validator whose entire product is trust. Fix: add one shortfall test per kind — at minimum `payloadSurvives(payload({quotes:['"the toll was ruinous"']}), payload({}))` asserting `ok:false` and `missingByKind.quotes` naming the quote, and the same for `citations`. Parameterizing over the four kinds so every kind is negatively exercised is cheaper than four hand-written tests and closes the seam permanently.

---

### AUDIT-20260728-16 — Lexicon matching is unbounded substring search, so an unrelated longer word manufactures destination supply and discharges a dropped source term (false clean)

Finding-ID: AUDIT-20260728-16
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/payload/extract.ts:134-165 (`extractLexiconTerms`, doc block at 134-138)

`extractLexiconTerms` matches each declared term with `content.indexOf(term, from)` (line 155) — a raw substring scan with no token/word boundary. Both sides of the comparison are extracted this way, so a destination unit that merely *contains* the term inside an unrelated word yields supply that `consumeAgainstRemaining` will happily use to discharge a genuine source obligation. For this corpus that is not hypothetical: with a French lexicon term `roi`, a source unit that says *"le roi"* and an edition that dropped the king entirely but says *"trois"* produces source `['roi']` / dest `['roi']` → `ok: true`. The module in `match.ts:3-8` states false-clean prevention is the reason it exists; unbounded substring extraction reopens that exact hole one layer upstream, where multiset arithmetic cannot see it.

The same mechanism also contradicts the docstring at line 135-136, which claims extraction is "non-overlapping." Non-overlap is enforced only *within* one term (`from = index + term.length`, line 160); across terms it is not. A lexicon holding both `Nouvelle-France` and `France` double-books every occurrence of the former, inflating the obligation count on both sides in ways that depend on which longer/shorter terms the voice document happens to declare.

Blast radius: the fidelity validator's whole purpose is to refuse editions that silently lost declared material. A false clean here means an unattended pipeline ratifies an edition that dropped a lexicon term, with a green report and no residual signal. A reasonable fix is to define the lexicon match rule explicitly (boundary-anchored match, or longest-match-wins with a consumed-span mask so cross-term overlap is impossible), pin it with fixtures for the `roi`/`trois` and `France`/`Nouvelle-France` shapes, and correct the "non-overlapping" docstring to say what is actually guaranteed.

---

### AUDIT-20260728-17 — Golden fixtures the entire T024 test file reads are absent from the diff — the eight `sources/*.md` inputs are never added

Finding-ID: AUDIT-20260728-17
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    `voice-tooling/test/fixtures/sources/` (missing); consumed at `voice-tooling/test/golden-markdown.test.ts:27,49,71,92,113,134,159,197`

Every one of the eight tests in this new file is driven by an on-disk fixture: `readFixture('sources', 'setext-heading.md')` (line 27), `'setext-with-hyphens.md'` (49), `'mdx-import.md'` (71), `'mdx-export.md'` (92), `'jsx-component.md'` (113), `'html-block.md'` (134), `'html-with-blank-lines.md'` (159), `'loose-list.md'` (197). None of these eight files appears in any chunk's file list. What *does* appear, in chunk `0168cfc126e69be9`, is `voice-tooling/test/fixtures/sources/.gitkeep` — i.e. the harness enumerated the placeholder in exactly the directory these fixtures must live in, and enumerated no `.md` beside it. An omission of eight files from a directory whose `.gitkeep` was listed is far more likely to be a real absence than a chunking artifact.

The blast radius is that the T024 deliverable does not exist for anyone but its author. A fresh clone or a CI runner gets eight hard failures (or eight `ENOENT` throws out of `readFixture`, depending on its error path in `test/support.ts`), and — worse for governance — the "whole-suite green" claims that ratified this feature (`90ea572` T026, `40c5ff3` ratify) were computed against untracked files in one working tree and are not reproducible. A golden-fixture test whose golden input is untracked also silently stops being a pin: the next person to run it can edit the fixture with no diff to review. The most likely mechanism is `voice-tooling/.gitignore` (added in chunk `ac767d83a6b91407`) carrying a pattern broad enough to swallow `test/fixtures/**/*.md`; note that a `.gitattributes` was added specifically to protect fixture EOLs (`5101c46`), which only matters if fixtures are meant to be tracked.

Fix: `git status --ignored voice-tooling/test/fixtures/sources/` and `git ls-files voice-tooling/test/fixtures/` to confirm, then commit the eight fixtures (narrowing the ignore pattern if that is the cause). The same check should be run for the fixture corpus consumed by the sibling suites in other chunks (`source-units.test.ts`, `source-units-edition.test.ts`, `fidelity-pass.test.ts`) — if the ignore rule is the cause, their inputs are missing too and the exposure is far wider than T024.

---

### AUDIT-20260728-18 — `loadLedger`'s worked example encodes "verbatim ⇒ destination hash equals source hash" but no test pins it, so a `verbatim` entry pointing at a different unit loads clean

Finding-ID: AUDIT-20260728-18
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/ledger-schema.test.ts:27-29, :241-256 ("refuses a verbatim entry with more than one destination")

`VALID_LEDGER` encodes the verbatim invariant in its own worked example — `source_unit: { hash: sha256:u1, occurrence: 0 }` / `op: verbatim` / `edition_units: [ { hash: sha256:u1, occurrence: 0 } ]` (lines 27-29): the destination unit *is* the source unit, same hash, same occurrence. The suite then tests verbatim's **arity** (`requires exactly one edition_units entry (got 2)`) but never tests its **identity**. There is no fixture with `op: verbatim`, `source_unit: {hash: sha256:u1}`, `edition_units: [{hash: sha256:e9}]`. An implementation of `loadLedger` that checks only `length === 1` passes every test in this file while accepting a ledger whose `verbatim` claim is structurally self-contradicting.

This is squarely inside the file's own declared scope. The header's scope boundary (lines 9-14) excludes things that need the *source* or the *edition* to adjudicate — unit accounting, unknown units, `source.hash` matching, payload survival. Verbatim hash-equality needs neither: both hashes are inside the ledger's own bytes, which is exactly what D20 puts on this loader. Framed invariant-first: the invariant is *a `verbatim` disposition asserts the destination unit is byte-identical to the source unit*, and there is no in-scope exception to it — an entry that names a different destination hash is not a weaker verbatim, it is a malformed one.

Blast radius: a model emitting the producer protocol (commit 729c110) can declare `op: verbatim` while pointing at an arbitrary edition unit, and the schema layer signs off. Downstream, `check-payload` / unit-accounting (T012/T014) may or may not catch it depending on whether they re-derive the comparison from the source — and if they do, the operator gets a survival failure far from the actual cause (a lying disposition) rather than a named schema refusal. Fix: add a refusal fixture asserting a message like `op 'verbatim' destination must be the source unit`, and add its positive twin (verbatim where source and destination hashes match at differing occurrences — see AUDIT-BARRAGE-claude-02).

---

### AUDIT-20260728-19 — Every fixture in the ledger suite uses `occurrence: 0`, so occurrence-insensitive duplicate detection would falsely refuse every real ledger with repeated identical units

Finding-ID: AUDIT-20260728-19
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/ledger-schema.test.ts:258-272 ("refuses two entries declaring a disposition for the same source_unit"), and every `occurrence:` literal in the file

Grep the file: there are ~25 `occurrence:` literals and every single one is `0`. In particular the duplicate-disposition test (lines 264-269) declares two entries with *identical* `hash: sha256:u1` **and** identical `occurrence: 0`, and asserts `/duplicate disposition/`. An implementation that keys duplicate detection on `hash` alone — ignoring `occurrence` entirely — passes this test, and passes the whole suite, because no fixture anywhere distinguishes the two implementations.

That silent failure mode is not exotic; it is the common case. `occurrence` exists precisely because `deriveUnits` (T004, byte-exact derivation) will produce byte-identical units for repeated constructs — a repeated `---` rule, two identical short paragraphs, a repeated heading, a repeated blank-line-delimited stanza. Any source containing two identical units yields two coverage entries sharing a hash at occurrences 0 and 1, which an occurrence-blind loader refuses as a `duplicate disposition`. The producer would then be refused on a structurally *correct* ledger, with a message accusing it of a duplicate it did not emit.

The same gap covers the merged-destination rule: `edition_units` matching is also `{hash, occurrence}`-keyed, and the shared-destination check (lines 274-285) likewise never exercises a non-zero occurrence. Blast radius: hard refusal at runtime on ordinary input, with a misleading message — and nothing in the test suite would go red when the bug is introduced or reintroduced. Fix: add (a) a positive fixture where two entries share `hash: sha256:u1` at `occurrence: 0` and `occurrence: 1` and assert it *loads*, and (b) a negative that keeps the duplicate case red.

---

### AUDIT-20260728-20 — `source_unit` / `edition_units` element shape is never validated by any test, so a unit reference missing `occurrence` loads as `undefined` and propagates into the fidelity validator

Finding-ID: AUDIT-20260728-20
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/test/ledger-schema.test.ts:5-7 (claimed coverage of "Structural validity rules"), all `coverage:` fixtures

The header claims this suite covers data-model.md's *"Structural validity rules"*, and the refusal tests are thorough at the top level: `version` absent, `version` non-1, `source.identity`, `source.hash`, `voice.identity`, `voice.hash`, `coverage` absent, `op` outside the closed set, `reason` placement, `edition_units` placement and arity. But nothing ever looks *inside* a unit reference. There is no fixture for:

- `source_unit: { hash: sha256:u1 }` — `occurrence` absent
- `source_unit: { occurrence: 0 }` — `hash` absent
- `source_unit: sha256:u1` — a bare scalar instead of a mapping
- an entry with no `source_unit` key at all
- `occurrence: -1`, `occurrence: 1.5`, `occurrence: "0"` — out-of-domain or wrong-typed
- an `edition_units` element missing `hash`

Combine that with the additive-extensibility rule the file's last test proves (unknown keys are accepted and preserved, lines 287-302) and the hole widens: a loader that never descends into `source_unit` passes everything here, and `occurrence: undefined` flows straight into the `{hash, occurrence}` join keys used by unit-accounting (T012) and payload matching (T014). Blast radius: a quietly-wrong join rather than a loud refusal — `undefined === undefined` compares equal, so two distinct malformed references can collapse onto each other, producing a *passing* fidelity verdict on a ledger that never established the disposition. That is the worst class of defect for this feature, whose entire value proposition is that a verdict means something. Fix: add named-refusal fixtures for each shape above; the messages should follow the file's existing convention (`coverage[0].source_unit.occurrence`).

---

### AUDIT-20260728-21 — Type-based source/voice discrimination means a malformed `voice.yaml` is silently reclassified as a second source draft — the refusal then names the wrong files, and no test pins it

Finding-ID: AUDIT-20260728-21 (claude-04 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/test/one-source.test.ts:3-6 (header), :82-120 (test (b))

The header states the discriminator explicitly: *"`parseReviseRequest` … discriminates source vs. voice by TYPE (whatever `loadVoice` accepts is the voice; the request's one remaining non-voice input is the source), so 'exactly one source' really means 'exactly one non-voice input'"* (lines 3-5). That rule has a failure mode the suite never exercises: classification is defined by what `loadVoice` **rejects**, so *any* defect in the voice document reclassifies it as a source draft. An operator who typos `narrator_distance` in `voice.yaml` submits a perfectly ordinary 1-source + 1-voice request and receives `target edition: expected exactly one source draft input, found 2 (draft, voice)` — a refusal that names the correct file count, the wrong cause, and points at `draft.md` as if it were the problem.

Test (b) (lines 82-120) constructs the two-source case with two genuine `.md` drafts and asserts the message names `draft-a` and `draft-b`. It therefore proves the counting logic but says nothing about the far more likely real-world path into that same branch. Symmetrically untested: a source draft that happens to parse as a valid voice document is absorbed as a second voice, and the operator gets a multi-voice refusal instead.

Blast radius is the reason this rates high rather than medium. An unattended agent handed `expected exactly one source draft input, found 2: draft-a, draft-b` will act on the message as written — deleting, renaming, or un-declaring one of the two named inputs — when the actual defect is in a third file the message does not mention. The fix is either a test pinning the diagnostic (a voice input that fails `loadVoice` must surface the *voice-parse* error, not be silently demoted), or a `role:` discriminator on the wire input so classification stops depending on parse success. At minimum this file should carry a fixture for "malformed voice.yaml" and assert the message names `voice` and the parse failure.

---

### AUDIT-20260728-22 — Declared input/artifact hashes are structurally required by the wire guard but never verified against the bytes read from disk

Finding-ID: AUDIT-20260728-22 (claude-01 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:16-31, 41-49, 171-193

`WireBuildInput` carries `{path, hash}` and `isWireBuildInput` hard-requires `hash` to be a non-empty string (`typeof value['hash'] === 'string' && value['hash'].trim().length > 0`). But `runFidelityCli` then reads `fs.readFileSync(sourceInput.path)`, `fs.readFileSync(request.artifact.path)` and `fs.readFileSync(lexiconInput.path)` and passes the bytes straight into `runFidelity` — the declared `hash` fields are never compared against the bytes. The only hash that participates in a decision anywhere in this chunk is the *ledger's* self-declared `source.hash` (`run-support.ts:readDeclaredSourceHash`), which is a different assertion by a different author: it proves ledger↔source agreement, not request↔disk agreement. The `artifact.hash` in particular is checked by nothing at all in this chunk.

Blast radius: the verdict this CLI writes to stdout is consumed by a build system as a verdict *about the artifact the request named by hash*. If the file at `artifact.path` changed between the provider resolving the request and the validator running (a re-render, a concurrent build, a stale working tree, an operator editing the edition in place), the CLI emits `{"state":"passed"}` for bytes that are not the bytes the request declared, and the build system records a fidelity verdict against a hash that was never validated. This is exactly the "verdict attributed to the wrong bytes" class that the ledger-side `source_hash` check exists to prevent — the request side is simply unguarded. A required-but-ignored field is also worse than an absent one: it reads as verified to anyone auditing the wire shape.

Note the commit range contains `c95f991 fix(voice): verify declared input hashes` (AUDIT 12/18/21/07/10), so hash verification may exist on the *revise/provider* side. That does not cover this path: the fidelity CLI is a separately-invoked process reading from disk itself. A reasonable fix is to hash `sourceBytes`/`editionBytes`/the lexicon bytes after each read and refuse (exit 1, named diagnostic, no `ValidateResponse` on stdout) when any digest disagrees with the declared `hash` — and, if verification really is delegated upstream, to say so in a comment at the read site naming the verifying surface, since the current code gives a reader no way to tell the difference between "checked elsewhere" and "forgotten."

### AUDIT-20260728-23 — Unrecognized `inputs` keys are silently dropped, so a mis-keyed `lexicon` degrades validation instead of refusing

Finding-ID: AUDIT-20260728-23
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/cli.ts:51-61, 171-213

`isValidateRequestWire` validates the *shape* of every entry in `inputs` (`Object.values(value['inputs']).every(isWireBuildInput)`) but imposes no key allow-list. `runFidelityCli` then consumes exactly two keys — `request.inputs['source']` and `request.inputs['lexicon']` — and every other declared input is accepted and discarded without a word on stderr. A request declaring `lexicons`, `lexicon.yaml`, `voice_lexicon`, or `quote_bank` is well-formed by this guard and runs to a verdict.

The failure is quiet and directional: it makes validation *weaker*, not louder. With `lexicon` present, `extractPayload(content, lexicon)` (see `run-support.ts:88`) yields `lexiconTerms` that become survival obligations; with `lexicon` silently absent, those obligations vanish and an edition that dropped every lexicon term can reach `{"state":"passed"}`. So a one-character typo in a build config converts a strict validator into a permissive one, and the only externally visible difference is a lower count in a stderr JSON blob nobody diffs. That is precisely the "fallback that hides a failure mode" the project guidelines prohibit — the correct behavior for an unmet dependency here is a refusal, not a downgrade.

Fix: refuse on any key outside the recognized set, naming the offending key (`voice-fidelity: ValidateRequest.inputs.<key> is not a recognized input (expected one of: source, lexicon)`), and add a fixture for it. The channel this opens is worth enumerating in the fixture set: the **value** channel (any unknown key, including near-misses of the known ones), and the **composition** channel (a request declaring both `lexicon` and a misspelled variant — the good one wins silently today, masking the bad one entirely).

### AUDIT-20260728-24 — The AUDIT-20260727-28 fix inverts its own false-clean when zero destinations resolve

Finding-ID: AUDIT-20260728-24
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    voice-tooling/src/fidelity/classify-op-failures.ts:151-180

The fix computes survival against `unionPayload(resolvedDestPayloads)` (line 153) and, when nothing is reported missing, emits the fallback diagnostic at line 178: `...the payload survives across the resolved destinations; the unresolved reference is the fault`. But `resolvedDestPayloads` is built only from destinations that actually resolve (lines 143-149), and nothing requires it to be non-empty. Take the common case: an entry with `op: 'represented'`, a single declared `edition_units` reference, that reference unresolved, and a source unit that is ordinary prose — no quoted spans, no `[PB-###]` markers, no numerics, no lexicon supplied. Then `resolvedDestPayloads` is `[]`, `unionPayload([])` is the empty payload, `missingByKind` is empty for every kind (there was nothing to miss), `reportedGenuineShortfall` stays `false`, and the validator states in writing that the payload survives across the resolved destinations — when zero destinations resolved and the paragraph is simply absent from the edition.

This is the same false-clean the fix was written to remove, inverted: pre-fix the code fabricated a survival *failure*; post-fix it fabricates a survival *success*. The named check still flips (`verbatim_quotes` is added at line 176), so the run does not pass — the blast radius is the diagnosis, not the verdict. That still matters: this report is the machine-readable artifact an unattended agent triages. Told "the payload survives; the unresolved reference is the fault," an agent will go re-derive edition unit identities or patch the ledger reference, when the actual remediation is that source content was dropped from the edition entirely.

A reasonable fix is to branch on `resolvedDestPayloads.length === 0` before the fallback and emit a distinct message for it (`no declared destination resolves to an edition unit; this unit's content is unaccounted for in the edition`), and to reserve the "payload survives" wording for the case where at least one destination resolved. A fixture with a single-destination `represented` entry over payload-free prose whose destination is dangling pins this — the current test set evidently exercises only the sibling-resolves shape the fix targeted.

### AUDIT-20260728-25 — `model_cmd` is parsed off the wire into an executed model command, on a field the schema does not carry and no fixture covers

Finding-ID: AUDIT-20260728-25
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/request.ts:53-65, 141-143

`parseReviseRequest` reads `root['model_cmd']` and, when it is a non-empty string, surfaces it as `ParsedReviseRequest.modelCmd`. The module's own doc comment (lines 53-64) states that the shipped `BuildRequestSchema` in `src/providers/contract.ts` "carries no such field today — every v1 request is `{ version, target, inputs, output_dir }` — so this is always `undefined` in practice; it exists so a future wire extension has somewhere to land." The same comment states `@/revise/model.ts` uses this value (falling back to `VOICE_REVISE_MODEL` only when it is absent). So this is a code path that, by the author's own account, is unreachable through the sanctioned wire, and whose payload is a **command string that gets executed as a subprocess**.

Two distinct problems compound. First, it is speculative dead code with no fixture — the diff's parser has strict validation for `version`, `target`, `output_dir`, and every input, but `model_cmd` gets no shape check beyond "non-empty string", no allow-list, no confinement. Second, enumerating the value channel this opens: `parseReviseRequest` never rejects unknown root keys, so *any* JSON reaching this provider — a hand-written request, a request assembled by a different orchestrator, a mutated file on disk — can inject an arbitrary command that the provider will spawn, silently overriding the operator's `VOICE_REVISE_MODEL`. The override is invisible: nothing logs that the model command came from the request rather than the environment. The blast radius is command execution chosen by request data rather than by operator configuration, on a path that no test exercises because the schema never produces it.

A reasonable fix: delete the `model_cmd` branch entirely (the wire does not carry it, and per project guidelines a missing capability should throw, not be pre-wired), and let `@/revise/model.ts` resolve the command solely from operator configuration. If a request-carried command is genuinely wanted later, it belongs in `BuildRequestSchema` first, with a fixture and an explicit provenance log line.

### AUDIT-20260728-26 — The contract's optional `lexicon` / `quote-bank` input is refused as a duplicate source draft, with an FR-007 diagnosis that misnames the cause

Finding-ID: AUDIT-20260728-26 (claude-02 + codex-01; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    voice-tooling/src/revise/request.ts:26-30, 120-131

The resolver partitions inputs into exactly two buckets: things `loadVoice` accepts (the voice) and everything else (`otherEntries`). It then asserts `otherEntries.length === 1` and reports a violation of "FR-007/D5 (v1 source-locked constraint, T020): a governed target MUST declare EXACTLY ONE source draft" when that fails. But the module's own header comment (lines 26-30) concedes that "an optional `lexicon`/`quote-bank` input may also appear per the contract" and that the only reason this is tolerable is that "the fixture wiring T019 targets never declares one."

That makes the implementation narrower than the contract it implements, and the failure mode is a *misattributed* refusal rather than an honest "unsupported input." An operator who declares `{ draft, voice, quote_bank }` — a shape `contracts/voice-revise-provider.md` permits — gets `target X: expected exactly one source draft input, found 2 (draft, quote_bank) — voice revise cannot tell which one is the source draft`. Read by an operator or by an unattended agent, that says the *target declares two drafts*, i.e. an FR-007 single-source violation to be fixed by removing a draft. The actual cause is that the provider has no discrimination rule for a third input type. An agent acting on that message will edit the profile to drop a legitimate declared input, or will conclude the target is mis-specified when it is not.

The invariant here should be stated positively and enforced positively: *every declared input is classified by type; exactly one must classify as voice and exactly one as source draft; a lexicon/quote-bank classifies as neither and is either consumed or refused by name.* Concretely, add a `lexicon`/`quote-bank` type predicate alongside `loadVoice`, and when an entry matches no known type, refuse with "input `X` matched no known input type (voice / source draft / quote bank)" rather than folding it into the source-draft count. If quote banks are genuinely out of v1 scope, refuse them by name — do not let them masquerade as a second draft.

### AUDIT-20260728-27 — Orchestrator carries two independent notions of "document body" — units derived from raw bytes, payload checks from frontmatter-stripped text

Finding-ID: AUDIT-20260728-27
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:≈127, ≈220, ≈253-256

`runFidelity` derives units from the **raw** carrier bytes — `sourceUnits = deriveUnits(input.source, input.sourceIdentity)` (≈127) and `editionUnits = deriveUnits(input.edition, editionIdentity)` (≈220) — but feeds the citation payload check a **frontmatter-stripped** view of the very same bytes: `const sourceBody = stripFrontmatterBody(sourceText); const editionBody = stripFrontmatterBody(editionText);` (≈255-256), passed to `checkCitations(sourceBody, editionBody, sourceAllowlist)` (≈274). Nothing in this file reconciles the two views, and the file is the only place where both are constructed. Either `deriveUnits` strips frontmatter itself — in which case `stripFrontmatterBody` is a second, independently-maintained answer to "where does the body begin," exactly the duplicate-source-of-truth the `numeric_literals` comment at ≈300 congratulates itself on having eliminated — or it does not, in which case the unit space includes frontmatter lines.

The second horn is the dangerous one, and it lands on the trust anchor. The edition's frontmatter *is* the coverage ledger (`extractLedgerYaml(input.edition)`, ≈118) — content the model under validation authors. If frontmatter lines become edition units, a declared `verbatim` destination can resolve to, and byte-match against, text the model echoed inside its own ledger YAML rather than text that survived into the edition prose. `unit_accounting` and `checkOpObligations` would both report satisfied, `verdict: passed` would be issued, and the one guarantee the feature sells — "this text really survived into the edition" — would be satisfiable by self-declaration. Symmetrically on the source side, frontmatter units would demand ledger dispositions for `citation_allowlist:` lines.

A reasonable fix is to compute the body view **once**, at the top of `runFidelity`, and pass that single value to `deriveUnits` and to `checkCitations` alike — so the orchestrator has exactly one notion of body — and to add a fixture whose edition frontmatter quotes source text verbatim while the prose does not, asserting the run does **not** pass. Absent that fixture, this chunk cannot demonstrate which horn it is on.

---

### AUDIT-20260728-28 — Verdict now derives from the untyped aggregate `failures[]` string array, so any advisory message from any of five producers turns a decided pass into a decided failure

Finding-ID: AUDIT-20260728-28
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/run.ts:≈388-400 (`withholdVerdictOnUnclassifiedFailures`)

The guard fires on `if (computeVerdict({ checks }) === 'passed' && failures.length > 0)`. Its own docblock states the design intent correctly — `computeVerdict` derives the verdict from the named-check map **alone** — and then inverts it: the verdict is now a function of `failures.length`. Auditing this fix as a fresh surface (it is itself the remedy for AUDIT-20260727-18/-29), enumerate the channel it opens on the **value** axis: `failures` is appended by five independent producers — `failures.push(structureFailure)` (≈144), `failures.push(...accountingResult.failures)` (≈210), `failures.push(...opResult.failures.map((f) => f.message))` (≈229), the out-param mutation inside `findUnresolvedDestinationChecks(..., failures)` (≈241-247), and `failures.push(...citationResult.failures)` (≈275). None of them contractually guarantees "non-empty ⇒ blocking." The guard keys on `failures.length`, "never on a specific kind," which is precisely what makes it indiscriminate.

The concrete failure: `checkCitations` returns both `ok` and `failures`, and line ≈331 treats them as independent (`citationOpFailed || !citationResult.ok`). If `checkCitations` ever returns `ok: true` alongside a non-empty `failures` — a report-only or advisory diagnostic, the same report-only shape `uncorroborated_units` already uses at ≈320 — then every named check passes, `failures.length > 0`, and the run is emitted as a **decided failure** whose sole recorded check is `op_obligations: N recorded failure(s) flipped no named check`. A citation advisory is reported to the operator as an op-obligation classification defect. That is a false-red on the trust anchor, plus a mis-blame that will send whoever reads it hunting a nonexistent bug in `classify-op-failures.ts`.

A fix that preserves the intent without the coupling: give the producers a typed channel — carry structured failure records with a `blocking: boolean` (or reuse the structured `kind` `checkOpObligations` already emits per `opResult.failures[].message`) and key the guard on *unclassified blocking* entries, not on raw array length. At minimum, add a fixture in which a producer emits a non-blocking diagnostic on an otherwise-clean run and assert the verdict stays `passed`; today no such fixture is implied by this chunk.

---

### AUDIT-20260728-29 — Chapter ordering is lexicographic on the directory slug, so numbered chapters read out of order

Finding-ID: AUDIT-20260728-29
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/reader/discover.ts:235-241 (`listSubdirectories`), consumed at discover.ts:80 and rendered at render.ts:≈225-233 (chapter chips)

`listSubdirectories` ends with a bare `.sort()`, i.e. default lexicographic UTF-16 ordering, and that order becomes the chapter order in `ReaderModel.chapters` (discover.ts:89, 113) and therefore the left-to-right order of the chapter chips in the generated reader (`chapters.forEach(function(chapter, i){...chapterChips.appendChild(b)})`). For any edition set with more than nine chapters using the obvious slug convention, this is wrong: `chapter-10` sorts before `chapter-2`, and `02-...`/`10-...` only works if the operator happens to zero-pad. Nothing in the layout contract documented at discover.ts:8-9 (`<editionsRoot>/<chapter>/<voice>.md`) tells the operator that zero-padding is load-bearing, and nothing in the code detects or reports the resulting misordering.

Blast radius: the reader is the human-facing artifact for a tool whose entire premise is faithful presentation of a source. A downstream consumer generates a 12-chapter reader, and it silently presents chapters in the order 1, 10, 11, 12, 2, 3… — a wrong output with no error, no warning, and no log line. A reader who doesn't already know the correct order has no way to detect it. This is exactly the "quietly-plausible wrong result an unattended agent would build on" case: an agent generating a reader from a spec would see a green exit and ship it.

Reasonable fix: either (a) make chapter order explicit data rather than an emergent property of filesystem sort — an optional ordering manifest under `editionsRoot`, failing loud when a chapter is present on disk but absent from it — or (b) if slug-derived ordering is genuinely the contract, use a numeric-aware comparator (`localeCompare` with `{numeric: true}`) *and* state the ordering rule in the layout-contract comment at discover.ts:8-9 so the operator knows what the slug controls. Option (a) is preferable per "configuration that should be data ending up as code."

---

### AUDIT-20260728-30 — Client markdown renderer silently degrades every construct it doesn't handle, while the footer asserts verbatim preservation

Finding-ID: AUDIT-20260728-30
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/reader/render.ts:≈173-190 (`render(md)` in `CLIENT_JS`), claim at render.ts:54-61 (`<footer>`)

`render()` recognizes exactly four block shapes — `# `, `## `, a block whose first character is `>`, and "everything else is a paragraph" — and for the paragraph case it does `inline(b.replace(/\n/g,' '))`. Every other markdown construct falls through to that paragraph branch and is displayed as literal source text with newlines collapsed: a bullet list renders as the single run-on line `- first - second - third`; `### Subsection` renders as a paragraph beginning with three hash marks; `**emphasis**`, `` `code` ``, `[link](url)`, tables, thematic breaks, and images all render as raw punctuation. There is no unsupported-construct detection, no warning, no fixture pinning the boundary — the degradation is invisible at generation time and only visible to a human who happens to read the page and know the source.

This matters more here than in a generic markdown viewer because of the claim the same file emits ten lines above the renderer: "every quoted passage, citation, and figure is preserved **verbatim** — only the narration around them is revised" (render.ts:56-58). The pipeline's guarantee is byte-level unit fidelity; the presentation layer then mangles any preserved unit that isn't a plain paragraph, an ATX h1/h2, or a blockquote. A verbatim-preserved list or table displayed as run-on prose falsifies the footer's assertion at the only place a reader can check it. Note also that the sibling work in this feature explicitly shipped golden fixtures pinning "deferred markdown constructs" for `deriveUnits` — the same deferral exists here with no equivalent pin.

Blast radius: an adopter renders an edition set containing any list or `###` heading and publishes a page that misrepresents the source while carrying an explicit fidelity claim. Reasonable fix: have `render()` (or a build-time check in `discoverEditions`) detect block shapes outside the supported set and fail loud at generation time naming the file and the construct, rather than degrading at display time — and pin the supported set with a golden fixture the way `deriveUnits` was pinned. If the constrained subset is genuinely the contract, the footer's verbatim claim needs to be scoped to match, and the supported-construct set needs to be stated in the layout contract at discover.ts:8-9.

---

### AUDIT-20260728-31 — `findEdition` silently substitutes a different voice when the selected voice is missing from a chapter, and clobbers the selection state

Finding-ID: AUDIT-20260728-31
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/reader/render.ts:≈207-213 (`findEdition`), ≈215-218 (`show`)

`ReaderModel.voices` is the union of every voice slug seen across all chapters (discover.ts:103-110), and the client renders one voice chip per entry in that union. But `chapters[i].editions` is per-chapter, and nothing requires it to be complete. When the operator selects a voice a chapter doesn't have, `findEdition` returns `chapter.editions[0]` — a *different voice's* edition — and `show()` then writes that substitution back into state: `state.voiceSlug = edition.voiceSlug` (render.ts:≈218). The chip highlighting follows the substituted slug, so the UI is internally consistent and gives the reader no signal that the requested edition does not exist.

Two consequences compound. First, the reader is shown a different voice's re-narration of the text under a chip they clicked for another voice — for a tool whose subject is *which voice narrates*, that is a silent wrong answer, not a cosmetic glitch. Second, because the fallback overwrites `state.voiceSlug`, the selection is destroyed: select voice X, page to a chapter lacking X, page back, and you are now on `editions[0]` with no memory of X. This is a fallback that hides a failure mode, which project guidelines call out as a bug factory.

Blast radius: any incomplete edition matrix — which is the normal state during incremental generation — produces a reader that misattributes narration. Reasonable fix: make the incompleteness visible instead of papering over it. Either `discoverEditions` should refuse a ragged matrix (every chapter must carry every discovered voice, naming the missing `<chapter>/<voice>.md` paths), or the client should render the missing combination as an explicit "no edition for this voice in this chapter" state, disable/mark the chip for chapters that lack it, and leave `state.voiceSlug` untouched so the selection survives navigation.

---

### AUDIT-20260728-32 — Reader trusts filename voice slug over ledger/voice-document identity

Finding-ID: AUDIT-20260728-32
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/reader/discover.ts:98-157, voice-tooling/src/reader/discover.ts:194-210

`discoverEditions` derives `voiceSlug` solely from the markdown filename at line 98, parses the embedded ledger at lines 144-146, then discards `ledger.voice.identity`. It also loads an optional voice document at lines 196-210 but never checks `voice.id` against the filename slug. That means `chapter-one/plain.md` can carry a ledger for `voice-rich` and the reader will display it as `plain`, or load `voices/plain.yaml` even if that YAML declares a different voice id.

Blast radius is high because the reader is the public inspection surface for machine-produced voice editions: a misnamed or stale artifact will render under the wrong voice label/register while still looking structurally valid. A reasonable repair is to fail loud when `ledger.voice.identity !== voiceSlug` and when a loaded voice document’s `id !== voiceSlug`, naming both paths/identities.

### AUDIT-20260728-33 — `checkSourceCitationAllowlist` throws instead of refusing when a source's `citation_allowlist:`/`sources:` frontmatter is malformed

Finding-ID: AUDIT-20260728-33
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/fidelity/check-ledger-structure.ts:89-107 (call at :94), :150-158, :160-178, :182-199

`checkSourceCitationAllowlist` returns a `CitationAllowlistCheckResult` — the structured "refuse, don't throw" shape the rest of this module uses. Its sibling `checkLedgerStructure` (:39-49) wraps `loadLedger` in `try/catch` precisely so a bad ledger becomes `{ok: false, failure: 'ledger structure: …'}`. But line 94 calls `parseCitationAllowlist(block.yamlText)` completely unguarded, and that path throws on at least four author-reachable inputs: malformed YAML in the frontmatter (`parseYamlText` at :151 raises `YAMLParseError`), `citation_allowlist:` that is a scalar rather than a list (:168), a non-string entry in `citation_allowlist` (:172), `sources:` that is a scalar (:191), and a non-string entry in `sources:` (:195 — e.g. the extremely common `sources: [{id: PB-P056, title: …}]` object shape). Every one of these is a *source-document authoring mistake*, i.e. exactly the class of input the validator exists to refuse with a name.

This directly regresses the invariant established by commit c95f991 ("validator refuses (not throws) on bad source/request"). Blast radius: a corpus author writes `citation_allowlist: "[^1]"` (scalar instead of list — a one-character YAML slip) and instead of a named refusal naming the offending file and key, the validator's own error path fires. Combined with the shims having no top-level `try/catch` (finding -03), the consumer sees a raw Node stack trace and exit 1 with no verdict record — indistinguishable, to an unattended caller, from the tool being broken. Worse, if some caller in `@/fidelity/run.ts` catches broadly and treats an exception as "cannot decide", a bad allow-list becomes a *soft* outcome rather than the refusal FR-023 requires.

Fix: wrap the `parseCitationAllowlist` call (and the `decodeText`/`extractFrontmatterBlock` pair) in `checkSourceCitationAllowlist` in the same `try/catch → {ok: false, failure: …}` shape `checkLedgerStructure` already uses, preserving the thrown message as the failure text. The helper functions can keep throwing — they are internal — but the exported check function must not leak the exception past its documented result contract. Add fixtures for each of the five throwing inputs above; none currently exists in the visible test list.

### AUDIT-20260728-34 — An unclosed code fence collapses the entire remainder of the document into one source unit

Finding-ID: AUDIT-20260728-34
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/units/derive.ts:116-151 (`groupUnits`), 160-172 (`fenceMarker`)

`groupUnits` tracks fence state in a single `fenceChar` variable that is only cleared by a matching closing fence line (lines 134-138). If the source draft contains an opening fence that is never closed — a stray ` ``` ` line, a `~~~` used as a decorative divider, a truncated paste, a fence whose closer was accidentally deleted — `fenceChar` stays non-null for every subsequent line, so `isSeparator` is never consulted again (line 143) and every blank line for the rest of the document stops separating units. The whole tail of the draft becomes a single `SourceUnit`.

The blast radius is the coverage guarantee itself, not a crash. The mechanism's premise is that each paragraph-sized unit gets exactly one declared disposition, so a validator can prove nothing was silently dropped. With one giant tail unit, a model can discharge the entire back half of a document with a single `represented` entry pointing at one edition unit — the ledger validates, `checkNoDuplicateDisposition` is satisfied, unit accounting is complete, and the per-paragraph accountability that justifies a "faithful" verdict has quietly evaporated. This failure is silent: nothing in `deriveUnits` reports "I ended inside an open fence." Note the deliberate asymmetry with `stripLeadingFrontmatter` (lines 107-109), which explicitly handles "no closing delimiter → strip nothing" — the same defensive posture was not applied to fences.

A reasonable fix: track the opening-fence line index, and on exhausting `lines` with `fenceChar !== null`, either throw naming the unterminated fence's line number, or re-derive treating the unclosed fence as ordinary content. Either is defensible; silently swallowing is not. Add a fixture for an unterminated fence followed by two blank-line-separated paragraphs and pin which unit count is correct.

---

### AUDIT-20260728-35 — `target` can escape `output_dir`

Finding-ID: AUDIT-20260728-35
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    voice-tooling/src/revise/emit.ts:43-45

`emitEdition` turns the request target directly into a relative path with ``const outputPath = `${target}.md`;`` and then joins it to `outputDir`. A target such as `../outside/episode` produces `../outside/episode.md`, so `path.join(outputDir, outputPath)` writes outside the declared artifact directory and the `BuildResponse` also declares an escaping output path. `runReviseCli` passes `parsed.target` straight through at `cli.ts:110`, and the adjacent request parser only requires a non-empty string.

The blast radius is high because an adopter running this provider can get filesystem writes and output declarations outside the governed build output root. A reasonable fix is to validate `target` as a safe target id or basename before emission, and also assert the resolved output path stays under `outputDir` and the declared response path contains no path traversal or absolute-path form.

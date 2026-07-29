/**
 * T022 (spec 006, US4/TASK-50): a deterministic `voice-revise` model stub
 * whose FIRST coverage entry declares `op: 'verbatim'` but whose destination
 * edition unit's bytes DIFFER from the source unit it claims to reproduce
 * byte-exact. This is the empirically-observed defect TASK-50 names (full-
 * ebook 8-voice run: 2/56 editions refused by `voice fidelity` for exactly
 * this reason -- ".stack-control/backlog/tasks/task-50 -
 * voice-revise-alters-verbatim-declared-units.md").
 *
 * Ignores the prompt on stdin entirely (the fixture response is fixed, not
 * prompt-derived -- mirrors `test/fixtures/spine/compose-stub-runner.ts`'s own
 * design). Paired with `test/fixtures/sources/basic-lf.md` (source unit 0:
 * "Alpha beta.", source unit 1: "Gamma delta."): unit 0's declared verbatim
 * destination drifts; unit 1's is byte-exact, so the fixture isolates the
 * DRIFT fault on a single unit rather than making every unit non-conformant.
 *
 * The producer's pre-emit self-check (`@/revise/preflight.ts`, T023 -- NOT
 * YET IMPLEMENTED as of this fixture's authoring, T022) must catch this drift
 * via the shared `@/policy/op-legality.ts#checkOpLegality('revise', ...)`
 * predicate and REFUSE before any write, naming the drifted unit.
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors `compose-whole-unit-copy-runner.ts` / `compose-stub-runner.ts`.
 */

interface ReviseResponse {
  edition: string;
  coverage: Array<{ op: 'verbatim'; edition_units: number[] }>;
}

// Unit 1 ("Gamma delta.\n") is reproduced byte-exact, INCLUDING its trailing
// newline -- `deriveUnits` keeps original terminators (D6.3/D6.7), so a
// missing trailing "\n" here would spuriously drift unit 1 too, muddying the
// isolation this fixture exists to provide (only unit 0 should drift).
const response: ReviseResponse = {
  edition: 'This is not Alpha beta at all -- the wording drifted.\n\nGamma delta.\n',
  coverage: [
    { op: 'verbatim', edition_units: [0] },
    { op: 'verbatim', edition_units: [1] },
  ],
};

process.stdout.write(JSON.stringify(response));

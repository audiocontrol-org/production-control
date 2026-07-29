/**
 * T022 (spec 006, US4/TASK-50): the non-regression counterpart to
 * `verbatim-drift-runner.ts` -- a deterministic `voice-revise` model stub
 * whose `op: 'verbatim'` destinations are ALL byte-exact to the source units
 * they claim to reproduce (paired with `test/fixtures/sources/basic-lf.md`:
 * "Alpha beta." and "Gamma delta.", reproduced unchanged). This is the
 * ordinary, LEGAL revise shape verbatim was always meant to allow -- the
 * producer's pre-emit self-check (T023) must accept it exactly as it does
 * today, emitting the edition normally.
 *
 * Ignores the prompt on stdin entirely (the fixture response is fixed, not
 * prompt-derived -- mirrors `compose-stub-runner.ts`'s own design).
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE.
 */

interface ReviseResponse {
  edition: string;
  coverage: Array<{ op: 'verbatim'; edition_units: number[] }>;
}

// Reproduces `test/fixtures/sources/basic-lf.md`'s body BYTE-EXACT, including
// each unit's own trailing newline (D6.3/D6.7) -- so both derived edition
// units are content-hash-identical to their source units.
const response: ReviseResponse = {
  edition: 'Alpha beta.\n\nGamma delta.\n',
  coverage: [
    { op: 'verbatim', edition_units: [0] },
    { op: 'verbatim', edition_units: [1] },
  ],
};

process.stdout.write(JSON.stringify(response));

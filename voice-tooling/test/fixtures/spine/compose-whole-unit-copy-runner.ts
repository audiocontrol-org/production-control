/**
 * T021 (spec 006, US3): a deterministic compose model stub whose FIRST edition
 * unit is a byte-for-byte COPY of the first source beat (minimal-spine.md's
 * "The research team measured soil composition at 3 locations[^study]."). Its
 * grounding is exhaustive + exclusive (1:1) so the grounding half of the
 * producer pre-emit self-check PASSES -- isolating the whole-unit no-copy rule
 * (R4). The producer's pre-emit self-check (`@/revise/preflight.ts`) must catch
 * the whole-unit copy and REFUSE before any write (Principle V), naming it.
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors `compose-stub-runner.ts` / `compose-missing-grounding-runner.ts`.
 */

interface ComposeResponse {
  edition: string;
  coverage: Array<{ op: 'represented' | 'merged'; edition_units: number[] }>;
  grounding: Array<{ edition_unit: number; basis: 'grounded'; beats: number[] }>;
}

// Edition unit 0 is byte-identical to source beat 0 (a whole-unit copy);
// units 1 and 2 are genuinely rewritten (not copies).
const response: ComposeResponse = {
  edition: [
    'The research team measured soil composition at 3 locations[^study].',
    '',
    'Localized findings were rewritten and expanded distinctly here.',
    '',
    'Consistency with the earlier 1995 baseline, freshly rephrased.',
  ].join('\n'),
  coverage: [
    { op: 'represented', edition_units: [0] },
    { op: 'represented', edition_units: [1] },
    { op: 'represented', edition_units: [2] },
  ],
  grounding: [
    { edition_unit: 0, basis: 'grounded', beats: [0] },
    { edition_unit: 1, basis: 'grounded', beats: [1] },
    { edition_unit: 2, basis: 'grounded', beats: [2] },
  ],
};

process.stdout.write(JSON.stringify(response));

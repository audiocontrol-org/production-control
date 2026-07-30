/**
 * FG-B / D1 (spec 006, AUDIT-11/12/19): a deterministic compose model stub whose
 * coverage declares an illegal `cut` op for one beat. Compose forbids `cut`
 * MECHANICALLY (op is NEVER "verbatim", NEVER "cut"), so the producer's PRE-EMIT
 * self-check (`@/revise/preflight.ts`) must refuse before any write (Principle V),
 * naming the forbidden op -- an illegal-op compose edition must NOT be written.
 *
 * The grounding is exhaustive + exclusive + coverage-consistent so grounding does
 * NOT refuse first: the ONLY refusal isolated here is `compose-forbids-cut`.
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors `compose-whole-unit-copy-runner.ts`.
 */

interface CoverageEntry {
  op: 'represented' | 'merged' | 'verbatim' | 'cut';
  edition_units?: number[];
  reason?: string;
}
interface GroundingEntry {
  edition_unit: number;
  basis: 'grounded' | 'connective' | 'framing';
  beats?: number[];
}
interface ComposeResponse {
  edition: string;
  coverage: CoverageEntry[];
  grounding: GroundingEntry[];
}

// minimal-spine.md derives to 3 beats. Beat 1 is CUT (forbidden in compose); the
// two edition units are genuine re-voicings (not copies), grounded on beats 0 & 2.
const response: ComposeResponse = {
  edition: [
    "Across three carefully chosen sites, the team assayed how the soil was composed[^study].",
    '',
    'Those measurements matched the earlier 1995 record, reassuringly.',
  ].join('\n'),
  coverage: [
    { op: 'represented', edition_units: [0] },
    { op: 'cut', reason: 'redundant local note cut for brevity' },
    { op: 'represented', edition_units: [1] },
  ],
  grounding: [
    { edition_unit: 0, basis: 'grounded', beats: [0] },
    { edition_unit: 1, basis: 'grounded', beats: [2] },
  ],
};

process.stdout.write(JSON.stringify(response));

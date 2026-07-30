/**
 * FG-B / D1 (spec 006, AUDIT-11/12/19): a deterministic compose model stub whose
 * coverage declares an illegal `verbatim` op for one beat. Compose forbids
 * `verbatim` MECHANICALLY (there is no "verbatim" op in compose mode), so the
 * producer's PRE-EMIT self-check (`@/revise/preflight.ts`) must refuse before any
 * write (Principle V), naming the forbidden op -- an illegal-op compose edition
 * must NOT be written.
 *
 * The grounding is exhaustive + exclusive + coverage-consistent so grounding does
 * NOT refuse first, and every edition unit is a genuine re-voicing (no whole-unit
 * copy), so the ONLY refusal isolated here is `compose-forbids-verbatim`.
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

// minimal-spine.md derives to 3 beats. Beat 0 is VERBATIM (forbidden in compose);
// all three edition units are genuine re-voicings (not copies), grounded 1:1.
const response: ComposeResponse = {
  edition: [
    "Across three sites, the team assessed the soil's makeup[^study].",
    '',
    'Nearby signs hinted that a closer look was warranted. [OPEN-QUESTION: What caused the anomaly in sample 2?]',
    '',
    'The outcome lined up with the 1995 findings from before.',
  ].join('\n'),
  coverage: [
    { op: 'verbatim', edition_units: [0] },
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

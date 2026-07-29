/**
 * Deterministic model stub for compose fixtures.
 * Returns a fixed response matching the voice-compose-cli.md model protocol shape.
 *
 * For testing purposes: 3 source beats → 3 edition units
 * All grounded (1:1 mapping for simplicity)
 */

export interface ComposeResponse {
  edition: string;
  coverage: Array<{
    op: 'represented' | 'merged';
    edition_units: number[];
  }>;
  grounding: Array<{
    edition_unit: number;
    basis: 'grounded' | 'connective' | 'framing';
    beats?: number[];
  }>;
}

export function composeStub(): ComposeResponse {
  return {
    edition: `The research team conducted soil composition analysis at 3 distinct locations using standardized protocols[^study].

Localized observations indicated unexpected variations warranting deeper investigation. What caused the anomaly in sample 2?

Measured results aligned with established 1995 baseline findings, demonstrating consistency across decades.`,
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
}

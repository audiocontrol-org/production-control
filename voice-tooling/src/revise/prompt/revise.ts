import type { ModelInput } from './types.ts';
import { numberSourceUnits, formatVoiceDirectives } from './types.ts';

/**
 * TASK-29 (extracted from `@/revise/model.ts` by T003) + TASK-50 (hardened):
 * the revise PROMPT sent to the model on stdin. The source is presented as
 * NUMBERED UNITS (exact bytes between per-unit markers) so the model's
 * `coverage` array aligns one entry per source unit, in order. The prompt
 * states the voice directives, the fidelity contract, and the required
 * `ModelReviseOutput` JSON output shape.
 *
 * TASK-50 hardening: the fidelity contract now states explicitly that a
 * `verbatim` coverage op declares its destination edition unit BYTE-EXACT to
 * the source unit itself (not merely that quoted/cited/numeric payloads
 * survive) -- this is the contract `revise/preflight.ts`'s pre-emit
 * self-check re-derives and enforces mechanically before any write.
 */
export function buildRevisePrompt(input: ModelInput): string {
  const numbered = numberSourceUnits(input, 'SOURCE UNIT');
  const voice = input.voice.doc;
  const directives = formatVoiceDirectives(voice);

  return [
    'You are rewriting the narration of a SOURCE draft into a given VOICE, producing a',
    'faithful voice edition. Revise the surrounding narration -- paragraphing, transitions,',
    'exposition -- while preserving every quoted, cited, and numeric payload byte-for-byte.',
    '',
    `TASK: rewrite the source below in the voice "${voice.label}" (${voice.id}).`,
    '',
    'VOICE DIRECTIVES:',
    directives,
    '',
    'FIDELITY CONTRACT (the edition MUST satisfy this):',
    '- Every blockquote and quoted span, every citation marker (e.g. [PB-P056] and [^1]), and',
    '  every numeral in a source unit MUST survive VERBATIM (byte-exact) into that unit\'s',
    '  declared destination edition unit(s).',
    '- A coverage entry with op "verbatim" declares something stronger than payload survival:',
    '  it declares that unit\'s ENTIRE destination edition unit is BYTE-EXACT to the source unit',
    '  -- byte-for-byte identical, not paraphrased, not reformatted. Only use "verbatim" when the',
    '  destination is a true byte-exact copy of the source unit; otherwise use "represented" or',
    '  "merged".',
    '- You MAY revise the surrounding narration, but NOT the quoted/cited/numeric payload.',
    '- Account for EVERY source unit with exactly one disposition, in source order.',
    '- Do not add or drop a blockquote/citation/numeral relative to what the disposition claims.',
    '',
    'SOURCE (numbered units, exact bytes between the [SOURCE UNIT n] ... [/SOURCE UNIT n] markers):',
    numbered,
    '',
    'OUTPUT FORMAT: output ONLY a JSON object of the form',
    '  {',
    '    "edition": "<the full revised markdown body>",',
    '    "coverage": [ { "op": "verbatim|represented|merged|cut", "edition_units": [<0-based indices>] } ]',
    '  }',
    'where:',
    '- "edition" is the full revised body, each edition unit SEPARATED BY A BLANK LINE, in reading',
    '  order, so edition unit indices are unambiguous.',
    '- "coverage" has EXACTLY ONE entry per source unit, in source order. For a non-cut op, give',
    '  "edition_units" as the 0-based indices (into the edition units you wrote) the source unit',
    '  lands in. For "cut", omit "edition_units" and give a non-empty "reason" instead.',
    '',
  ].join('\n');
}

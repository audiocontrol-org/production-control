import type { ModelInput } from './types.ts';
import { numberSourceUnits, formatVoiceDirectives } from './types.ts';

/**
 * T003 (spec 006): the compose PROMPT sent to the model on stdin. Per
 * specs/006-voice-compose-from-spine/contracts/voice-compose-cli.md
 * ("Model protocol (compose)"), the spine is presented as NUMBERED BEATS
 * (exact bytes between per-unit markers -- beats ARE source units, see
 * data-model.md "Spine / Beat") and the model must EXPAND each beat into full
 * voiced prose, never reproduce a beat verbatim or cut one, and return a
 * `grounding` declaration alongside `edition`/`coverage`.
 *
 * The mechanical enforcement of these rules (op-legality, whole-unit no-copy,
 * grounding exhaustiveness/exclusivity) lives in `policy/op-legality.ts` and
 * `policy/grounding.ts` (producer pre-emit self-check + validator); this
 * prompt only STATES the contract to the model -- producer success grants the
 * validator nothing (Principle VI).
 */
export function buildComposePrompt(input: ModelInput): string {
  const numbered = numberSourceUnits(input, 'BEAT');
  const voice = input.voice.doc;
  const directives = formatVoiceDirectives(voice);

  return [
    'You are composing a full narrative chapter in a given VOICE by EXPANDING a structured,',
    'source-cited SPINE of beats into voiced prose. The spine below is a sequence of numbered',
    'BEATS -- exact bytes between markers -- each beat carrying citation markers, numerals, and',
    'quoted spans that anchor the composition to its evidence.',
    '',
    `TASK: expand the spine below into a composed chapter in the voice "${voice.label}" (${voice.id}).`,
    '',
    'VOICE DIRECTIVES:',
    directives,
    '',
    'COMPOSITION CONTRACT (the edition MUST satisfy this):',
    '- EXPAND every beat into full voiced prose. A beat is a compressed note, not a paragraph you',
    '  copy in -- narrate it, connect it to what surrounds it, and voice it in full sentences.',
    '- Do NOT reproduce a beat verbatim: no destination edition unit may be a whole-unit copy of',
    '  the beat it represents. Compose forbids verbatim reproduction entirely -- there is no',
    '  "verbatim" op in compose mode, and the op is NEVER "verbatim" and NEVER "cut" for any beat.',
    '- Every citation marker (e.g. [PB-P056] and [^1]) and every numeral in a beat MUST still',
    '  survive BYTE-EXACT into that beat\'s destination edition unit(s), even though the',
    '  surrounding prose around it is fully rewritten.',
    '- Preserve every [OPEN-QUESTION: ...] marker byte-exact -- do not resolve it, remove it, or',
    '  alter its text; it stays exactly as written in the beat that carries it.',
    '- Invent nothing beyond the beats: every promotional, evaluative, or defense claim you add',
    '  must be an ATTRIBUTED assertion traceable to a beat. Never fabricate a fact, a source, or',
    '  a claim the beats do not support.',
    '- Account for EVERY beat with exactly one coverage entry, in beat order. The op MUST be',
    '  "represented" or "merged" only -- NEVER "verbatim", NEVER "cut".',
    '- For EVERY edition unit you write, declare exactly one grounding record naming its',
    '  "basis": "grounded" (cite the 0-based beat indices it is grounded in, via "beats"),',
    '  "connective" (transitional prose with no direct beat grounding), or "framing"',
    '  (introductory/closing narration that frames the chapter, not itself a beat).',
    '',
    'SPINE (numbered beats, exact bytes between the [BEAT n] ... [/BEAT n] markers):',
    numbered,
    '',
    'OUTPUT FORMAT: output ONLY a JSON object of the form',
    '  {',
    '    "edition": "<the full composed markdown body>",',
    '    "coverage": [ { "op": "represented|merged", "edition_units": [<0-based indices>] } ],',
    '    "grounding": [',
    '      { "edition_unit": <0-based index>, "basis": "grounded", "beats": [<0-based beat indices>] },',
    '      { "edition_unit": <0-based index>, "basis": "connective|framing" }',
    '    ]',
    '  }',
    'where:',
    '- "edition" is the full composed body, each edition unit SEPARATED BY A BLANK LINE, in',
    '  reading order, so edition unit indices are unambiguous.',
    '- "coverage" has EXACTLY ONE entry per beat, in beat order; op is "represented" or "merged"',
    '  -- never "verbatim", never "cut".',
    '- "grounding" has EXACTLY ONE entry per edition unit you wrote, in edition order. "beats" is',
    '  required and non-empty only when "basis" is "grounded"; omit it for "connective" or',
    '  "framing" entries.',
    '',
  ].join('\n');
}

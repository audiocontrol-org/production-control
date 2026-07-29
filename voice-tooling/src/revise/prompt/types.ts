import { deriveUnits } from '@/units/derive.ts';
import type { VoiceDocument } from '@/schema/voice.ts';

/**
 * TASK-... (spec 006): the producer operation, chosen at the CLI verb and
 * stamped in the ledger's `mode` field (see data-model.md "Mode"). Shared by
 * both prompt bodies (`./compose.ts`, `./revise.ts`) and by `@/revise/model.ts`,
 * which threads it through to `buildPrompt`.
 */
export type ProducerMode = 'compose' | 'revise';

/**
 * What a mode's prompt body is built from: the source text (a revise draft, or
 * -- for compose -- a source-cited spine of beats) and the voice's directives.
 * Shared shape across modes: compose reuses the same source-side unit
 * derivation as revise (the beats ARE source units; see data-model.md
 * "Spine / Beat").
 */
export interface ModelInput {
  readonly target: string;
  readonly source: {
    readonly identity: string;
    readonly text: string;
  };
  readonly voice: {
    readonly identity: string;
    readonly doc: VoiceDocument;
  };
}

/** Per-unit delimiter markers -- machine-parseable so a deterministic stub can round-trip them. */
export const unitOpenMarker = (label: string, index: number): string => `[${label} ${index}]`;
export const unitCloseMarker = (label: string, index: number): string => `[/${label} ${index}]`;

/**
 * Present `input.source.text`'s derived units as NUMBERED units under `label`
 * (e.g. "SOURCE UNIT" for revise, "BEAT" for compose) -- exact bytes between
 * per-unit markers, in source order, so a mode's `coverage`/`grounding` arrays
 * can address units by 0-based index unambiguously.
 */
export function numberSourceUnits(input: ModelInput, label: string): string {
  const units = deriveUnits(input.source.text, input.source.identity);
  return units
    .map(
      (unit, index) =>
        `${unitOpenMarker(label, index)}\n${unit.content}${unitCloseMarker(label, index)}`,
    )
    .join('\n');
}

/** Format a voice document's directives as a bullet list for a prompt body. */
export function formatVoiceDirectives(voice: VoiceDocument): string {
  return [
    `- narrator_distance: ${voice.narrator_distance}`,
    `- evidence_posture: ${voice.evidence_posture}`,
    `- sentence_movement: ${voice.sentence_movement}`,
    `- paragraph_movement: ${voice.paragraph_movement}`,
    `- transitions: ${voice.transitions}`,
    `- emotional_temperature: ${voice.emotional_temperature}`,
    `- quote_handling: ${voice.quote_handling}`,
    `- avoid: ${voice.avoid.join('; ')}`,
  ].join('\n');
}

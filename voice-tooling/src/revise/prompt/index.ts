import type { ModelInput, ProducerMode } from './types.ts';
import { buildComposePrompt } from './compose.ts';
import { buildRevisePrompt } from './revise.ts';

export type { ModelInput, ProducerMode } from './types.ts';

/**
 * T003 (spec 006): the mode-keyed prompt module's single entry point. Returns
 * the prompt body for the given producer `mode` -- `compose` (expand a spine
 * of beats into voiced prose; see `./compose.ts`) or `revise` (rewrite a
 * draft's narration in a voice; see `./revise.ts`). `@/revise/model.ts`
 * delegates its prompt construction here rather than holding prompt bodies
 * inline, keeping the impure model-call shell separate from the (pure,
 * mode-specific) prompt content and under the file-size ceiling.
 *
 * @throws Error naming the mode when `mode` is outside the closed
 *   `ProducerMode` set -- never falls back to either prompt body.
 */
export function buildPrompt(mode: ProducerMode, input: ModelInput): string {
  switch (mode) {
    case 'compose':
      return buildComposePrompt(input);
    case 'revise':
      return buildRevisePrompt(input);
    default: {
      const exhaustive: never = mode;
      throw new Error(`voice: unknown producer mode "${String(exhaustive)}"`);
    }
  }
}

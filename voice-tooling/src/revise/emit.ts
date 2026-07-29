import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProducerMode } from '@/revise/prompt/types.ts';

/**
 * T019: assemble the `BuildResponse` (contracts/voice-revise-provider.md
 * "Output") and write the edition as the sole declared output.
 *
 * `voice-tooling` never imports production-control's own `BuildResponse` zod
 * schema (same package-boundary discipline as `@/revise/request.ts` — the
 * subprocess wire is a plain JSON shape, not a shared TypeScript type), so
 * this returns a plain object matching `BuildResponseSchema`
 * (`src/providers/contract.ts`) by hand.
 *
 * spec 006 (T012): the SAME emitter serves both producer verbs -- `tool.name`
 * and `impure.reason` are keyed by the caller's `mode` so a `voice compose`
 * build's `BuildResponse` names itself honestly, while `voice revise`'s
 * behavior stays byte-identical to before this task.
 */

/** `tool.name` per producer mode -- names the verb that actually ran (FR-005). */
const TOOL_NAME: Record<ProducerMode, string> = {
  revise: 'voice-revise',
  compose: 'voice-compose',
};

/**
 * The provider is never referentially transparent (FR-005): the SAME reason
 * every build of a given mode declares, since a model call is inherently
 * non-deterministic regardless of which model command produced this run.
 */
const IMPURE_REASON: Record<ProducerMode, string> = {
  revise: 'voice revision is a model-driven narration rewrite; the producer is non-deterministic',
  compose:
    'voice composition is a model-driven expansion of a spine into voiced prose; the producer is non-deterministic',
};

export interface ReviseBuildResponse {
  readonly version: 1;
  readonly outputs: readonly [{ readonly path: string }];
  readonly tool: { readonly name: string; readonly version: string };
  readonly impure: { readonly reason: string };
}

/**
 * Write `editionText` to `outputDir` as `<target>.md` and return the
 * `BuildResponse`.
 *
 * Per the contract's "What the provider does NOT do": `validation` is always
 * omitted (D3/FR-005) — this provider reports no verdict of its own; the
 * paired `voice fidelity` validator is the sole arbiter of acceptance.
 *
 * @throws Error naming the cause if the edition cannot be written to disk.
 */
export async function emitEdition(
  outputDir: string,
  target: string,
  editionText: string,
  toolVersion: string,
  mode: ProducerMode,
): Promise<ReviseBuildResponse> {
  const outputPath = `${target}.md`;
  const fullPath = path.join(outputDir, outputPath);
  const toolName = TOOL_NAME[mode];

  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(fullPath, editionText, 'utf8');
  } catch (cause) {
    throw new Error(
      `${toolName}: could not write the edition to "${fullPath}": ${describeError(cause)}`,
      { cause },
    );
  }

  return {
    version: 1,
    outputs: [{ path: outputPath }],
    tool: { name: toolName, version: toolVersion },
    impure: { reason: IMPURE_REASON[mode] },
  };
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

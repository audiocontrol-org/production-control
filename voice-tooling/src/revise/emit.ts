import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * T019: assemble the `BuildResponse` (contracts/voice-revise-provider.md
 * "Output") and write the edition as the sole declared output.
 *
 * `voice-tooling` never imports production-control's own `BuildResponse` zod
 * schema (same package-boundary discipline as `@/revise/request.ts` — the
 * subprocess wire is a plain JSON shape, not a shared TypeScript type), so
 * this returns a plain object matching `BuildResponseSchema`
 * (`src/providers/contract.ts`) by hand.
 */

/**
 * The provider is never referentially transparent (FR-005): the SAME reason
 * every build declares, since a model call is inherently non-deterministic
 * regardless of which model command produced this particular run.
 */
const IMPURE_REASON =
  'voice revision is a model-driven narration rewrite; the producer is non-deterministic';

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
): Promise<ReviseBuildResponse> {
  const outputPath = `${target}.md`;
  const fullPath = path.join(outputDir, outputPath);

  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(fullPath, editionText, 'utf8');
  } catch (cause) {
    throw new Error(
      `voice-revise: could not write the edition to "${fullPath}": ${describeError(cause)}`,
      { cause },
    );
  }

  return {
    version: 1,
    outputs: [{ path: outputPath }],
    tool: { name: 'voice-revise', version: toolVersion },
    impure: { reason: IMPURE_REASON },
  };
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Output-root routing for content classes.
 *
 * Centralizes the two output-root strings so callers (e.g. `providers/build.ts`) never hardcode
 * them: impure (non-reproducible) output roots under the dot-zoned `.ai/`
 * (AI-permitted per `classifyZone`), pure (reproducible) output stays under `dist/`.
 */

/** The output root for impure (non-reproducible) build output. Dot-zoned so
 * `classifyZone` reads it as AI-permitted (FR-007/FR-008). */
export function impureOutputRoot(): string {
  return '.ai';
}

/** The output root for pure (reproducible) build output. Gitignored, not dot-zoned. */
export function pureOutputRoot(): string {
  return 'dist';
}

import { z } from 'zod';
import { HashSchema, IdentitySchema, RelativePathSchema } from '@/manifest/schema.js';

/**
 * The provider contract's wire types (contracts/provider.md).
 *
 * A provider is any program that turns local input files into local output files. It is
 * invoked as a subprocess and speaks JSON over stdio — it is not a plugin, not a Node
 * module, and not aware of production-control. These schemas are the whole of what crosses
 * that boundary, which is why they live apart from the runner that spawns it: parsing a
 * BuildResponse must not require the ability to execute anything.
 *
 * Every schema refusal names the offending field (FR-036) — see `formatResponseError`.
 */

/**
 * A single input, **already resolved to a local path** by production-control before the
 * provider is invoked (FR-030). The `hash` is supplied so a provider MAY verify what it
 * received; it is never something the provider must fetch. This is the point of the
 * contract: providers never touch object storage and never hold credentials, which is what
 * keeps every provider runnable by hand (FR-031).
 */
export const BuildInputSchema = z.object({
  path: z.string().min(1, 'must be a non-empty local path'),
  hash: HashSchema,
});

/**
 * `version` is `z.literal(1)`: an unknown version is a refusal, never a best-effort parse
 * (FR-005), matching every other versioned schema in the system.
 */
export const BuildRequestSchema = z.object({
  version: z.literal(1),
  target: IdentitySchema,
  inputs: z.record(IdentitySchema, BuildInputSchema),
  output_dir: z.string().min(1, 'must be a non-empty local path'),
});

/**
 * A single declared output. `path` is relative to the request's `output_dir`, and the schema
 * ENFORCES that relativity rather than merely asserting it in a message: `RelativePathSchema`
 * refuses an absolute path or one that traverses out with `..`, so a provider cannot declare an
 * output that escapes `output_dir` and later escapes `dist/` at ingest (FR-036).
 */
export const BuildOutputSchema = z.object({
  path: RelativePathSchema,
});

/**
 * Name and version of the producing tool, recorded in the ledger for drift reporting
 * (FR-016). Reported by the provider — unlike the output hashes, which production-control
 * computes itself, because the provider is disposable and the record must not depend on its
 * honesty.
 */
export const BuildToolSchema = z.object({
  name: z.string().min(1, 'must be a non-empty tool name'),
  version: z.string().min(1, 'must be a non-empty tool version'),
});

/**
 * `impure` is an OPTIONAL OBJECT carrying a reason, never a bare boolean (FR-032), mirroring
 * `ProviderDecl.impure` and `ArtifactRecord.producer_impure`.
 *
 * The reason is not paperwork. `impure: true` says only "do not expect the same bytes twice."
 * A reason says *which kind* of impurity — a font fetch is incidental and fixable by
 * vendoring; a model call is inherent and permanent; a clock in a filename is a bug someone
 * should just fix. A reader deciding whether to trust, cache, or repair an artifact needs to
 * know which. Same logic as requiring a reason on a waiver: without one it is not a decision,
 * just a flag.
 *
 * Consequently a bare `impure: false` is a REFUSAL rather than a synonym for absence. The
 * contract spells the "referentially transparent" case as *omitting* the field, and accepting
 * the boolean would re-admit the flag-shaped impurity FR-032 exists to forbid — one release
 * later, `impure: true` would be arriving with nothing to say.
 *
 * `reason` is refused when empty OR whitespace-only, by the SAME trimmed refinement `WaiverSchema`
 * uses (`src/ledger/schema.ts`), so a declared impurity and a waived review behave identically
 * (FR-032/FR-022b, AUDIT-20260716-17). A bare `.min(1)` would let `"   "` through — three spaces
 * state no more than the empty string does — so the check trims before measuring.
 */
export const BuildImpureSchema = z.object({
  reason: z
    .string()
    .refine((value) => value.trim().length > 0, 'reason must not be empty or whitespace-only'),
});

/**
 * The provider's own verdict on what it produced. Optional, and its absence is meaningful
 * (FR-006b): absent = not yet validated, distinct from both `passed` and `failed`. Binary for
 * this version — no severity gradation, no non-blocking warning.
 */
export const BuildValidationSchema = z.object({
  state: z.enum(['passed', 'failed']),
});

/**
 * `outputs` MUST be non-empty. Exit 0 with no outputs is failure, not success — "silence is
 * failure" (FR-033, contract Rule 7). An empty success recorded as success is exactly the
 * false-clean the ledger exists to prevent, so the refusal lives in the schema itself rather
 * than in a caller who might forget to check.
 */
export const BuildResponseSchema = z.object({
  version: z.literal(1),
  outputs: z
    .array(BuildOutputSchema)
    .min(1, 'must be non-empty — exit 0 with no outputs is failure ("silence is failure")'),
  tool: BuildToolSchema,
  impure: BuildImpureSchema.optional(),
  validation: BuildValidationSchema.optional(),
});

export type BuildInput = z.infer<typeof BuildInputSchema>;
export type BuildRequest = z.infer<typeof BuildRequestSchema>;
export type BuildOutput = z.infer<typeof BuildOutputSchema>;
export type BuildTool = z.infer<typeof BuildToolSchema>;
export type BuildImpure = z.infer<typeof BuildImpureSchema>;
export type BuildValidation = z.infer<typeof BuildValidationSchema>;
export type BuildResponse = z.infer<typeof BuildResponseSchema>;

/**
 * Renders a zod validation failure naming the offending field (FR-036), e.g.
 * `outputs: must be non-empty ...`. Shared by both directions so a malformed request and a
 * malformed response refuse in the same shape.
 */
export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : '(root)';
      return `${field}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Parses a value as a BuildResponse, throwing with the offending field named. Exposed so the
 * runner and any other caller refuse identically.
 */
export function parseBuildResponse(value: unknown): BuildResponse {
  const result = BuildResponseSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`malformed BuildResponse — ${formatSchemaIssues(result.error)}`);
  }
  return result.data;
}

/** Parses a value as a BuildRequest, throwing with the offending field named. */
export function parseBuildRequest(value: unknown): BuildRequest {
  const result = BuildRequestSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`malformed BuildRequest — ${formatSchemaIssues(result.error)}`);
  }
  return result.data;
}

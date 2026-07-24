import { z } from 'zod';
import { HashSchema, IdentitySchema } from '@/manifest/schema.js';

/**
 * A human's waiver of advisory drift on an authored node (FR-022). `waived_hash` pins the
 * tracked node's hash at the moment of waiving; needs-review re-raises when the current hash
 * differs. A boolean here would silently swallow every subsequent revision — the exact
 * false-clean the advisory edge exists to catch.
 *
 * `reason` must be non-empty and non-whitespace (FR-022b): a waiver without a reason is not
 * a decision.
 */
export const WaiverSchema = z.object({
  waived_hash: HashSchema,
  reason: z
    .string()
    .refine((value) => value.trim().length > 0, 'reason must not be empty or whitespace-only'),
  at: z.string().datetime({ offset: true }),
});

/**
 * The record of a single build of a derived node. `validation` is optional and its absence is
 * meaningful (FR-006b): absent = not yet validated, distinct from both `passed` and `failed`.
 * A fresh-but-unvalidated artifact still blocks release, so this must never be defaulted.
 *
 * `producer_impure` mirrors `ProviderDecl.impure` — an optional `{ reason }`, never a bare
 * boolean (FR-032).
 */
export const ArtifactRecordSchema = z.object({
  producer: z.object({
    tool: z.string(),
    version: z.string(),
  }),
  producer_impure: z
    .object({
      // Non-empty and non-whitespace (FR-032), mirroring WaiverSchema above and
      // ProviderDecl.impure — the recorded impurity reason must carry real content,
      // not a bare flag.
      reason: z
        .string()
        .refine((value) => value.trim().length > 0, 'reason must not be empty or whitespace-only'),
    })
    .optional(),
  inputs: z.record(IdentitySchema, HashSchema),
  output: z.object({
    path: z.string(),
    hash: HashSchema,
  }),
  built_at: z.string().datetime({ offset: true }),
  validation: z
    .object({
      state: z.enum(['passed', 'failed']),
      at: z.string().datetime({ offset: true }),
    })
    .optional(),
});

/**
 * `version` is `z.literal(1)`: an unknown version is a refusal, never a best-effort parse
 * (FR-005).
 */
export const LedgerSchema = z.object({
  version: z.literal(1),
  artifacts: z.record(IdentitySchema, ArtifactRecordSchema),
  reviews: z.record(IdentitySchema, WaiverSchema),
});

export type Waiver = z.infer<typeof WaiverSchema>;
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;
export type Ledger = z.infer<typeof LedgerSchema>;

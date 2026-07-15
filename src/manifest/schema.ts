import { z } from 'zod';

/**
 * The stable name of a role (e.g. `spoken`, `narration`, `voiceover`).
 * Survives rebuilds and file moves; paths are an attribute of a node, never its identity.
 */
export type Identity = string;

/**
 * `sha256:<64 lowercase hex>` — a single opaque string throughout, so the reference and the
 * integrity claim never diverge. Exported so the ledger and asset-pointer schemas reuse it.
 */
export const HashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256 hash of the form sha256:<64 lowercase hex>');

export const IdentitySchema = z.string();

/**
 * A declared authored node. `follows` is the advisory relationship ("is a response to"),
 * distinct from a dependency (`inputs`, "is built from"). It never rebuilds and never blocks
 * alone (FR-019).
 */
export const AuthoredDeclSchema = z.object({
  path: z.string(),
  follows: IdentitySchema.optional(),
});

/**
 * `impure` is an optional object carrying a reason, never a bare boolean (FR-032). A flag says
 * "expect different bytes"; a reason says which kind of impurity, which is what a reader needs.
 */
export const ProviderDeclSchema = z.object({
  cmd: z.array(z.string()),
  impure: z
    .object({
      reason: z.string(),
    })
    .optional(),
});

export const TargetDeclSchema = z.object({
  inputs: z.array(IdentitySchema),
  provider: ProviderDeclSchema,
});

/**
 * `version` is `z.literal(1)`: an unknown version is a refusal, never a best-effort parse
 * (FR-005). This is the whole reason the field exists.
 */
export const EpisodeManifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  profile: z.string(),
  authored: z.record(IdentitySchema, AuthoredDeclSchema),
  targets: z.array(IdentitySchema),
});

export const ProfileSchema = z.object({
  version: z.literal(1),
  targets: z.record(IdentitySchema, TargetDeclSchema),
});

export type EpisodeManifest = z.infer<typeof EpisodeManifestSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type AuthoredDecl = z.infer<typeof AuthoredDeclSchema>;
export type TargetDecl = z.infer<typeof TargetDeclSchema>;
export type ProviderDecl = z.infer<typeof ProviderDeclSchema>;

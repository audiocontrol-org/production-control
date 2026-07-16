import * as path from 'node:path';
import { z } from 'zod';

/**
 * The stable name of a role (e.g. `spoken`, `narration`, `voiceover`).
 * Survives rebuilds and file moves; paths are an attribute of a node, never its identity.
 */
export type Identity = string;

/**
 * A path that MUST stay within the directory it is relative to (an episode dir, an
 * `output_dir`). It is the single place the "no directory traversal" refusal lives, so every
 * caller that stores a filesystem path in a schema inherits the same invariant and refuses in
 * the same shape as `version` and `HashSchema` do — naming the field (FR-036).
 *
 * A value is refused when it is:
 *   - empty                    — there is no such thing as a zero-length path;
 *   - backslash-bearing        — manifest and contract paths are posix; a `\` this host treats
 *                                as a literal char is a separator on another, so a name that
 *                                looks contained here could traverse there. Refuse it outright
 *                                rather than let portability decide security;
 *   - absolute                 — `/etc/passwd` is not relative to anything;
 *   - upward-traversing        — a value that normalizes to `..` or `../…` escapes its root.
 *
 * Deliberately ALLOWED, each pinned by a test:
 *   - a leading `./` (`./a.md` normalizes to `a.md`, plainly inside);
 *   - an interior `..` that normalizes back inside (`a/../b` → `b`), because the resolved
 *     location is contained — only a value whose *normal form* leaves the root is an escape.
 */
export const RelativePathSchema = z
  .string()
  .min(1, 'must be a non-empty relative path')
  .refine((value) => !value.includes('\\'), {
    message: 'must use "/" separators — a "\\" is not a portable path separator',
  })
  .refine((value) => !path.posix.isAbsolute(value), {
    message: 'must be relative to its directory, not an absolute path',
  })
  .refine(
    (value) => {
      const normalized = path.posix.normalize(value);
      return normalized !== '..' && !normalized.startsWith('../');
    },
    {
      message: 'must stay within its directory — a path that traverses upward with ".." is refused',
    }
  );

/**
 * A BARE profile name — not a path. `loadProfile` joins it into `<name>.yaml` and searches
 * `searchDirs`, so a name carrying separators (or `..`) would escape those directories and make
 * the function's own "Searched: <dirs>" message a lie. Constraining it to the same lowercase
 * convention the shipped `editorial-audio` profile already follows refuses that at manifest-load
 * time, naming the field (FR-036).
 */
export const ProfileNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    'must be a bare profile name matching /^[a-z0-9][a-z0-9-]*$/ (no path separators or "..")'
  );

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
  path: RelativePathSchema,
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
  profile: ProfileNameSchema,
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

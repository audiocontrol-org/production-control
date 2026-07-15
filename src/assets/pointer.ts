import { z } from 'zod';
import { HashSchema } from '@/manifest/schema.js';

/**
 * Committed stand-in for bytes held outside version control (`<name>.<ext>.asset`). The
 * `asset` hash is the content address — reference and integrity claim are one string.
 * `bytes` is a non-negative integer (zero is valid) recorded for human reading.
 */
export const AssetPointerSchema = z.object({
  asset: HashSchema,
  media: z.string(),
  bytes: z.int().nonnegative(),
});

export type AssetPointer = z.infer<typeof AssetPointerSchema>;

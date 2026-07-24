import * as fs from 'node:fs/promises';
import { hashFile, type Hash } from '@/hash/content.js';
import { hashTree } from '@/hash/tree.js';

/**
 * Hashing whatever is at a path — the ONE place the file-or-directory question is asked.
 *
 * An identity resolves to a path, and a path is a file or a directory. Both are content, and
 * both have a content hash: a file's is over its bytes (`hashFile`), a directory's is over its
 * tree (`hashTree`, research R3). Nothing above this line needs to know which it got.
 *
 * This lives here, alone, because the rule has exactly two callers that must never disagree:
 * `state/identity.ts` answers "what is this input's hash" for `pc status`, and
 * `providers/inputs.ts` answers the same question for `pc build`. They are the two halves of
 * `hash(resolve(input))` — status decides whether a build is needed, build records what it was
 * fed — so a second copy of this branch would be a second place for the two to drift, and a
 * drift between them means `pc status` reporting `fresh` against a hash no build ever recorded.
 * That is precisely the bug this file exists to make unrepresentable: `inputs.ts` once called
 * `hashFile` unconditionally and every directory-input build died with EISDIR, while `status`
 * — which already branched correctly — reported the same input `present`.
 *
 * The `stat` asks exactly one question — file or directory — and reads nothing else off the
 * result. In particular it NEVER looks at mtime: a `touch` must not change any answer derived
 * from this (FR-008).
 */
export async function hashPath(fullPath: string): Promise<Hash> {
  const stats = await fs.stat(fullPath);
  return stats.isDirectory() ? hashTree(fullPath) : hashFile(fullPath);
}

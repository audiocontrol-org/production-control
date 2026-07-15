import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { hashFile, type Hash } from './content.js';

/**
 * A single file discovered while walking a directory tree.
 *
 * `relativePath` is POSIX-normalized and relative to the tree root, so the same
 * tree produces the same value on every platform.
 */
interface TreeEntry {
  readonly relativePath: string;
  readonly relativePathBytes: Buffer;
  readonly contentHash: Hash;
}

/** Field delimiter for the canonical byte stream. See hashTree docs. */
const NUL = Buffer.from([0x00]);

/**
 * Convert a platform-native relative path into its POSIX form.
 *
 * On win32 `path.relative` yields backslash separators; leaking those into the
 * hash would make the same tree hash differently per platform.
 */
function toPosixPath(nativeRelativePath: string): string {
  return nativeRelativePath.split(sep).join('/');
}

/**
 * Order two entries by the BYTE ordering of their relative paths.
 *
 * `Array.prototype.sort()` on strings compares UTF-16 code units, which does not
 * match UTF-8 byte order outside the BMP (and is locale-sensitive under
 * `localeCompare`). Both would make the hash machine-dependent, so compare the
 * encoded bytes directly.
 */
function byPathBytes(a: TreeEntry, b: TreeEntry): number {
  return Buffer.compare(a.relativePathBytes, b.relativePathBytes);
}

/**
 * Recursively collect every regular file under `currentDir`.
 *
 * Filesystem iteration order is arbitrary, so entries are collected here and
 * sorted by the caller — never trusted in `readdir` order.
 */
async function collectEntries(rootDir: string, currentDir: string): Promise<TreeEntry[]> {
  const names = await readdir(currentDir);
  const collected: TreeEntry[] = [];

  for (const name of names) {
    const absolutePath = join(currentDir, name);

    // lstat, not stat: stat follows symlinks, and a followed link is one we
    // would never notice.
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not permitted in a hashed directory tree: "${absolutePath}"`
      );
    }

    if (stats.isDirectory()) {
      // Empty directories contribute no entries and are therefore unrepresented
      // in the hash — this recursion simply yields nothing for them.
      collected.push(...(await collectEntries(rootDir, absolutePath)));
      continue;
    }

    if (!stats.isFile()) {
      throw new Error(
        `Unsupported filesystem entry in hashed directory tree (not a regular file or directory): "${absolutePath}"`
      );
    }

    const relativePath = toPosixPath(relative(rootDir, absolutePath));
    collected.push({
      relativePath,
      relativePathBytes: Buffer.from(relativePath, 'utf8'),
      contentHash: await hashFile(absolutePath),
    });
  }

  return collected;
}

/**
 * Compute a content-addressed hash of a directory tree.
 *
 * Algorithm (specs/001-episode-production-contract/research.md, R3):
 *
 * 1. Walk all files recursively.
 * 2. Pair each file's POSIX-normalized path (relative to `dirPath`) with the
 *    sha256 hash of its contents.
 * 3. Sort the pairs by relative path using BYTE ordering.
 * 4. Hash the concatenation of `<relative-path>` NUL `<content-hash>` NUL for
 *    each pair, in order.
 *
 * The NUL delimiters are load-bearing: without them the pairs `("ab", "c")` and
 * `("a", "bc")` would produce identical byte streams.
 *
 * Only content is hashed — never mtime or any other filesystem metadata
 * (spec FR-008). Empty directories are not represented. Symlinks are an error:
 * following one can escape `dirPath`, and skipping one would silently drop data.
 *
 * @param dirPath - Absolute or relative path to the directory to hash.
 * @returns The tree hash, formatted `sha256:<64 lowercase hex>`.
 * @throws If `dirPath` does not exist, is not a directory, or the tree contains
 *         a symbolic link or a non-regular file.
 */
export async function hashTree(dirPath: string): Promise<Hash> {
  let rootStats;
  try {
    rootStats = await lstat(dirPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to hash directory tree at path "${dirPath}": ${message}`, {
      cause: error,
    });
  }

  if (rootStats.isSymbolicLink()) {
    throw new Error(
      `Symbolic links are not permitted in a hashed directory tree: "${dirPath}" is a symbolic link`
    );
  }

  if (!rootStats.isDirectory()) {
    throw new Error(`Cannot hash directory tree: path "${dirPath}" is not a directory`);
  }

  const entries = await collectEntries(dirPath, dirPath);
  entries.sort(byPathBytes);

  const hasher = createHash('sha256');
  for (const entry of entries) {
    hasher.update(entry.relativePathBytes);
    hasher.update(NUL);
    hasher.update(Buffer.from(entry.contentHash, 'utf8'));
    hasher.update(NUL);
  }

  return `sha256:${hasher.digest('hex')}`;
}

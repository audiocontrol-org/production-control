import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashTree } from '@/hash/tree.js';

describe('hashTree', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `hash-tree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Case 1: Order-independence with identical content', () => {
    it('two directories with identical content hash EQUAL, even when files created in reverse order', async () => {
      const dir1 = join(testDir, 'dir1');
      const dir2 = join(testDir, 'dir2');

      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });

      // Create files in dir1 in forward order
      await writeFile(join(dir1, 'a.txt'), 'content a');
      await writeFile(join(dir1, 'b.txt'), 'content b');
      await writeFile(join(dir1, 'c.txt'), 'content c');

      // Create files in dir2 in reverse order
      await writeFile(join(dir2, 'c.txt'), 'content c');
      await writeFile(join(dir2, 'b.txt'), 'content b');
      await writeFile(join(dir2, 'a.txt'), 'content a');

      const hash1 = await hashTree(dir1);
      const hash2 = await hashTree(dir2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Case 2: Content changes affect hash', () => {
    it('changing any file content changes the tree hash', async () => {
      const dir = join(testDir, 'content-change');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'file.txt'), 'original content');
      const hash1 = await hashTree(dir);

      await writeFile(join(dir, 'file.txt'), 'modified content');
      const hash2 = await hashTree(dir);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Case 3: Renaming files changes hash', () => {
    it('renaming a file changes the tree hash', async () => {
      const dir = join(testDir, 'rename-test');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'original.txt'), 'content');
      const hash1 = await hashTree(dir);

      await rm(join(dir, 'original.txt'));
      await writeFile(join(dir, 'renamed.txt'), 'content');
      const hash2 = await hashTree(dir);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Case 4: Adding and removing files', () => {
    it('adding a file changes the hash; removing it restores the original', async () => {
      const dir = join(testDir, 'add-remove');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'file1.txt'), 'content 1');
      const hash1 = await hashTree(dir);

      await writeFile(join(dir, 'file2.txt'), 'content 2');
      const hash2 = await hashTree(dir);

      expect(hash1).not.toBe(hash2);

      await rm(join(dir, 'file2.txt'));
      const hash3 = await hashTree(dir);

      expect(hash3).toBe(hash1);
    });
  });

  describe('Case 5: Nested subdirectories', () => {
    it('nested subdirectories are included and their relative paths contribute', async () => {
      const dir = join(testDir, 'nested');
      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, 'subdir1'), { recursive: true });
      await mkdir(join(dir, 'subdir2'), { recursive: true });

      await writeFile(join(dir, 'subdir1', 'file.txt'), 'content 1');
      await writeFile(join(dir, 'subdir2', 'file.txt'), 'content 1');
      const hash1 = await hashTree(dir);

      // Same file contents, different nested paths — the hash must differ, because the
      // relative path is part of the hash and not just the content.
      const dir2 = join(testDir, 'nested2');
      await mkdir(dir2, { recursive: true });
      await mkdir(join(dir2, 'other'), { recursive: true });
      await mkdir(join(dir2, 'subdir1'), { recursive: true });

      await writeFile(join(dir2, 'other', 'file.txt'), 'content 1');
      await writeFile(join(dir2, 'subdir1', 'file.txt'), 'content 1');
      const hash2 = await hashTree(dir2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Case 6: Empty subdirectories', () => {
    it('an empty subdirectory does NOT affect the hash', async () => {
      const dir1 = join(testDir, 'no-empty');
      const dir2 = join(testDir, 'with-empty');

      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });

      await writeFile(join(dir1, 'file.txt'), 'content');
      await writeFile(join(dir2, 'file.txt'), 'content');
      await mkdir(join(dir2, 'empty-subdir'), { recursive: true });

      const hash1 = await hashTree(dir1);
      const hash2 = await hashTree(dir2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Case 7: Symlinks are errors', () => {
    it('a symlink inside the tree is an ERROR and names the symlink path', async () => {
      const dir = join(testDir, 'symlink-test');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'target.txt'), 'content');
      await symlink(join(dir, 'target.txt'), join(dir, 'link.txt'));

      await expect(hashTree(dir)).rejects.toThrow();
      try {
        await hashTree(dir);
      } catch (e) {
        if (e instanceof Error) {
          expect(e.message).toContain('link.txt');
        }
      }
    });
  });

  describe('Case 8: Byte-ordering with locale-sensitive filenames', () => {
    it('byte-ordering (not locale-ordering) is used; hash is stable across different creation orders', async () => {
      const dir1 = join(testDir, 'byte-order-1');
      const dir2 = join(testDir, 'byte-order-2');

      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });

      // Create files in one order in dir1: a.txt, B.txt, _x.txt, z.txt
      await writeFile(join(dir1, 'a.txt'), 'content a');
      await writeFile(join(dir1, 'B.txt'), 'content B');
      await writeFile(join(dir1, '_x.txt'), 'content x');
      await writeFile(join(dir1, 'z.txt'), 'content z');

      const hash1 = await hashTree(dir1);

      // Create files in different order in dir2: z.txt, _x.txt, B.txt, a.txt
      await writeFile(join(dir2, 'z.txt'), 'content z');
      await writeFile(join(dir2, '_x.txt'), 'content x');
      await writeFile(join(dir2, 'B.txt'), 'content B');
      await writeFile(join(dir2, 'a.txt'), 'content a');

      const hash2 = await hashTree(dir2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Case 9: Hash format validation', () => {
    it('result matches /^sha256:[0-9a-f]{64}$/', async () => {
      const dir = join(testDir, 'format-test');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'file.txt'), 'content');
      const hash = await hashTree(dir);

      const hashPattern = /^sha256:[0-9a-f]{64}$/;
      expect(hash).toMatch(hashPattern);
    });
  });

  describe('Case 10: Nonexistent path rejection', () => {
    it('a path that does not exist rejects, naming the path', async () => {
      const nonexistentPath = join(testDir, 'does-not-exist');

      await expect(hashTree(nonexistentPath)).rejects.toThrow();
      try {
        await hashTree(nonexistentPath);
      } catch (e) {
        if (e instanceof Error) {
          expect(e.message).toContain('does-not-exist');
        }
      }
    });
  });

  describe('Additional validation', () => {
    it('handles multiple nested levels correctly', async () => {
      const dir = join(testDir, 'deep-nesting');
      await mkdir(join(dir, 'level1', 'level2', 'level3'), { recursive: true });

      await writeFile(join(dir, 'level1', 'level2', 'level3', 'deep.txt'), 'deep content');
      await writeFile(join(dir, 'root.txt'), 'root content');

      const hash = await hashTree(dir);

      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('produces consistent results when called multiple times on the same directory', async () => {
      const dir = join(testDir, 'consistency');
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'file1.txt'), 'content 1');
      await writeFile(join(dir, 'file2.txt'), 'content 2');

      const hash1 = await hashTree(dir);
      const hash2 = await hashTree(dir);
      const hash3 = await hashTree(dir);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });
});

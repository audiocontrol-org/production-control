import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { hashBytes, hashFile, type Hash } from '@/hash/content.js';

describe('hash/content', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('hashBytes', () => {
    it('should return the same hash for the same bytes', () => {
      const bytes = Buffer.from('test content');
      const hash1 = hashBytes(bytes);
      const hash2 = hashBytes(bytes);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different bytes', () => {
      const bytes1 = Buffer.from('test content 1');
      const bytes2 = Buffer.from('test content 2');
      const hash1 = hashBytes(bytes1);
      const hash2 = hashBytes(bytes2);
      expect(hash1).not.toBe(hash2);
    });

    it('should return a hash matching the sha256 format: sha256:<64 lowercase hex>', () => {
      const bytes = Buffer.from('any content');
      const hash = hashBytes(bytes);
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('should produce the correct hash for empty input (known-answer test)', () => {
      // SHA256 of empty string
      const expectedHash: Hash =
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const hash = hashBytes(Buffer.from(''));
      expect(hash).toBe(expectedHash);
    });

    it('should produce the correct hash for "abc" (known-answer test)', () => {
      // SHA256 of "abc"
      const expectedHash: Hash =
        'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
      const hash = hashBytes(Buffer.from('abc'));
      expect(hash).toBe(expectedHash);
    });
  });

  describe('hashFile', () => {
    it('should return a hash matching the sha256 format: sha256:<64 lowercase hex>', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'test content');
      const hash = await hashFile(filePath);
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('should agree with hashBytes on the same content', async () => {
      const content = Buffer.from('test file content');
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, content);

      const fileHash = await hashFile(filePath);
      const bytesHash = hashBytes(content);

      expect(fileHash).toBe(bytesHash);
    });

    it('should be stable across mtime changes (FR-008 regression test)', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'test content for mtime stability';
      await fs.writeFile(filePath, content);

      // Hash the file initially
      const initialHash = await hashFile(filePath);

      // Change the modification time without changing content
      const futureTime = new Date(Date.now() + 86400000); // 1 day in the future
      await fs.utimes(filePath, futureTime, futureTime);

      // Hash the file again after mtime change
      const afterMtimeHash = await hashFile(filePath);

      // Hashes should be identical (not based on mtime)
      expect(afterMtimeHash).toBe(initialHash);
    });

    it('should reject with an error naming the missing path when file does not exist', async () => {
      const missingPath = path.join(tempDir, 'does-not-exist.txt');

      await expect(hashFile(missingPath)).rejects.toThrow();
      await expect(hashFile(missingPath)).rejects.toThrow(missingPath);
    });

    it('should return the same hash for the same file content', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'same content';
      await fs.writeFile(filePath, content);

      const hash1 = await hashFile(filePath);
      const hash2 = await hashFile(filePath);

      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different file content', async () => {
      const filePath1 = path.join(tempDir, 'test1.txt');
      const filePath2 = path.join(tempDir, 'test2.txt');

      await fs.writeFile(filePath1, 'content 1');
      await fs.writeFile(filePath2, 'content 2');

      const hash1 = await hashFile(filePath1);
      const hash2 = await hashFile(filePath2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce the correct hash for empty file (known-answer test)', async () => {
      const filePath = path.join(tempDir, 'empty.txt');
      await fs.writeFile(filePath, '');

      const expectedHash: Hash =
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const hash = await hashFile(filePath);

      expect(hash).toBe(expectedHash);
    });
  });
});

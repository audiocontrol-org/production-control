import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gitTrackedCheck, untrackedCheck } from '@/assets/git-tracked.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('assets/git-tracked', () => {
  describe('gitTrackedCheck', () => {
    it('reports true for a real tracked file in this repo', async () => {
      const check = gitTrackedCheck();
      await expect(check.isTracked(path.join(ROOT, 'package.json'))).resolves.toBe(true);
    });

    it('reports false, not a throw, for a path outside any repository', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-git-tracked-test-'));
      try {
        const outsidePath = path.join(dir, 'not-in-a-repo.txt');
        await fs.writeFile(outsidePath, 'hello', 'utf8');

        const check = gitTrackedCheck();
        await expect(check.isTracked(outsidePath)).resolves.toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('untrackedCheck', () => {
    it('always reports false', async () => {
      const check = untrackedCheck();
      await expect(check.isTracked(path.join(ROOT, 'package.json'))).resolves.toBe(false);
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readPointer, resolveAuthored } from '@/assets/pointer.js';
import type { TrackedCheck } from '@/assets/git-tracked.js';

/** Stub `TrackedCheck` — no git needed. Reports whatever `tracked` says for every path. */
function stubTrackedCheck(tracked: boolean): TrackedCheck {
  return {
    isTracked(): Promise<boolean> {
      return Promise.resolve(tracked);
    },
  };
}

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'asset');
const FIXTURE_WAV = path.join(FIXTURE_DIR, 'assets', 'narration', 'take-01.wav');
const FIXTURE_ADDRESS = 'sha256:d87597da137d9898657caa494321c9bc73f8100c3cd1fb1813912d45e4f8a952';

// A syntactically valid pointer, reused wherever a test needs "some" valid stand-in
// content but does not care about its exact address.
const VALID_POINTER_YAML = [
  'asset: sha256:0000000000000000000000000000000000000000000000000000000000000000',
  'media: application/octet-stream',
  'bytes: 21',
  '',
].join('\n');

describe('assets/pointer', () => {
  describe('readPointer', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      await Promise.all(
        tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
      );
    });

    async function makeTempDir(): Promise<string> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-pointer-test-'));
      tempDirs.push(dir);
      return dir;
    }

    it('returns the parsed pointer when <path>.asset exists (real fixture)', async () => {
      const pointer = await readPointer(FIXTURE_WAV);
      expect(pointer).not.toBeNull();
      expect(pointer?.asset).toBe(FIXTURE_ADDRESS);
      expect(pointer?.media).toBe('audio/wav');
      expect(pointer?.bytes).toBe(21);
    });

    it('returns null when <path>.asset does not exist', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'no-standin.bin');
      await expect(readPointer(declaredPath)).resolves.toBeNull();
    });

    it('throws naming the path when the stand-in is malformed YAML', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'bad.bin');
      const pointerPath = `${declaredPath}.asset`;
      await fs.writeFile(pointerPath, 'asset: [unterminated\n', 'utf8');

      await expect(readPointer(declaredPath)).rejects.toThrow(pointerPath);
    });

    it('throws naming the path and the field when the stand-in has a bad asset hash', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'bad-hash.bin');
      const pointerPath = `${declaredPath}.asset`;
      await fs.writeFile(
        pointerPath,
        ['asset: not-a-valid-hash', 'media: audio/wav', 'bytes: 21', ''].join('\n'),
        'utf8'
      );

      try {
        await readPointer(declaredPath);
        expect.unreachable('expected readPointer to throw on a bad asset hash');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain(pointerPath);
        expect(message).toContain('asset');
      }
    });
  });

  describe('resolveAuthored', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      await Promise.all(
        tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
      );
    });

    async function makeTempDir(): Promise<string> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-pointer-test-'));
      tempDirs.push(dir);
      return dir;
    }

    it(
      "resolves the real asset fixture to kind: 'pointer' even though the .wav does not " +
        "exist on disk — that absence is the fixture's whole point",
      async () => {
        await expect(fs.stat(FIXTURE_WAV)).rejects.toThrow();

        const resolution = await resolveAuthored(FIXTURE_WAV);
        expect(resolution.kind).toBe('pointer');
        if (resolution.kind === 'pointer') {
          expect(resolution.pointer.asset).toBe(FIXTURE_ADDRESS);
        }
      }
    );

    it('performs no network I/O: resolving a pointer whose asset is in no store still succeeds (FR-025)', async () => {
      // Nothing here ever contacts a store — there is no store client in scope at all.
      // The fixture's asset is not seeded anywhere; resolution must still succeed
      // because it only ever reads the local stand-in.
      await expect(resolveAuthored(FIXTURE_WAV)).resolves.toEqual({
        kind: 'pointer',
        pointer: { asset: FIXTURE_ADDRESS, media: 'audio/wav', bytes: 21 },
      });
    });

    it('returns kind: file, no throw, for a small untracked file with no stand-in', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'small.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(10, 1), 'utf8');

      await expect(resolveAuthored(declaredPath)).resolves.toEqual({
        kind: 'file',
        path: declaredPath,
      });
    });

    it('throws naming the path for a large untracked file with no stand-in (FR-026)', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'large.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(50, 1));

      try {
        await resolveAuthored(declaredPath, { maxInlineBytes: 10 });
        expect.unreachable('expected resolveAuthored to throw for an oversized untracked file');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain(declaredPath);
        expect(message).toContain('pc asset add');
      }
    });

    it('throws for a large file when `tracked` is omitted (the conservative default)', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'large-no-tracked-opt.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(50, 1));

      await expect(resolveAuthored(declaredPath, { maxInlineBytes: 10 })).rejects.toThrow(
        declaredPath
      );
    });

    it('does not throw for a large UNTRACKED file when enforceInlineLimit is false (the read/oracle mode)', async () => {
      // The status/oracle path (`src/state/identity.ts`) resolves in this mode: it cannot spawn git
      // to learn tracked-ness offline, so it never enforces the FR-026 refusal and always answers
      // (FR-010). The large untracked file resolves to `kind: 'file'` so status can hash it and
      // report the node (AUDIT-20260716-02, AUDIT-20260716-26).
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'large-report-only.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(50, 1));

      await expect(
        resolveAuthored(declaredPath, { maxInlineBytes: 10, enforceInlineLimit: false })
      ).resolves.toEqual({ kind: 'file', path: declaredPath });
    });

    it('does not throw for a large file when an injected TrackedCheck reports it tracked', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'large-tracked.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(50, 1));

      await expect(
        resolveAuthored(declaredPath, { maxInlineBytes: 10, tracked: stubTrackedCheck(true) })
      ).resolves.toEqual({ kind: 'file', path: declaredPath });
    });

    it('returns kind: pointer, no throw, for a large file that has a stand-in beside it', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'large-with-standin.bin');
      await fs.writeFile(declaredPath, Buffer.alloc(50, 1));
      await fs.writeFile(`${declaredPath}.asset`, VALID_POINTER_YAML, 'utf8');

      const resolution = await resolveAuthored(declaredPath, { maxInlineBytes: 10 });
      expect(resolution.kind).toBe('pointer');
    });

    it('returns kind: absent for a declared path that does not exist and has no stand-in', async () => {
      const dir = await makeTempDir();
      const declaredPath = path.join(dir, 'does-not-exist.bin');

      await expect(resolveAuthored(declaredPath)).resolves.toEqual({ kind: 'absent' });
    });
  });
});

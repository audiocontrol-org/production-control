import { describe, it, expect } from 'vitest';
import { classifyZone } from '@/zoning/classify.js';

describe('classifyZone', () => {
  describe('golden cases', () => {
    it.each([
      ['ch01.md', 'human-safe'],
      ['dist/ep01/out.wav', 'human-safe'],
      ['.ai/ep01/ch01.md', 'ai-permitted'],
      ['dist/.ai/ch01.md', 'ai-permitted'],
      ['dist/target/.ai/out.md', 'ai-permitted'],
      ['dist/.draft.md', 'human-safe'],
      ['.cache/x', 'ai-permitted'],
      ['.tmp/x', 'ai-permitted'],
      ['a/b/c.md', 'human-safe'],
    ] as const)('classifyZone(%j) => %s', (relPath, expected) => {
      expect(classifyZone(relPath)).toBe(expected);
    });
  });

  describe('normalization', () => {
    it('a leading "./" normalizes correctly and does not itself count as a dot directory', () => {
      expect(classifyZone('./ch01.md')).toBe('human-safe');
      expect(classifyZone('./.ai/ch01.md')).toBe('ai-permitted');
    });

    it('a single-segment path (just a filename) is human-safe, even when dot-prefixed', () => {
      // The basename never participates (Rule 2) — a dot-prefixed basename with no parent
      // directory segments has no directory segment to trigger Rule 1.
      expect(classifyZone('ch01.md')).toBe('human-safe');
      expect(classifyZone('.draft.md')).toBe('human-safe');
    });

    it('a trailing-slash directory path treats the final segment as a directory, not a basename', () => {
      // 'dist/.ai/' names a directory, not a file — every segment (including the last) is a
      // directory segment, so the trailing '.ai' segment must participate in Rule 1.
      expect(classifyZone('dist/.ai/')).toBe('ai-permitted');
    });
  });

  describe('legibility regression guards (US2)', () => {
    describe('identical treatment of dot-zone directories (FR-016)', () => {
      it('.cache, .tmp, and .ai are treated identically as ai-permitted', () => {
        // S6 & US2 acceptance scenario 5: dot-directories with different semantic names
        // (`.cache`, `.tmp`, `.ai`) are treated **identically** as AI-permitted — `.ai` is
        // conventional, not special. Only the leading dot matters (FR-016).
        expect(classifyZone('.cache/x')).toBe('ai-permitted');
        expect(classifyZone('.tmp/x')).toBe('ai-permitted');
        expect(classifyZone('.ai/x')).toBe('ai-permitted');

        // With nested paths, all three behave identically.
        expect(classifyZone('.cache/subdir/file.md')).toBe('ai-permitted');
        expect(classifyZone('.tmp/subdir/file.md')).toBe('ai-permitted');
        expect(classifyZone('.ai/subdir/file.md')).toBe('ai-permitted');

        // With mixed parents, one dot-segment anywhere marks the path as ai-permitted.
        expect(classifyZone('dist/.cache/out.md')).toBe('ai-permitted');
        expect(classifyZone('dist/.tmp/out.md')).toBe('ai-permitted');
        expect(classifyZone('dist/.ai/out.md')).toBe('ai-permitted');
      });
    });

    describe('dot basename does not establish zone (FR-002)', () => {
      it('a dot-prefixed basename in a clean directory is human-safe', () => {
        // FR-002 & S6: a dot-prefixed *file* (e.g. `dist/.draft.md`) in a directory whose
        // segments are all non-dot is **human-safe** — the basename does not establish
        // a zone. The "any-dot-wins" rule applies only to DIRECTORY segments.
        expect(classifyZone('dist/.draft.md')).toBe('human-safe');
        expect(classifyZone('src/.internal.ts')).toBe('human-safe');
        expect(classifyZone('docs/.temp.md')).toBe('human-safe');

        // Multiple non-dot parent directories with a dot basename: still human-safe.
        expect(classifyZone('src/app/config/.hidden.json')).toBe('human-safe');
      });
    });

    describe('above-root exclusion (FR-003)', () => {
      it('a root-relative path ignores any dot-segments above the production root', () => {
        // FR-003 & S6: the function sees only a relative path; segments above the
        // production root are never in its input. A path like `target/out.md` classifies
        // human-safe from the root's perspective, even if its real filesystem location
        // might sit under some `/home/.hidden/project/target/out.md` ancestor. The
        // function only sees the root-relative `target/out.md`, so above-root ancestors
        // have no effect.
        expect(classifyZone('target/out.md')).toBe('human-safe');
        expect(classifyZone('build/artifact.txt')).toBe('human-safe');
        expect(classifyZone('dist/index.html')).toBe('human-safe');

        // If there IS a dot-segment inside the root-relative path, it IS considered.
        expect(classifyZone('.ai/output/file.md')).toBe('ai-permitted');
        expect(classifyZone('build/.cache/temp.txt')).toBe('ai-permitted');
      });
    });
  });
});

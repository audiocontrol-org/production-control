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

    describe('above-root exclusion (FR-003) — refusal, not permissive fail-open', () => {
      // AUDIT-01: `classifyZone` is advertised as total. A violated precondition (input that
      // climbs above the production root, or is absolute rather than root-relative) must NOT
      // silently resolve to the PERMISSIVE verdict via "any-dot-wins" mistaking `..` for a
      // dot-directory — that is a false-safe of exactly the shape the design set out to
      // eliminate. Instead the function REFUSES (throws) a malformed input, so zoning still
      // contributes defense-in-depth in the one case it exists for. One assertion per
      // channel (channel-enumeration): `..` at the start, `..` mid-path (still escaping),
      // a bare `..`, and an absolute path.
      it('a leading ".." segment throws instead of classifying ai-permitted', () => {
        expect(() => classifyZone('../secrets/out.wav')).toThrow();
      });

      it('a mid-path ".." that still escapes the root throws', () => {
        expect(() => classifyZone('a/../../b/c.md')).toThrow();
      });

      it('a bare ".." throws', () => {
        expect(() => classifyZone('..')).toThrow();
      });

      // Contrast: an INTERIOR ".." that normalizes back inside the root is NOT an escape and
      // must NOT throw — it agrees with `RelativePathSchema`, which accepts `a/../b.md`. The
      // refusal is scoped to a genuine climb (normal form leads with ".."), not any raw "..".
      it('an interior ".." that stays within the root classifies its normal form (no throw)', () => {
        expect(classifyZone('a/../b.md')).toBe('human-safe');
        // `.hidden` is entered then escaped back out, so the file lands at the root — human-safe.
        expect(classifyZone('.hidden/../x.md')).toBe('human-safe');
      });

      it('an absolute path throws — the classifier requires root-relative input', () => {
        // AUDIT-06: this is the exact false-permitted flip FR-003 exists to prevent — an
        // absolute filesystem path whose ancestor happens to be a dotfile/dot-directory
        // (here `.config`) must never be waved through as ai-permitted just because the
        // caller failed to relativize it first.
        expect(() => classifyZone('/Users/x/.config/project/dist/out.md')).toThrow();
      });

      // Positive control: a well-formed, root-relative, non-climbing path with no dot
      // ancestors still classifies exactly as before — the refusal is additive, not a
      // change to the classification of any currently-valid path.
      it('a well-formed root-relative path with no dot ancestors stays human-safe', () => {
        expect(classifyZone('dist/out.md')).toBe('human-safe');
      });

      // A legitimate dotfile-basename / dot-directory path (neither absolute nor
      // ".."-bearing) still classifies exactly as the golden cases above pin — the throw is
      // scoped to malformed input only, not to every path with a dot in it.
      it('a legitimate dot-directory path (no escape, not absolute) still classifies ai-permitted', () => {
        expect(classifyZone('.ai/output/file.md')).toBe('ai-permitted');
        expect(classifyZone('build/.cache/temp.txt')).toBe('ai-permitted');
      });
    });
  });
});

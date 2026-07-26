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
});

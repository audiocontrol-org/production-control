import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALL_SRC_FILES,
  ROOT_FILES,
  IMPORTS_BY_FILE,
  SRC_DIR,
  resolveSpecifier,
  walk,
  rawSpecifierCount,
  importsOf,
  rel,
} from './architecture-support.js';

describe('architecture: the Milestone 1 / Milestone 2 boundary', () => {
  describe('the walk itself is not vacuous', () => {
    it('finds source files under src/', () => {
      expect(ALL_SRC_FILES.length).toBeGreaterThan(0);
    });

    it('finds at least one root module in Milestone 1', () => {
      expect(ROOT_FILES.length).toBeGreaterThan(0);
    });

    it('extracts module specifiers (the regex actually matches)', () => {
      const allSpecifiers = [...IMPORTS_BY_FILE.values()].flat();
      expect(allSpecifiers.length).toBeGreaterThan(0);
      expect(allSpecifiers).toContain('zod');
    });

    it('resolves NodeNext .js specifiers to .ts sources on disk', () => {
      const resolution = resolveSpecifier(
        '@/manifest/schema.js',
        path.join(SRC_DIR, 'graph/build.ts')
      );
      expect(resolution.kind).toBe('internal');
    });

    it('reaches a non-zero number of modules from every root', () => {
      for (const root of ROOT_FILES) {
        const { reached, unresolved } = walk(root);
        expect(unresolved, `unresolved internal imports from ${rel(root)}`).toEqual([]);
        // A leaf module legitimately reaches nothing internal; it must at least parse —
        // counting type-only specifiers here too, since a file whose only import is
        // type-only (erased at compile time) still proves the regex fired.
        const rawCount = rawSpecifierCount(fs.readFileSync(root, 'utf8'));
        expect(reached.size + rawCount, `${rel(root)} reached nothing at all`).toBeGreaterThan(0);
      }
    });

    it('walks TRANSITIVELY, not just direct imports', () => {
      // src/ledger/store.ts -> src/ledger/schema.js -> src/manifest/schema.js
      // store.ts does NOT import manifest/schema directly, so reaching it proves the walk
      // crosses more than one hop. If this ever stops holding, pick another 2-hop chain —
      // do not delete the assertion.
      const store = path.join(SRC_DIR, 'ledger/store.ts');
      if (!fs.existsSync(store)) {
        throw new Error(
          'src/ledger/store.ts is missing — the transitivity proof needs a new anchor.'
        );
      }

      const direct = importsOf(store)
        .map((specifier) => resolveSpecifier(specifier, store))
        .filter((resolution) => resolution.kind === 'internal')
        .map((resolution) => resolution.file);
      const target = path.join(SRC_DIR, 'manifest/schema.ts');

      expect(direct, 'anchor is no longer a 2-hop chain').not.toContain(target);
      expect([...walk(store).reached]).toContain(target);
    });

    it('collects external specifiers along the way', () => {
      const externals = new Set<string>();
      for (const root of ROOT_FILES) {
        for (const specifier of walk(root).externals) {
          externals.add(specifier);
        }
      }
      expect(externals.size).toBeGreaterThan(0);
    });
  });
});

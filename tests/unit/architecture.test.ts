import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Makes the Milestone 1 / Milestone 2 boundary real (research R6).
 *
 * The design's central bet is that the artifact graph is the novel part and execution is
 * commodity, sequenced so the novel part lands and proves itself first. That sequencing is
 * only real if Milestone 1 genuinely stands alone. If the oracle imports the provider
 * runner "just for types," the milestone boundary is decorative and the de-risking is
 * imaginary.
 *
 * It is also what makes FR-010 ("reporting state requires no network and no craft tools")
 * hold BY CONSTRUCTION rather than by discipline.
 *
 * The check is TRANSITIVE, which is the whole point. A direct-import check is trivially
 * defeated: `src/state/resolve.ts` imports `src/assets/pointer.ts`, which imports
 * `src/assets/s3.ts`, and the oracle pulls in the AWS SDK while a direct-import test stays
 * green. This builds the real import graph and walks it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/** Milestone 1 — the oracle. Every `.ts` file under these is a root of the walk. */
const ROOT_DIRS = ['src/state', 'src/graph', 'src/manifest', 'src/hash', 'src/ledger'];

/** Milestone 2 — the execution layer. Any internal module under here is off limits. */
const FORBIDDEN_INTERNAL_DIRS = ['src/providers'];

/** Milestone 2 — the network-touching store adapter and the execution-touching git check. */
const FORBIDDEN_INTERNAL_FILES = ['src/assets/s3.ts', 'src/assets/git-tracked.ts'];

/**
 * Node builtins that imply execution or network. Both the `node:` form and the bare form
 * resolve to the same builtin, so both are listed — nothing forces the prefix.
 */
const FORBIDDEN_BUILTINS = new Set([
  'node:child_process',
  'child_process',
  'node:http',
  'http',
  'node:https',
  'https',
  'node:net',
  'net',
  'node:dgram',
  'dgram',
  'node:tls',
  'tls',
]);

const MAX_FILE_LINES = 500;

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/**
 * Strips comments so that prose mentioning a module specifier is not mistaken for an
 * import. The line-comment pattern deliberately requires that `//` is not preceded by `:`,
 * so that URLs inside string literals (`https://...`) survive intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Strips whole-clause type-only imports/exports (`import type { X } from 'y'`,
 * `export type { X } from 'y'`). With `verbatimModuleSyntax: true` these are erased
 * entirely at compile time — they emit no JS and pull nothing into the runtime module
 * graph. The walk models the REAL (runtime) import graph, so counting one of these as an
 * edge would be a false positive: it would flag a module for a dependency that provably
 * never executes. This is deliberately narrow — it only strips the whole-clause form
 * (`import type ... from`), not a mixed clause like `import { type X, Y } from 'y'`,
 * which still carries a real runtime import for `Y`.
 */
function stripTypeOnlyImports(source: string): string {
  return source
    .replace(/\bimport\s+type\s+[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, '')
    .replace(/\bexport\s+type\s+[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, '');
}

const SPECIFIER_PATTERNS = [
  // import ... from 'x'  /  export ... from 'x'
  /\bfrom\s*['"]([^'"]+)['"]/g,
  // bare side-effect import: import 'x'
  /\bimport\s*['"]([^'"]+)['"]/g,
  // dynamic import: import('x')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Runs the specifier patterns over already-cleaned code. */
function matchSpecifiers(code: string): readonly string[] {
  const specifiers: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

/**
 * Pulls every module specifier out of a source file. A regex is honest here: the goal is to
 * enumerate specifiers, not to understand the program, and adding a TypeScript AST parser
 * dependency to a boundary test would be its own architectural cost.
 *
 * Covers `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`, and `import('x')`.
 * Whole-clause type-only imports are excluded first (see `stripTypeOnlyImports`) — this is
 * the specifier list the walk uses to build the REAL runtime import graph.
 */
function extractSpecifiers(source: string): readonly string[] {
  return matchSpecifiers(stripTypeOnlyImports(stripComments(source)));
}

/**
 * Same extraction, WITHOUT stripping type-only imports. Used only to prove the regex
 * fires on a file at all — a file whose only import is type-only legitimately has zero
 * runtime specifiers, which must not be confused with "the extraction is broken."
 */
function rawSpecifierCount(source: string): number {
  return matchSpecifiers(stripComments(source)).length;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

type Resolution =
  | { readonly kind: 'internal'; readonly file: string }
  | { readonly kind: 'external'; readonly specifier: string }
  | { readonly kind: 'unresolved'; readonly specifier: string };

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isAliased(specifier: string): boolean {
  return specifier.startsWith('@/');
}

/**
 * The project uses NodeNext, so internal imports carry a `.js` extension that maps to a
 * `.ts` source file on disk. Without this mapping the walk silently finds nothing and the
 * whole test passes vacuously.
 */
function candidatePaths(base: string): readonly string[] {
  const candidates: string[] = [];
  if (base.endsWith('.js')) {
    candidates.push(`${base.slice(0, -'.js'.length)}.ts`);
  }
  if (base.endsWith('.ts')) {
    candidates.push(base);
  }
  if (!base.endsWith('.js') && !base.endsWith('.ts')) {
    candidates.push(`${base}.ts`);
    candidates.push(path.join(base, 'index.ts'));
  } else {
    candidates.push(path.join(base.replace(/\.(js|ts)$/, ''), 'index.ts'));
  }
  return candidates;
}

function resolveSpecifier(specifier: string, importer: string): Resolution {
  let base: string;
  if (isAliased(specifier)) {
    base = path.join(SRC_DIR, specifier.slice('@/'.length));
  } else if (isRelative(specifier)) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return { kind: 'external', specifier };
  }

  for (const candidate of candidatePaths(base)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { kind: 'internal', file: candidate };
    }
  }

  // An internal specifier that resolves to nothing is a broken walk, not a pass. Surfaced
  // rather than skipped — silently skipping is exactly how this test goes vacuous.
  return { kind: 'unresolved', specifier };
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

/** Absent directories are normal here: Milestone 2 has not been built yet. */
function listTsFiles(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found.sort();
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

/** Matches `wc -l`: a trailing newline terminates the last line, it does not start a new one. */
function countLines(source: string): number {
  const lines = source.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.length - 1;
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// The import graph
// ---------------------------------------------------------------------------

const ALL_SRC_FILES = listTsFiles(SRC_DIR);

const IMPORTS_BY_FILE = new Map<string, readonly string[]>(
  ALL_SRC_FILES.map((file) => [file, extractSpecifiers(fs.readFileSync(file, 'utf8'))])
);

function importsOf(file: string): readonly string[] {
  const specifiers = IMPORTS_BY_FILE.get(file);
  if (specifiers === undefined) {
    throw new Error(`No parsed imports for ${rel(file)} — the import graph is incomplete.`);
  }
  return specifiers;
}

const ROOT_FILES = ROOT_DIRS.flatMap((dir) => listTsFiles(path.join(REPO_ROOT, dir)));

function isForbiddenInternal(file: string): boolean {
  const relative = rel(file);
  return (
    FORBIDDEN_INTERNAL_DIRS.some((dir) => relative.startsWith(`${dir}/`)) ||
    FORBIDDEN_INTERNAL_FILES.includes(relative)
  );
}

function isForbiddenExternal(specifier: string): boolean {
  return (
    FORBIDDEN_BUILTINS.has(specifier) ||
    specifier === '@aws-sdk' ||
    specifier.startsWith('@aws-sdk/')
  );
}

interface Violation {
  readonly chain: readonly string[];
  readonly reason: string;
}

interface WalkResult {
  readonly reached: ReadonlySet<string>;
  readonly externals: ReadonlySet<string>;
  readonly violations: readonly Violation[];
  readonly unresolved: readonly string[];
}

/**
 * Breadth-first walk from a root module. BFS (rather than DFS) means the reported chain is
 * the SHORTEST path to the violation — the least confusing one to read and fix.
 */
function walk(root: string): WalkResult {
  const parent = new Map<string, string>();
  const reached = new Set<string>();
  const externals = new Set<string>();
  const violations: Violation[] = [];
  const unresolved: string[] = [];
  const visited = new Set<string>([root]);
  const queue: string[] = [root];

  const chainTo = (file: string): readonly string[] => {
    const chain: string[] = [rel(file)];
    let cursor = file;
    for (;;) {
      const next = parent.get(cursor);
      if (next === undefined) {
        break;
      }
      chain.unshift(rel(next));
      cursor = next;
    }
    return chain;
  };

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }

    for (const specifier of importsOf(current)) {
      const resolution = resolveSpecifier(specifier, current);

      if (resolution.kind === 'unresolved') {
        unresolved.push(`${rel(current)} -> ${resolution.specifier}`);
        continue;
      }

      if (resolution.kind === 'external') {
        externals.add(resolution.specifier);
        if (isForbiddenExternal(resolution.specifier)) {
          violations.push({
            chain: [...chainTo(current), resolution.specifier],
            reason: FORBIDDEN_BUILTINS.has(resolution.specifier)
              ? 'node builtin implying execution or network'
              : 'AWS SDK (Milestone 2 store adapter)',
          });
        }
        continue;
      }

      if (isForbiddenInternal(resolution.file)) {
        // Importing it at all is the violation, so the walk stops here rather than
        // descending into Milestone 2's own dependencies.
        violations.push({
          chain: [...chainTo(current), rel(resolution.file)],
          reason: FORBIDDEN_INTERNAL_FILES.includes(rel(resolution.file))
            ? 'network-touching store adapter (Milestone 2)'
            : 'Milestone 2 execution layer',
        });
        continue;
      }

      reached.add(resolution.file);
      if (!visited.has(resolution.file)) {
        visited.add(resolution.file);
        parent.set(resolution.file, current);
        queue.push(resolution.file);
      }
    }
  }

  return { reached, externals, violations, unresolved };
}

function formatViolation(root: string, violation: Violation): string {
  return `[${rel(root)}] ${violation.chain.join(' -> ')}  (${violation.reason})`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  describe('Milestone 1 does not transitively import Milestone 2 (research R6, FR-010)', () => {
    it('no oracle module reaches the execution layer, the network store, or the AWS SDK', () => {
      const failures: string[] = [];
      for (const root of ROOT_FILES) {
        for (const violation of walk(root).violations) {
          failures.push(formatViolation(root, violation));
        }
      }

      expect(
        failures,
        failures.length === 0
          ? ''
          : `Milestone 1 must stand alone. Forbidden import chains:\n${failures.join('\n')}`
      ).toEqual([]);
    });

    it('every internal import resolves to a real file (the walk is complete)', () => {
      const unresolved: string[] = [];
      for (const root of ROOT_FILES) {
        unresolved.push(...walk(root).unresolved);
      }
      expect(
        unresolved,
        `Unresolvable internal imports — the import graph has holes, so this test cannot be trusted:\n${unresolved.join('\n')}`
      ).toEqual([]);
    });
  });

  describe('constitution § Technology: file size', () => {
    it(`every file under src/ is under ${MAX_FILE_LINES} lines`, () => {
      const oversized = ALL_SRC_FILES.map((file) => ({
        file: rel(file),
        lines: countLines(fs.readFileSync(file, 'utf8')),
      }))
        .filter((entry) => entry.lines >= MAX_FILE_LINES)
        .map((entry) => `${entry.file}: ${entry.lines} lines`);

      expect(
        oversized,
        `Files at or over ${MAX_FILE_LINES} lines:\n${oversized.join('\n')}`
      ).toEqual([]);
    });
  });
});

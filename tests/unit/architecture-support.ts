import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared machinery for the architecture-boundary suites (research R6).
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
 *
 * This module is NOT a `.test.ts`, so vitest does not collect it as an (empty) suite; the
 * `architecture-*.test.ts` siblings import the single walker defined here so there is exactly
 * ONE copy of it. A second copy would drift, and a drifted boundary check is worse than none.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const SRC_DIR = path.join(REPO_ROOT, 'src');

/** Milestone 1 — the oracle. Every `.ts` file under these is a root of the walk. */
const ORACLE_ROOT_DIRS = ['src/state', 'src/graph', 'src/manifest', 'src/hash', 'src/ledger'];

/**
 * The READ verbs (T027, SC-001, FR-010) — `pc status`, `pc next`, `pc explain`,
 * `pc release-check`.
 *
 * Rooted here rather than in `tests/integration/offline.test.ts` so there is exactly ONE copy of
 * the walker. A second copy would drift, and a drifted boundary check is worse than none: it
 * reports a boundary that is not the one being enforced.
 *
 * SC-001's claim is about the shipped surface, not just the library behind it — "an agent can
 * determine the complete state of a production with no network access and no craft tools" is a
 * claim about running `pc`. Rooting only `src/state` et al. would leave the process an agent
 * actually runs unchecked, and `src/cli/episode.ts` could import an S3 client while this test
 * stayed green.
 *
 * **These roots were `['src/cli']` until Milestone 2's `pc build` landed, and this is the
 * narrowing the previous revision of this comment specified in advance.** `pc build` exists to
 * exec a craft tool (FR-029), so it reaches `child_process` BY DESIGN, and `src/cli/index.ts`
 * imports it in order to wire it. FR-010 constrains **REPORTING** state, so the read verbs are
 * exactly what it is about, and each is rooted here individually — not the directory they live
 * in.
 *
 * **Do not "fix" a future failure of this test by allowlisting a dependency.** The tempting
 * wrong move is to add `child_process` to the allowed set, or to add `src/providers/` to it:
 * either would silently relicense `pc status` to spawn processes and dial out, and this file
 * would keep passing while the guarantee it exists to prove was gone. If a read verb ever
 * reaches execution or the network, the read verb is wrong.
 *
 * Files rather than a directory glob, deliberately: a new file appearing under `src/cli/` must
 * not silently join the read-verb guarantee (it might be another builder), and a read verb being
 * RENAMED must break this test rather than quietly stop being checked. `readVerbFiles()` fails
 * loud if any of these paths stops existing.
 */
const READ_VERB_FILES = [
  'src/cli/status.ts',
  'src/cli/next.ts',
  'src/cli/explain.ts',
  'src/cli/release-check.ts',
];

/**
 * The shipped dispatch entry — the file `package.json`'s `bin` runs (`dist/cli/index.js`). Every
 * `pc` invocation, read or write, is dispatched through it. SC-001's claim ("an agent can
 * determine the complete state of a production with no network and no craft tools") is a claim
 * about running `pc status`, which means running THIS file. It is rooted separately, and walked
 * EAGERLY, because its only path to execution/network is the deliberate lazy-load of the write
 * verbs — loaded only when those commands run, never on the read path (AUDIT-20260716-10).
 */
export const SHIPPED_ENTRY = 'src/cli/index.ts';

const ROOT_DIRS = [...ORACLE_ROOT_DIRS];

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

export const MAX_FILE_LINES = 500;

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

/**
 * The EAGER specifiers only — static `import ... from`/`export ... from` and bare `import 'x'`,
 * but NOT dynamic `import('x')`.
 *
 * The distinction is load-bearing for the SHIPPED-DISPATCH check (AUDIT-20260716-10). A dynamic
 * `import('x')` is a LAZY boundary: the module is loaded only when that line executes, not when the
 * importer is loaded. `src/cli/index.ts` wires `pc build`/`pc validate`/`pc asset` behind `await
 * import(...)` precisely so that dispatching a READ verb through it loads none of them. Walking
 * only the eager edges from `index.ts` therefore models exactly what `pc status` loads at startup.
 *
 * This does NOT create a laundering hole. The per-read-verb roots (`status`, `next`, …) are still
 * walked with the FULL graph below — dynamic imports included — so a read verb that reached a
 * forbidden module through `import('...')` is still caught there. Eager-only is used for ONE root,
 * `index.ts`, whose only path to forbidden code is the intentional lazy-load of the write verbs.
 */
const EAGER_SPECIFIER_PATTERNS = SPECIFIER_PATTERNS.slice(0, 2);

/** Runs a set of specifier patterns over already-cleaned code. */
function matchWith(patterns: readonly RegExp[], code: string): readonly string[] {
  const specifiers: string[] = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

/** Runs every specifier pattern (static + dynamic) over already-cleaned code. */
function matchSpecifiers(code: string): readonly string[] {
  return matchWith(SPECIFIER_PATTERNS, code);
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
 * The EAGER specifier list — the runtime import graph a module pulls in the moment IT is loaded,
 * excluding dynamic `import('x')` (loaded on demand). See `EAGER_SPECIFIER_PATTERNS`.
 */
function extractEagerSpecifiers(source: string): readonly string[] {
  return matchWith(EAGER_SPECIFIER_PATTERNS, stripTypeOnlyImports(stripComments(source)));
}

/**
 * Same extraction, WITHOUT stripping type-only imports. Used only to prove the regex
 * fires on a file at all — a file whose only import is type-only legitimately has zero
 * runtime specifiers, which must not be confused with "the extraction is broken."
 */
export function rawSpecifierCount(source: string): number {
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

export function resolveSpecifier(specifier: string, importer: string): Resolution {
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
export function listTsFiles(dir: string): readonly string[] {
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

export function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

/** Matches `wc -l`: a trailing newline terminates the last line, it does not start a new one. */
export function countLines(source: string): number {
  const lines = source.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.length - 1;
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// The import graph
// ---------------------------------------------------------------------------

export const ALL_SRC_FILES = listTsFiles(SRC_DIR);

export const IMPORTS_BY_FILE = new Map<string, readonly string[]>(
  ALL_SRC_FILES.map((file) => [file, extractSpecifiers(fs.readFileSync(file, 'utf8'))])
);

/** The EAGER-only graph: same files, but dynamic `import('x')` edges excluded (see the walk). */
export const EAGER_IMPORTS_BY_FILE = new Map<string, readonly string[]>(
  ALL_SRC_FILES.map((file) => [file, extractEagerSpecifiers(fs.readFileSync(file, 'utf8'))])
);

export function importsOf(
  file: string,
  importsByFile: ReadonlyMap<string, readonly string[]> = IMPORTS_BY_FILE
): readonly string[] {
  const specifiers = importsByFile.get(file);
  if (specifiers === undefined) {
    throw new Error(`No parsed imports for ${rel(file)} — the import graph is incomplete.`);
  }
  return specifiers;
}

/**
 * The read verbs, resolved to real files — throwing if one is missing rather than skipping it.
 *
 * A silently-empty root list is how this check goes vacuous: the walk would find no violations
 * because it walked nothing, and the suite would be green over an unenforced boundary.
 */
function readVerbFiles(): readonly string[] {
  return READ_VERB_FILES.map((relative) => {
    const file = path.join(REPO_ROOT, relative);
    if (!fs.existsSync(file)) {
      throw new Error(
        `${relative} does not exist. It is rooted here as one of the READ verbs FR-010 ` +
          `constrains — if it was renamed, rename it in READ_VERB_FILES too. Do not simply ` +
          `remove it: an unrooted read verb is an unchecked one.`
      );
    }
    return file;
  });
}

export const CLI_ROOT_FILES = readVerbFiles();
export const ROOT_FILES = [
  ...ROOT_DIRS.flatMap((dir) => listTsFiles(path.join(REPO_ROOT, dir))),
  ...CLI_ROOT_FILES,
];

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
export function walk(
  root: string,
  importsByFile: ReadonlyMap<string, readonly string[]> = IMPORTS_BY_FILE
): WalkResult {
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

    for (const specifier of importsOf(current, importsByFile)) {
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

export function formatViolation(root: string, violation: Violation): string {
  return `[${rel(root)}] ${violation.chain.join(' -> ')}  (${violation.reason})`;
}

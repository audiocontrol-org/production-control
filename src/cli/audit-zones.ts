import * as path from 'node:path';
import * as process from 'node:process';
import * as url from 'node:url';
import { buildGraph, type Graph, type Node } from '@/graph/build.js';
import { loadEpisode, loadProfile } from '@/manifest/load.js';
import type { Identity, ProviderDecl } from '@/manifest/schema.js';
import { createStdioOutput, type Output } from '@/cli/output.js';
import { EXIT_FAILED, EXIT_OK, runVerb, toJsonText, type ReadOptions } from '@/cli/runtime.js';
import { classifyZone, impureOutputRoot, type Zone } from '@/zoning/index.js';

/**
 * `pc audit-zones` (T020, User Story 3) — the read-only routing-POLICY audit
 * (specs/003-content-zone-segregation/contracts/audit-verb.md, data-model.md § AuditReport).
 *
 * This is LEXICAL routing-policy only, over the resolved manifest/graph. It reads and writes
 * nothing. It does NOT `fs.realpath`, does NOT touch the filesystem for output locations, and
 * does NOT resolve a provider's actual output or object storage — symlink/escape/runtime-filename
 * resolution is BUILD-TIME ONLY (`pc build`, `src/providers/build.ts`'s `stage`) and explicitly
 * out of this audit's scope (contract Non-goals). Every run — clean or dirty, `--json` or not —
 * states that boundary (FR-014), so a caller can never mistake "no policy violation" for "verified
 * on disk".
 *
 * It checks exactly two things, both answerable from manifest data alone:
 *
 *   1. Every IMPURE target's assigned output root (`impureOutputRoot()`) classifies
 *      `ai-permitted`. Under today's fixed routing policy (`src/zoning/route.ts`) this always
 *      holds — there is no per-target output override for a manifest to misconfigure — so this is
 *      a policy-consistency guard against a future regression (the impure root becoming
 *      dot-free), not a check that can fail on manifest data today.
 *   2. Every AUTHORED node's declared path classifies `human-safe` (FR-006/D2b). This IS a live,
 *      manifest-constructible violation: nothing stops an operator from writing
 *      `authored: { spoken: { path: '.ai/script.md' } }`.
 *
 * Deliberately NOT `deps.loader.load()` / `resolveStatus` / `validateGraph`: `validateGraph`'s own
 * Rule 7 REFUSES (throws) exactly the authored-in-a-dot-zone manifest this audit exists to report
 * on — a strict load would throw before a single line printed, and the FR-014 scope statement
 * would never reach the caller for the one case this verb is most useful for. `buildGraph` is pure
 * construction (`src/graph/build.ts`): it refuses nothing, so this audit can load leniently and
 * report the violation as data instead of crashing on it.
 */

/**
 * The seams. Deliberately NOT `CliDeps` (`src/cli/runtime.js`): that shape's `loader` is the
 * STRICT `EpisodeLoader`, which runs `validateGraph`/`resolveStatus` and throws on the very
 * manifest this audit must load leniently (see the module header). `cwd` and `profileDirs` are
 * the same two seams `EpisodeLoaderConfig` carries, kept here independently so this verb's load
 * path never goes through the strict one — mirrors `AssetDeps` in `src/cli/asset.ts`, which stays
 * off `CliDeps` for the same kind of reason (a different reach than the read verbs share).
 */
export interface AuditDeps {
  /** `--episode` is resolved against this. */
  readonly cwd: string;
  /** Where to look for a profile after the episode's own directory; first match wins. */
  readonly profileDirs: readonly string[];
  readonly output: Output;
}

/**
 * The package root, derived the same way `runtime.ts`'s does: `dist/cli/audit-zones.js` → the
 * package root, `src/cli/audit-zones.ts` under vitest → the repo root — the directory that owns
 * `profiles/`.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

/** The real process's seams. */
export function createAuditDeps(): AuditDeps {
  return {
    cwd: process.cwd(),
    profileDirs: [path.join(PACKAGE_ROOT, 'profiles')],
    output: createStdioOutput(),
  };
}

/**
 * FR-014's honesty boundary, stated in full every run. The exact wording is this verb's to
 * choose; the substance (checked only at build time, not by this audit) is the contract's.
 */
const SCOPE_STATEMENT =
  'Scope: this audit checks routing POLICY over the manifest, lexically. Provider-chosen runtime ' +
  'filenames and any runtime escape (a symlink, a real-path divergence) are verified only at ' +
  'build time (`pc build`), never by this audit.';

/** `data-model.md`'s `ContentClass` — read, not added (existing node/provider distinction). */
export type ContentClass = 'authored' | 'pure-derived' | 'impure-derived';

/** `data-model.md` § AuditReport: the per-offending-target shape. */
export interface AuditViolationJson {
  readonly id: Identity;
  readonly class: ContentClass;
  readonly assignedRoot: string;
  readonly expectedZone: Zone;
  readonly actualZone: Zone;
}

export interface AuditReportJson {
  readonly episode: string;
  readonly violations: readonly AuditViolationJson[];
  readonly scope: string;
}

function authoredPath(node: Node): string {
  if (node.path === undefined) {
    throw new Error(
      `Authored node "${node.id}" carries no declared path — buildGraph always sets one for an ` +
        `authored node, so an authored node without one is a graph-construction defect, not a ` +
        `normal refusal.`
    );
  }
  return node.path;
}

function derivedProvider(node: Node): ProviderDecl {
  if (node.provider === undefined) {
    throw new Error(
      `Derived node "${node.id}" carries no provider declaration — buildGraph always sets one for ` +
        `a derived node, so a derived node without one is a graph-construction defect, not a ` +
        `normal refusal.`
    );
  }
  return node.provider;
}

/**
 * Check 2 (the live check, FR-006/D2b): an authored node's declared path must classify
 * `human-safe`. `node.path` already carries a basename (the authored file itself), so it is
 * passed to `classifyZone` with `kind: 'file'` exactly as `src/graph/validate.ts`'s Rule 7 does —
 * the basename must NOT participate in the any-dot-wins check (only its directory segments do).
 */
function authoredViolation(node: Node): AuditViolationJson | undefined {
  const assignedRoot = authoredPath(node);
  const expectedZone: Zone = 'human-safe';
  const actualZone = classifyZone(assignedRoot, 'file');
  if (actualZone === expectedZone) {
    return undefined;
  }
  return { id: node.id, class: 'authored', assignedRoot, expectedZone, actualZone };
}

/**
 * Check 1 (the policy-consistency guard): an impure target's assigned output root
 * (`impureOutputRoot()`) must classify `ai-permitted`. A pure-derived target is not checked at
 * all — either zone is acceptable for it (data-model.md's agreement rule).
 *
 * `impureOutputRoot()` returns a bare root DIRECTORY (`.ai`), not a file path, so it is classified
 * with `kind: 'directory'` — every segment participates in the any-dot-wins check and the bare
 * `.ai` root reads as `ai-permitted`, what it is.
 */
function impureTargetViolation(node: Node): AuditViolationJson | undefined {
  const provider = derivedProvider(node);
  if (provider.impure === undefined) {
    return undefined;
  }
  const assignedRoot = impureOutputRoot();
  const expectedZone: Zone = 'ai-permitted';
  const actualZone = classifyZone(assignedRoot, 'directory');
  if (actualZone === expectedZone) {
    return undefined;
  }
  return { id: node.id, class: 'impure-derived', assignedRoot, expectedZone, actualZone };
}

/**
 * Every violation, in graph node order (declaration-driven — `buildGraph` inserts authored nodes
 * then reachable derived targets, each in their declaration's own order; see `build.ts`).
 */
function auditViolations(graph: Graph): readonly AuditViolationJson[] {
  const violations: AuditViolationJson[] = [];
  for (const node of graph.nodes.values()) {
    const violation =
      node.kind === 'authored' ? authoredViolation(node) : impureTargetViolation(node);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }
  return violations;
}

export function buildAuditReport(episode: string, graph: Graph): AuditReportJson {
  return { episode, violations: auditViolations(graph), scope: SCOPE_STATEMENT };
}

/** `id  class  assigned -> expected/actual` — the scope statement always trails, clean or not. */
function renderAudit(report: AuditReportJson): readonly string[] {
  const lines: string[] = [];
  if (report.violations.length === 0) {
    lines.push('clean: every routing-policy check passed — no violation found.');
  } else {
    lines.push(`${String(report.violations.length)} routing-policy violation(s):`);
    for (const v of report.violations) {
      lines.push(
        `  ${v.id}  (${v.class})  root=${v.assignedRoot}  expected=${v.expectedZone}  actual=${v.actualZone}`
      );
    }
  }
  lines.push(report.scope);
  return lines;
}

export async function auditZonesCommand(deps: AuditDeps, options: ReadOptions): Promise<number> {
  return runVerb(deps.output, 'audit-zones', async () => {
    const episodeDir = path.resolve(deps.cwd, options.episode ?? '.');

    // Leniently loaded (see the module header): no `validateGraph`, no `resolveStatus`. A
    // malformed manifest/profile (bad YAML, a schema refusal, an unreachable profile) still
    // throws here and is reported as a named failure via `runVerb` — only the graph-level
    // refusals `validateGraph` would add are the ones this verb deliberately does not run, so
    // it can report them as findings instead.
    const manifest = await loadEpisode(episodeDir);
    const profile = await loadProfile(manifest.profile, [episodeDir, ...deps.profileDirs]);
    const graph = buildGraph(manifest, profile);

    const report = buildAuditReport(manifest.id, graph);

    if (options.json === true) {
      deps.output.out(toJsonText(report));
    } else {
      for (const line of renderAudit(report)) {
        deps.output.out(line);
      }
    }

    return report.violations.length === 0 ? EXIT_OK : EXIT_FAILED;
  });
}

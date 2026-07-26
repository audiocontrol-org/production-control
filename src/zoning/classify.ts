import * as path from 'node:path';

/**
 * The Zone a path resolves to: `human-safe` (no impure output may occupy it — INV-1;
 * authored content belongs here) or `ai-permitted` (impure output belongs here; pure/
 * operational files may also live here). See specs/003-content-zone-segregation/data-model.md.
 */
export type Zone = 'human-safe' | 'ai-permitted';

/**
 * Thrown by `classifyZone` when its precondition (root-relative, non-climbing input) is
 * violated. Named so a caller can distinguish "malformed input" from any other `Error`.
 */
export class ClassifyZoneInputError extends Error {
  constructor(relPath: string, reason: string) {
    super(
      `classifyZone requires a root-relative, non-climbing path; received "${relPath}", which ${reason}.`
    );
    this.name = 'ClassifyZoneInputError';
  }
}

/**
 * Classifies a production-root-relative path into a `Zone`.
 *
 * Pure, total-WITH-REFUSAL, and lexical — no I/O, no configuration, nothing read but `relPath`.
 * The rule (specs/003-content-zone-segregation/contracts/zone-classifier.md, "any-dot-wins"): a
 * path is `ai-permitted` iff at least one of its DIRECTORY segments (every segment except the
 * basename) begins with `.`. The basename never participates on its own — `dist/.draft.md` is a
 * dot-FILE in a clean directory, and stays `human-safe`.
 *
 * `relPath`'s precondition is ENFORCED, not assumed: this function throws `ClassifyZoneInputError`
 * rather than classifying when the input is an ABSOLUTE path, or when any segment is exactly
 * `..` (a path climbing above the production root). A violated precondition must never resolve
 * to the PERMISSIVE verdict — treating `..` as a dot-directory via "any-dot-wins" would fail
 * OPEN, which defeats zoning as defense-in-depth in exactly the case it exists for (AUDIT-01).
 * In the enforcement path the caller additionally `realpath`-resolves before calling, so a
 * symlink cannot be classified by a lexical alias (FR-010) — this function does no resolution
 * of its own, only the refusal above.
 *
 * Basename vs. directory segment is decided structurally, not by presence of a `.` in the
 * segment: a trailing `/` means every segment — including the last — names a directory (there is
 * no basename to exclude), so `dist/.ai/` classifies its trailing `.ai` segment same as any other
 * directory segment. A path with no trailing `/` treats its last segment as the basename, which
 * is excluded from the check no matter what it starts with.
 */
export function classifyZone(relPath: string): Zone {
  if (path.posix.isAbsolute(relPath) || path.isAbsolute(relPath)) {
    throw new ClassifyZoneInputError(relPath, 'is an absolute path, not root-relative');
  }

  // POSIX splitting only, as the contract requires. A leading './' is a no-op segment that must
  // not itself be mistaken for a dot-directory, so it is dropped along with any other empty
  // segment produced by normalization quirks (leading '/', repeated '//').
  const rawSegments = relPath.split('/').filter((segment) => segment !== '' && segment !== '.');

  if (rawSegments.some((segment) => segment === '..')) {
    throw new ClassifyZoneInputError(
      relPath,
      'contains a ".." segment that climbs above the production root'
    );
  }

  const hasTrailingSlash = relPath.endsWith('/');
  const directorySegments = hasTrailingSlash ? rawSegments : rawSegments.slice(0, -1);

  const isAiPermitted = directorySegments.some((segment) => segment.startsWith('.'));
  return isAiPermitted ? 'ai-permitted' : 'human-safe';
}

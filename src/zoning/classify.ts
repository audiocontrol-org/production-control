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
 * path is `ai-permitted` iff at least one of its DIRECTORY segments begins with `.`. Which
 * segments count as directory segments is decided by the REQUIRED `kind` parameter, never by a
 * trailing `/`:
 *   - `kind: 'directory'` — the path NAMES a directory, so EVERY segment is a directory segment and
 *     participates in the check. `classifyZone('.ai', 'directory')` is `ai-permitted`: the bare
 *     dot-zone root classifies as the zone it is the root of.
 *   - `kind: 'file'` — the LAST segment is the basename and is EXCLUDED. The basename never
 *     participates on its own, so `dist/.draft.md` (a dot-FILE in a clean directory) and a file
 *     literally named `.ai` both stay `human-safe`.
 *
 * `kind` is compiler-enforced precisely because the type `(string) => Zone` made an omitted
 * trailing slash on a directory path indistinguishable from a file path — and the failure landed
 * on the PERMISSIVE side (a directory root like `.ai` misread as a human-safe dotfile). Requiring
 * the caller to state file-vs-directory closes that footgun structurally (AUDIT-14/15), the same
 * false-safe class as the `..` refusal below (AUDIT-01).
 *
 * `relPath`'s precondition is ENFORCED, not assumed: this function throws `ClassifyZoneInputError`
 * rather than classifying when the input is an ABSOLUTE path, or when it NORMALIZES to a path
 * that climbs above the production root (a leading `..`). A violated precondition must never
 * resolve to the PERMISSIVE verdict — treating `..` as a dot-directory via "any-dot-wins" would
 * fail OPEN, which defeats zoning as defense-in-depth in exactly the case it exists for (AUDIT-01).
 * The check is normalize-THEN-refuse (not a raw-segment scan) so it agrees with the manifest's
 * `RelativePathSchema`, which accepts an interior `..` that normalizes back inside the root
 * (`a/../b.md` → `b.md`, `human-safe`) and refuses only a value whose normal form escapes.
 * In the enforcement path the caller additionally `realpath`-resolves before calling, so a
 * symlink cannot be classified by a lexical alias (FR-010) — this function does no resolution
 * of its own, only the normalization and refusal above.
 */
export function classifyZone(relPath: string, kind: 'file' | 'directory'): Zone {
  if (path.posix.isAbsolute(relPath) || path.isAbsolute(relPath)) {
    throw new ClassifyZoneInputError(relPath, 'is an absolute path, not root-relative');
  }

  // Normalize first, so an interior `..` that stays within the root collapses away (`a/../b.md`
  // → `b.md`) — matching `RelativePathSchema`'s normalize-then-check semantics — while a genuine
  // climb survives as a leading `..` and is refused below (never classified as ai-permitted).
  const normalized = path.posix.normalize(relPath);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new ClassifyZoneInputError(
      relPath,
      'normalizes to a path that climbs above the production root'
    );
  }

  // POSIX splitting only, as the contract requires. A leading './' is a no-op segment that must
  // not itself be mistaken for a dot-directory, so it is dropped along with any other empty
  // segment produced by normalization quirks (leading '/', repeated '//', a trailing '/').
  const rawSegments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');

  // The `kind` parameter — not a trailing slash — governs which segments are directory segments:
  // a directory path exposes every segment to the check; a file path excludes its basename.
  const directorySegments = kind === 'directory' ? rawSegments : rawSegments.slice(0, -1);

  const isAiPermitted = directorySegments.some((segment) => segment.startsWith('.'));
  return isAiPermitted ? 'ai-permitted' : 'human-safe';
}

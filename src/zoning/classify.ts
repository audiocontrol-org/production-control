/**
 * The Zone a path resolves to: `human-safe` (no impure output may occupy it — INV-1;
 * authored content belongs here) or `ai-permitted` (impure output belongs here; pure/
 * operational files may also live here). See specs/003-content-zone-segregation/data-model.md.
 */
export type Zone = 'human-safe' | 'ai-permitted';

/**
 * Classifies a production-root-relative path into a `Zone`.
 *
 * Pure, total, and lexical — no I/O, no configuration, nothing read but `relPath`. The rule
 * (specs/003-content-zone-segregation/contracts/zone-classifier.md, "any-dot-wins"): a path is
 * `ai-permitted` iff at least one of its DIRECTORY segments (every segment except the basename)
 * begins with `.`. The basename never participates on its own — `dist/.draft.md` is a dot-FILE
 * in a clean directory, and stays `human-safe`.
 *
 * `relPath` is caller-resolved: it is assumed already relative to the production root (no `..`
 * climbing above it — that is the caller's concern, not this function's, per Rule 5) and, in the
 * enforcement path, `realpath`-resolved so a symlink cannot be classified by a lexical alias
 * (FR-010). This function does no resolution of its own.
 *
 * Basename vs. directory segment is decided structurally, not by presence of a `.` in the
 * segment: a trailing `/` means every segment — including the last — names a directory (there is
 * no basename to exclude), so `dist/.ai/` classifies its trailing `.ai` segment same as any other
 * directory segment. A path with no trailing `/` treats its last segment as the basename, which
 * is excluded from the check no matter what it starts with.
 */
export function classifyZone(relPath: string): Zone {
  // POSIX splitting only, as the contract requires. A leading './' is a no-op segment that must
  // not itself be mistaken for a dot-directory, so it is dropped along with any other empty
  // segment produced by normalization quirks (leading '/', repeated '//').
  const rawSegments = relPath.split('/').filter((segment) => segment !== '' && segment !== '.');

  const hasTrailingSlash = relPath.endsWith('/');
  const directorySegments = hasTrailingSlash ? rawSegments : rawSegments.slice(0, -1);

  const isAiPermitted = directorySegments.some((segment) => segment.startsWith('.'));
  return isAiPermitted ? 'ai-permitted' : 'human-safe';
}

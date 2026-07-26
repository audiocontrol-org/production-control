import type { SourceUnit } from '@/units/derive.ts';

/**
 * Stable string form of a source unit's durable-identity triple
 * `(source identity, content_hash, occurrence_index)` (D6.9).
 *
 * The source identity is percent-encoded so the `:` separators remain
 * unambiguous, making the encoding injective: two units yield the same id iff
 * all three components are equal. A content hash alone does not bind a unit to
 * a particular declared source, so the source identity is part of the id.
 */
export function unitId(sourceIdentity: string, unit: SourceUnit): string {
  if (sourceIdentity.length === 0) {
    throw new Error('unitId requires a non-empty source identity');
  }
  return `${encodeURIComponent(sourceIdentity)}:${unit.contentHash}:${unit.occurrenceIndex}`;
}

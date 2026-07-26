/**
 * Narrow an `unknown` (typically a parsed-YAML/JSON value) to an indexable
 * mapping via a type predicate, so callers can index it WITHOUT a type
 * assertion. Arrays and `null` are rejected — a JSON object only.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

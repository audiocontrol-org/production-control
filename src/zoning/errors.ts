/**
 * Zoning violation refusal helper.
 *
 * Produces an Error that names the offending path and applies the zoning refusal convention (FR-011).
 */

export interface ZoningRefusalParams {
  /** The path that violated zoning constraints. */
  path: string;
  /** Optional: the target id this violation belongs to. */
  target?: string;
  /** Optional: the reason for the refusal (defaults to impure-output-in-human-safe). */
  reason?: string;
}

/**
 * Creates a zoning refusal error that names the offending path and target.
 *
 * Impure outputs must resolve to an AI-permitted (dot-zoned) path; attempting to write to
 * a human-safe path is a zoning violation and must be refused loud and clear.
 */
export function zoningRefusal(params: ZoningRefusalParams): Error {
  const { path, target, reason } = params;

  const reasonPart =
    reason ||
    'impure artifact resolves to a human-safe path — impure artifacts must resolve to an AI-permitted (dot-zoned) path';

  let message = `${reasonPart} "${path}"`;

  if (target) {
    message += ` (target: ${target})`;
  }

  message += ' (FR-011).';

  return new Error(message);
}

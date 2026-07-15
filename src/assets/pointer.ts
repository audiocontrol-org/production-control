import { z, type ZodError } from 'zod';
import * as fs from 'node:fs/promises';
import { parse } from 'yaml';
import { HashSchema } from '@/manifest/schema.js';
import type { TrackedCheck } from '@/assets/git-tracked.js';

/**
 * Committed stand-in for bytes held outside version control (`<name>.<ext>.asset`). The
 * `asset` hash is the content address — reference and integrity claim are one string.
 * `bytes` is a non-negative integer (zero is valid) recorded for human reading.
 */
export const AssetPointerSchema = z.object({
  asset: HashSchema,
  media: z.string(),
  bytes: z.int().nonnegative(),
});

export type AssetPointer = z.infer<typeof AssetPointerSchema>;

const POINTER_SUFFIX = '.asset';

/** FR-026's stated default: files at or under 5 MiB never require a stand-in. */
const DEFAULT_MAX_INLINE_BYTES = 5 * 1024 * 1024;

/**
 * Reads and parses the `<declaredPath>.asset` stand-in beside `declaredPath`, if one
 * exists. Returns `null` when there is no stand-in file — that is not an error, it just
 * means `declaredPath` is (or should be) a plain file.
 *
 * Throws, naming the stand-in path and the offending field, when a stand-in exists but
 * is malformed: unparsable YAML, or content that fails `AssetPointerSchema` (e.g. a
 * badly formed `asset` hash). Absence and malformedness are deliberately different
 * outcomes — never collapse a bad stand-in into `null`.
 */
export async function readPointer(declaredPath: string): Promise<AssetPointer | null> {
  const pointerPath = `${declaredPath}${POINTER_SUFFIX}`;
  const text = await readFileIfExists(pointerPath);
  if (text === null) {
    return null;
  }

  const raw = parsePointerYaml(pointerPath, text);
  const result = AssetPointerSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatSchemaError(pointerPath, result.error));
  }
  return result.data;
}

/** Resolution outcome for one authored path. */
export type AuthoredResolution =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'pointer'; readonly pointer: AssetPointer }
  | { readonly kind: 'absent' };

/**
 * `maxInlineBytes` defaults to 5 MiB (`DEFAULT_MAX_INLINE_BYTES`) when omitted.
 * `tracked` defaults to treating every file as UNTRACKED when omitted — the
 * conservative reading, since it makes the FR-026 guard MORE likely to fire rather
 * than silently disabling it for callers that forget to wire a check.
 */
export interface GuardOptions {
  readonly maxInlineBytes?: number;
  readonly tracked?: TrackedCheck;
}

/**
 * Resolve a declared authored path against the local filesystem ONLY (FR-025). This
 * function MUST NOT contact the asset store — a stand-in already carries the content
 * address, so nothing needs fetching to answer "what is this input's hash". This is
 * exactly what lets `pc status` run offline and instantly.
 *
 * If `<declaredPath>.asset` exists, its parsed contents answer the question by
 * themselves: `{ kind: 'pointer', pointer }` — even when the bytes it addresses are
 * absent from the store, and even when the plain file does not exist on disk (see
 * `tests/fixtures/asset`). Whether the store actually holds those bytes is unknowable
 * without contacting it, so this function never attempts a HEAD request or any other
 * reachability check against the store — do not "fix" this by adding one. That check
 * belongs to the later operation that genuinely needs the bytes; that is where their
 * absence must surface, never here.
 *
 * When there is no stand-in, the plain file is stat'd:
 *   - present -> `{ kind: 'file', path }`, subject to the FR-026 guard below
 *   - absent  -> `{ kind: 'absent' }`
 *
 * FR-026 guard: throws, naming `declaredPath`, when the plain file is all three of:
 * larger than `opts.maxInlineBytes` (default 5 MiB), has no stand-in (already
 * established, since we only reach this branch without one), and is not tracked
 * according to `opts.tracked` (an injected `TrackedCheck`, see git-tracked.ts). When
 * `opts.tracked` is omitted, every file is treated as untracked — the conservative
 * default. The trigger is purely the size threshold — never a guess about whether the
 * content "looks binary" — so an author can predict the refusal in advance.
 */
export async function resolveAuthored(
  declaredPath: string,
  opts?: GuardOptions
): Promise<AuthoredResolution> {
  const pointer = await readPointer(declaredPath);
  if (pointer !== null) {
    return { kind: 'pointer', pointer };
  }

  const stat = await statIfExists(declaredPath);
  if (stat === null) {
    return { kind: 'absent' };
  }

  const maxInlineBytes = opts?.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
  const tracked = opts?.tracked;
  const isTracked = tracked !== undefined ? await tracked.isTracked(declaredPath) : false;
  if (stat.size > maxInlineBytes && !isTracked) {
    throw new Error(
      `Authored path "${declaredPath}" is ${String(stat.size)} bytes, over the ` +
        `${String(maxInlineBytes)}-byte inline limit, has no "${declaredPath}${POINTER_SUFFIX}" ` +
        `stand-in, and is not tracked by git. Run \`pc asset add ${declaredPath}\` to move its ` +
        `bytes into the asset store and commit the stand-in in its place.`
    );
  }

  return { kind: 'file', path: declaredPath };
}

async function statIfExists(filePath: string): Promise<{ size: number } | null> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to stat "${filePath}": ${message}`, { cause: error });
  }
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read "${filePath}": ${message}`, { cause: error });
  }
}

function parsePointerYaml(pointerPath: string, text: string): unknown {
  try {
    const raw: unknown = parse(text);
    return raw;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${pointerPath}: malformed YAML — ${message}`, { cause: error });
  }
}

function formatSchemaError(pointerPath: string, error: ZodError): string {
  const details = error.issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : '(root)';
      return `${field}: ${issue.message}`;
    })
    .join('; ');
  return `${pointerPath}: ${details}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

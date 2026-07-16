import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { stringify } from 'yaml';
import { z } from 'zod';
import { envStoreProvider, type StoreProvider } from '@/assets/config.js';
import { knownExtensions, mediaTypeForExtension } from '@/assets/media.js';
import { readPointer, type AssetPointer } from '@/assets/pointer.js';
import { createStdioOutput, type Output } from '@/cli/output.js';
import { EXIT_OK, EXIT_USAGE, runVerb, toJsonText } from '@/cli/runtime.js';
import { hashBytes, type Hash } from '@/hash/content.js';

/**
 * `pc asset add <file>` (T071, FR-023, FR-024, FR-028, FR-036).
 *
 * Moves a file's bytes into the content-addressed store and leaves a small, committable stand-in
 * beside it. The stand-in is the half that lives in git; the bytes are the half that does not.
 *
 * **There is no overwrite path, and its absence is the guarantee** (FR-028). Every address is
 * derived from the bytes themselves, so re-adding identical bytes is a no-op at the same address
 * (FR-024) and re-adding CHANGED bytes is a new asset at a new address — the prior one is
 * untouched and stays retrievable. Nothing here takes an address from a caller, and nothing here
 * writes to an address it did not compute. A "revision" is a new asset; it is never an edit.
 *
 * This is the mutating counterpart to the oracle's refusal to fetch. `pc status` resolves a
 * stand-in offline because the stand-in already carries the address (FR-025) — this verb is what
 * puts the address there, and it is the only verb in the CLI that must reach the store to do its
 * job.
 */

/**
 * The seams. `store` rather than an `AssetStore` so the CONFIG READ is deferred too: this verb
 * always needs a store, and the refusal for an unconfigured one must name the missing variable
 * rather than surface as a client constructed against nothing (FR-036).
 *
 * Deliberately NOT `CliDeps`: that shape is shared with the read verbs, and hanging a store on it
 * would put the AWS SDK on `pc status`'s import path — the exact reach
 * `tests/unit/architecture.test.ts` proves the read verbs do not have (FR-010, FR-025).
 */
export interface AssetDeps {
  readonly output: Output;
  readonly store: StoreProvider;
}

/** The real process's seams, bound here rather than in `runtime.ts` — see `AssetDeps`. */
export function createAssetDeps(): AssetDeps {
  return { output: createStdioOutput(), store: envStoreProvider(process.env) };
}

const AssetAddOptionsSchema = z.object({
  media: z.string().optional(),
  json: z.boolean().optional(),
});

export type AssetAddOptions = z.infer<typeof AssetAddOptionsSchema>;

/** Reads commander's untyped bag into a typed shape; see `runtime.readOptions`. */
export function readAssetAddOptions(raw: unknown): AssetAddOptions {
  const parsed = AssetAddOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Could not read command options: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Snake_case for the recorded fields: `asset`, `media`, and `bytes` are reported under exactly
 * the names the stand-in itself uses, so an agent reading this and an agent reading the `.asset`
 * file see the same facts spelled the same way.
 */
export interface AssetAddJson {
  readonly file: string;
  readonly standin: string;
  readonly asset: Hash;
  readonly media: string;
  readonly bytes: number;
  /** `false` = these exact bytes were already in the store: a no-op at the same address (FR-024). */
  readonly stored: boolean;
  /** `false` = the stand-in beside the file already said exactly this. */
  readonly standin_written: boolean;
  /**
   * `true` = the original bytes were moved OUT of the working tree this run (the store confirmed it
   * holds them, then the local file was removed) so only the stand-in remains committable (FR-023,
   * AUDIT-20260716-22). `false` = nothing was removed: an already-added file re-run whose original
   * was gone before this invocation, so there was nothing left to move.
   */
  readonly original_removed: boolean;
}

/**
 * The human rendering. It leads with whether anything actually happened, because "no-op" and
 * "added" are the two outcomes a re-run is asking about, and content addressing makes the
 * distinction real rather than cosmetic.
 */
function renderAssetAdd(answer: AssetAddJson): readonly string[] {
  const lines = [
    `${answer.stored ? 'added ' : 'no-op '} ${answer.file}`,
    `  asset:    ${answer.asset}`,
    `  media:    ${answer.media}`,
    `  bytes:    ${String(answer.bytes)}`,
    `  stand-in: ${answer.standin}  (${answer.standin_written ? 'written' : 'unchanged'})`,
  ];
  if (answer.original_removed) {
    lines.push(
      `  original: ${answer.file} moved into the store and removed — only the stand-in stays in git (FR-023).`
    );
  }
  if (!answer.stored) {
    lines.push(
      `  These exact bytes are already stored at this address — nothing was uploaded (FR-024).`
    );
  }
  return lines;
}

/** Emits the answer as `--json` or as the human rendering, so every exit path reports identically. */
function emit(deps: AssetDeps, options: AssetAddOptions, answer: AssetAddJson): void {
  if (options.json === true) {
    deps.output.out(toJsonText(answer));
  } else {
    for (const line of renderAssetAdd(answer)) {
      deps.output.out(line);
    }
  }
}

type MediaResolution =
  | { readonly kind: 'known'; readonly media: string }
  | { readonly kind: 'unknown'; readonly extension: string };

/**
 * The media type to record: what `--media` declared, or what the extension implies — and a
 * REFUSAL when neither answers.
 *
 * Never a guess. The stand-in states `media` as a fact about bytes that are not in the repo, so
 * it is the only description a reader will ever get; `application/octet-stream` for the unknown
 * case would be this system asserting something nobody established. One flag is a small price.
 */
function resolveMedia(file: string, declared: string | undefined): MediaResolution {
  if (declared !== undefined) {
    return { kind: 'known', media: declared.trim() };
  }
  const extension = path.extname(file).toLowerCase();
  const inferred = mediaTypeForExtension(extension);
  return inferred === null ? { kind: 'unknown', extension } : { kind: 'known', media: inferred };
}

const POINTER_SUFFIX = '.asset';

function standinText(pointer: AssetPointer): string {
  return stringify({ asset: pointer.asset, media: pointer.media, bytes: pointer.bytes });
}

/** Reads the file's bytes, or `null` when nothing is there. Any other failure is named and thrown. */
async function readFileIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read "${filePath}": ${message}`, { cause: error });
  }
}

/**
 * Adds `file` to the store, writes its stand-in, and moves the original OUT of the working tree —
 * or refuses NAMING what is wrong.
 *
 * The order is deliberate. Everything that can be decided from the caller's own arguments — does
 * the file exist, is the media type knowable — is settled BEFORE the store is touched, so a
 * mistyped path or a missing `--media` never turns into a network round trip and never reports an
 * unconfigured store to someone whose real problem was a typo.
 *
 * **The original bytes are removed only AFTER the store has confirmed it holds them** (FR-023,
 * AUDIT-20260716-22): the point of the verb is that the large bytes stop living in git and only the
 * committable stand-in stays. Leaving the original beside the stand-in would ship BOTH — the very
 * bytes the stand-in exists to replace, still exactly where git would pick them up. The removal is
 * never a delete-before-confirm: if the store cannot be reached or does not report holding the
 * address, this throws and the local bytes stay put.
 */
export async function assetAddCommand(
  deps: AssetDeps,
  file: string,
  options: AssetAddOptions
): Promise<number> {
  return runVerb(deps.output, 'asset add', async () => {
    const bytes = await readFileIfExists(file);
    if (bytes === null) {
      // The original is not beside the stand-in. Either this file was never added, or a prior
      // `pc asset add` already moved its bytes into the store and removed it — a re-add.
      return await reAddOrMissing(deps, file, options);
    }

    if (options.media !== undefined && options.media.trim().length === 0) {
      deps.output.err(
        `pc asset add: --media was given as an empty string for "${file}". A stand-in records ` +
          `the media type as a fact about bytes that are not in the repo; an empty one states ` +
          `nothing.`
      );
      return EXIT_USAGE;
    }

    const media = resolveMedia(file, options.media);
    if (media.kind === 'unknown') {
      // A refusal rather than `application/octet-stream`: see `resolveMedia`. Exit 2 — the caller
      // can fix it with one flag, and it is neither a store problem nor a gate's verdict.
      const described =
        media.extension === ''
          ? `"${file}" has no extension`
          : `"${media.extension}" is not an extension this system knows`;
      deps.output.err(
        `pc asset add: ${described}, so the media type of "${file}" cannot be inferred. Pass ` +
          `\`--media <type>\` to state it. Guessing is not on the table: the stand-in is the only ` +
          `description of bytes that are not in the repo, and a wrong media type recorded as ` +
          `fact is worse than this refusal. Known extensions: ${knownExtensions().join(', ')}.`
      );
      return EXIT_USAGE;
    }

    // The address is derived from the bytes in hand, never taken from a caller or from the
    // existing stand-in — that is what makes "identical bytes are a no-op" and "changed bytes are
    // a new asset" the same rule rather than two behaviours to keep in sync (FR-024, FR-028).
    const address = hashBytes(bytes);

    // `has` before `put` so the report can say TRUTHFULLY whether anything was uploaded. `put` is
    // idempotent on its own, so this is the only thing the extra call buys — and a no-op the
    // caller cannot distinguish from an upload is not a no-op they can rely on.
    const store = await deps.store.store();
    const alreadyStored = await store.has(address);
    if (!alreadyStored) {
      const stored = await store.put(bytes);
      if (stored !== address) {
        throw new Error(
          `The asset store put these bytes at "${stored}" but they hash to "${address}". The ` +
            `store is not content-addressing them the way this system does; the stand-in would ` +
            `address content nobody can retrieve.`
        );
      }
    }

    const pointer: AssetPointer = { asset: address, media: media.media, bytes: bytes.length };
    const standinPath = `${file}${POINTER_SUFFIX}`;

    // An existing stand-in that already says exactly this is left ALONE rather than rewritten:
    // a byte-identical rewrite would dirty the working tree and make a no-op look like a change
    // to every tool a person actually watches.
    const existing = await readPointer(file);
    const standinWritten =
      existing === null ||
      existing.asset !== pointer.asset ||
      existing.media !== pointer.media ||
      existing.bytes !== pointer.bytes;
    if (standinWritten) {
      await fs.writeFile(standinPath, standinText(pointer));
    }

    // The committable half is on disk now. Move the original OUT — but only after the store CONFIRMS
    // it holds these bytes at this address. `has` is checked again here rather than trusting the
    // `put`/`already-stored` reasoning above, so the delete is provably a move into the store and
    // never a delete-before-confirm that could strand bytes nowhere (FR-023, AUDIT-20260716-22).
    if (!(await store.has(address))) {
      throw new Error(
        `pc asset add: refusing to remove "${file}". Its bytes hash to ${address}, but the store ` +
          `does not report holding that address, so deleting the local copy would lose them — the ` +
          `store did not durably accept the bytes it was given (FR-036).`
      );
    }
    await fs.unlink(file);

    emit(deps, options, {
      file,
      standin: standinPath,
      asset: address,
      media: media.media,
      bytes: bytes.length,
      stored: !alreadyStored,
      standin_written: standinWritten,
      original_removed: true,
    });

    return EXIT_OK;
  });
}

/**
 * The original bytes are not beside the stand-in. This is either a file that was never added, or a
 * re-add of one whose bytes a prior run already moved into the store. Distinguish by the stand-in,
 * and confirm the store STILL holds the bytes before calling a re-add a no-op: a stand-in whose
 * bytes live neither on disk nor in the store is a fabricated record, not a success (FR-023, FR-036,
 * AUDIT-20260716-22).
 */
async function reAddOrMissing(
  deps: AssetDeps,
  file: string,
  options: AssetAddOptions
): Promise<number> {
  const existing = await readPointer(file);
  if (existing === null) {
    deps.output.err(
      `pc asset add: nothing exists at "${file}". Name a file that is on this machine — this ` +
        `verb reads bytes and stores them; it cannot add a file it cannot read (FR-036).`
    );
    return EXIT_USAGE;
  }

  const store = await deps.store.store();
  if (!(await store.has(existing.asset))) {
    deps.output.err(
      `pc asset add: "${file}" is gone and its stand-in "${file}${POINTER_SUFFIX}" points at ` +
        `${existing.asset}, which the store does not hold. The bytes are neither beside the ` +
        `stand-in nor in the store, so there is nothing to add and nothing to recover (FR-036).`
    );
    return EXIT_USAGE;
  }

  // Already added: the bytes are safely in the store and the stand-in is beside the file. The verb's
  // whole postcondition already holds, so this is an idempotent no-op — nothing stored, nothing
  // written, nothing removed.
  emit(deps, options, {
    file,
    standin: `${file}${POINTER_SUFFIX}`,
    asset: existing.asset,
    media: existing.media,
    bytes: existing.bytes,
    stored: false,
    standin_written: false,
    original_removed: false,
  });
  return EXIT_OK;
}

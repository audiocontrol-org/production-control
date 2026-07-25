// PER-SOURCE MODEL-RESULT CACHE — the thing that makes a killed mining run resumable.
//
// THE PROBLEM. Mining a real corpus (123 sources) takes tens of minutes, and the build is
// ATOMIC: the miner never returns a partial bank, so a kill, a rate limit, or one bad model
// response at source 59 discards every source that already succeeded. That happened three
// times on real runs. Nothing about atomicity is wrong — a half-corpus bank would be a lie —
// but paying for the whole corpus again to recover from one bad answer is pure waste.
//
// THE FIX. Persist each source's MODEL OUTPUT the instant that source completes. A dead run
// leaves its completed work on disk, and the next run only asks the model about what is
// actually missing. The declared output contract is untouched: the provider still emits
// exactly one `quote-bank.yaml`. Resumability lives entirely in this side cache, which is
// not an output, not an input, and not part of any hash.
//
// WHAT IS CACHED, AND WHAT IS EMPHATICALLY NOT.
//
//   CACHED: the model's candidates — the expensive, impure, non-reproducible step.
//
//   NOT CACHED: grounded quotes. GROUNDING ALWAYS RE-RUNS against the source bytes the
//   current run loaded. This is the load-bearing safety property of this module: grounding
//   is a cheap, deterministic `bytes.indexOf`, so there is nothing to save by caching it,
//   and caching it would turn this file into a FIDELITY BYPASS — a stale or tampered entry
//   could put a passage into the bank that does not appear in the source. Because only
//   candidates are stored, a cached candidate faces exactly the same test a fresh one does
//   and is OMITTED if it is not an exact byte substring (FR-014). A corrupted cache can
//   make a run slower or emit fewer quotes; it can never make it emit an ungrounded one.
//
// LOCATION IS EXPLICIT, NEVER INFERRED. The cache is off unless a caller passes `cacheDir`
// or sets `QUOTE_MINER_CACHE_DIR`. In particular it MUST NOT default to anywhere inside the
// sources directory: that directory is a content-hashed production-control INPUT, so writing
// into it would change the input hash and spuriously re-stale the bank on every single
// build — the tool would fight the very system it feeds. Defaulting to the output directory
// is equally wrong (ingest admits exactly one output there). So: no default. An operator who
// wants resumability says where.
//
// This module imports nothing from production-control and adds no runtime dependency.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bump this whenever the selection prompt, the candidate shape, or the entry schema
 * changes. It is mixed into the entry KEY (so old entries become unreachable rather than
 * being silently reused under new semantics) and re-checked inside the entry (so an entry
 * that survives a hand-edit or a partial upgrade is still rejected).
 */
export const PROTOCOL_VERSION = 1;

/** Environment seam for the cache location; an empty value means "not set". */
export const CACHE_DIR_ENV = 'QUOTE_MINER_CACHE_DIR';

/**
 * The file an entry for these exact bytes lives at, relative to the cache directory.
 *
 * The key is the SHA-256 of the PROTOCOL VERSION followed by the source's exact bytes —
 * CONTENT, never the source id. Two consequences, both wanted: a source that is renamed but
 * unchanged still HITS (a rename is not new work), and a source whose bytes changed by one
 * character MISSES (its old candidates describe a document that no longer exists).
 *
 * @param {Buffer} bytes  the source's exact bytes
 * @returns {string}
 */
export function entryFileName(bytes) {
  const digest = createHash('sha256')
    .update(`quote-miner-cache/v${PROTOCOL_VERSION}\n`, 'utf8')
    .update(bytes)
    .digest('hex');
  return `${digest}.json`;
}

/**
 * Resolve where the cache lives: the explicit option, else the environment, else NOWHERE.
 *
 * @param {unknown} option  the caller's `cacheDir` argument, or undefined
 * @param {string | undefined} envValue  raw `QUOTE_MINER_CACHE_DIR`, or undefined
 * @returns {string | null}  null means the cache is disabled
 */
export function resolveCacheDir(option, envValue) {
  if (option !== undefined && option !== null) {
    if (typeof option !== 'string' || option.trim() === '') {
      throw new Error(
        `invalid cacheDir ${typeof option === 'string' ? `'${option}'` : String(option)}: ` +
          'must be a non-empty directory path'
      );
    }
    return option;
  }
  if (typeof envValue === 'string' && envValue.trim() !== '') return envValue;
  return null;
}

/**
 * Open the per-source cache, or return `null` when no location was configured.
 *
 * `null` is the DEFAULT and means "behave exactly as before": no directory is created, no
 * file is written, no entry is read. Callers branch on null rather than being handed a
 * silent no-op object, so "is this run cached?" is answerable by reading the call site.
 *
 * @param {{ cacheDir?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{
 *   dir: string,
 *   read(source: { id: string, bytes: Buffer }):
 *     { candidates: unknown[], modelIdentity: string } | null,
 *   write(source: { id: string, bytes: Buffer },
 *         entry: { modelIdentity: string, candidates: unknown[] }): void,
 *   stats(): { hits: number, ignored: number, writes: number }
 * } | null}
 */
export function openCache({ cacheDir, env = process.env } = {}) {
  const dir = resolveCacheDir(cacheDir, env[CACHE_DIR_ENV]);
  if (dir === null) return null;

  mkdirSync(dir, { recursive: true });

  let hits = 0;
  let ignored = 0;
  let writes = 0;
  let sequence = 0;

  return {
    dir,

    /**
     * Look up this source's cached candidates, or `null` for a miss.
     *
     * A MISS AND A BAD ENTRY ARE DIFFERENT THINGS and are counted differently: an absent
     * file is an ordinary miss, while an unreadable, unparseable, wrong-version, or
     * misshapen file is IGNORED and counted in `ignored` so an operator can see that the
     * cache is rotting. Neither is ever fatal — a cache that cannot be read must degrade to
     * "mine it again", never to "fail the run". Equally, an entry is never trusted blindly:
     * it is shape-checked here, and its candidates are re-grounded by the caller regardless.
     */
    read(source) {
      const file = join(dir, entryFileName(source.bytes));

      let raw;
      try {
        raw = readFileSync(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null; // ordinary miss
        ignored++;
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // A run killed mid-write cannot produce this (writes are atomic), but a full disk,
        // a bad sync, or a hand edit can. Treat it as absent.
        ignored++;
        return null;
      }

      if (!isUsableEntry(parsed)) {
        ignored++;
        return null;
      }

      hits++;
      return { candidates: parsed.candidates, modelIdentity: parsed.model_identity };
    },

    /**
     * Record this source's model output.
     *
     * ATOMIC BY CONSTRUCTION: the entry is written to a temp file and RENAMED into place, so
     * a kill mid-write leaves either the previous entry or no entry — never a truncated one
     * that a later run would have to guess about. The temp name carries the pid and a
     * counter so two miners sharing a cache directory cannot collide.
     *
     * The caller writes as soon as a source completes, not at the end of the run: writing at
     * the end would cache nothing in exactly the case the cache exists for.
     */
    write(source, { modelIdentity, candidates }) {
      const name = entryFileName(source.bytes);
      const finalPath = join(dir, name);
      const tmpPath = join(dir, `.${name}.${process.pid}.${sequence++}.tmp`);

      const entry = {
        protocol_version: PROTOCOL_VERSION,
        // Diagnostic only — the key is the bytes. A renamed source hits an entry recorded
        // under its old id, and the CURRENT id is what the bank is built from.
        source_id: source.id,
        // Provenance: which model actually produced these candidates. A resumed run that
        // mixes models must be able to say so rather than claiming a uniform origin.
        model_identity: modelIdentity,
        candidates,
      };

      try {
        writeFileSync(tmpPath, JSON.stringify(entry) + '\n', 'utf8');
        renameSync(tmpPath, finalPath);
      } catch (err) {
        // A cache the operator asked for and that cannot be written to is a real
        // misconfiguration (missing directory, full disk, read-only mount). Fail loud
        // naming it rather than degrading to "no resumability" — silently losing the very
        // durability this module exists to provide is exactly the bug we are fixing.
        throw new Error(
          `quote-miner cache: cannot write entry for source '${source.id}' into '${dir}': ${err.message}`,
          { cause: err }
        );
      }
      writes++;
    },

    stats() {
      return { hits, ignored, writes };
    },
  };
}

/**
 * Is this parsed entry safe to use?
 *
 * Checks the protocol version (a bumped version means the candidates mean something else
 * now), the recorded identity (provenance must be present or the report would have to
 * invent one), and the candidate shape the miner's normalizer accepts. A misshapen entry is
 * rejected HERE rather than being allowed to throw deep inside normalization, where it would
 * look like a model protocol violation and fail the whole run.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isUsableEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (entry.protocol_version !== PROTOCOL_VERSION) return false;
  if (typeof entry.model_identity !== 'string' || entry.model_identity.length === 0) return false;
  if (!Array.isArray(entry.candidates)) return false;
  return entry.candidates.every(
    (candidate) =>
      typeof candidate === 'string' ||
      (candidate !== null && typeof candidate === 'object' && typeof candidate.text === 'string')
  );
}

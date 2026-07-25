// THE BATCH MODEL SEAM: mining a corpus through `model.selectBatch`, one model call per
// CHUNK of sources, so an adapter can fan the chunk out to one subagent per source instead
// of paying a full CLI setup per source (src/claude-agent.mjs).
//
// Extracted from src/miner.mjs to keep both files readable; the logic is unchanged apart
// from the cache filtering documented on mineInBatches(). It grounds through the SAME
// src/grounding.mjs the per-source path uses, which is what keeps the two seams from
// drifting apart on fidelity.

import { mapWithConcurrency } from './pool.mjs';
import { groundSource, decodeUtf8OrThrow, resolveModelIdentity } from './grounding.mjs';

/** Sources per batch model call when neither the option nor the env var says otherwise. */
export const DEFAULT_CHUNK_SIZE = 10;

/**
 * Mine every source through the BATCH seam: partition the corpus into chunks, ask the
 * model about one chunk per call, and ground each answer against the bytes WE loaded.
 *
 * Chunks are dispatched through the same bounded pool the per-source path uses, so the
 * concurrency bound now counts in-flight CHUNKS (each of which fans out internally). The
 * pool returns chunk results in original chunk order, and each chunk's results are in
 * source order within it, so flattening yields exactly the original source order — the
 * same determinism guarantee, one level up.
 *
 * CACHE COMPOSITION: cached sources are filtered OUT of a chunk before it is dispatched, so
 * a resumed run pays only for the misses, and a chunk whose sources are all cached spawns
 * NOTHING at all. Entries are written per source as the chunk's answer is unpacked — the
 * finest granularity this seam offers, since the model answers a whole chunk at once.
 *
 * @param {{
 *   sources: Array<{ id: string, path?: string, bytes: Buffer }>,
 *   model: { id: string, selectBatch: Function },
 *   limit: number,
 *   batchSize: number,
 *   cache: { read: Function, write: Function } | null,
 *   emitProgress: (index: number, result: object) => void
 * }} args
 * @returns {Promise<Array<{ quotes: object[], counts: object, fromCache: boolean }>>}
 */
export async function mineInBatches({ sources, model, limit, batchSize, cache, emitProgress }) {
  // A source with no path cannot be handed to a batch adapter (which gives paths to
  // subagents rather than shipping text). Fail BEFORE any model call, naming it: quietly
  // dropping it, or quietly falling back to the per-source seam, would silently change
  // what the corpus contains.
  const pathless = sources.filter((s) => typeof s.path !== 'string' || s.path.length === 0);
  if (pathless.length > 0) {
    throw new Error(
      `miner: the model exposes selectBatch, which mines sources by path, but ` +
        `${pathless.length} source(s) have no 'path': ${pathless.map((s) => s.id).join(', ')}`
    );
  }

  const chunks = [];
  for (let start = 0; start < sources.length; start += batchSize) {
    chunks.push({ offset: start, items: sources.slice(start, start + batchSize) });
  }

  const minedChunks = await mapWithConcurrency(chunks, limit, async ({ offset, items }) => {
    // Decode with FATAL first, exactly as the per-source path does: a non-UTF-8 source
    // fails the run (FR-015b/016) rather than being sent to a model.
    for (const source of items) {
      decodeUtf8OrThrow(source.id, source.bytes);
    }

    // Resolve the chunk against the cache FIRST: only the misses are worth a model call.
    const cached = new Map();
    const misses = [];
    for (const source of items) {
      const entry = cache === null ? null : cache.read(source);
      if (entry === null) misses.push(source);
      else cached.set(source.id, entry);
    }

    // Impure step: ONE model call for the chunk's MISSES. Only ids and paths cross this
    // boundary — never bytes. A fully cached chunk spawns nothing.
    let answered = new Map();
    if (misses.length > 0) {
      answered = await model.selectBatch(misses.map(({ id, path }) => ({ id, path })));
      if (!(answered instanceof Map)) {
        throw new Error(
          `miner: model '${model.id}' selectBatch must resolve to a Map of source id -> candidates; ` +
            `got ${Object.prototype.toString.call(answered)}`
        );
      }
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const source = items[i];
      const entry = cached.get(source.id);
      const result =
        entry !== undefined
          ? replayCached(source, entry)
          : groundAnswer({ source, model, answered, cache });
      emitProgress(offset + i, result);
      results.push(result);
    }
    return results;
  });

  return minedChunks.flat();
}

/**
 * Ground a chunk answer for one source and persist the model's candidates.
 *
 * @param {{ source: object, model: object, answered: Map, cache: object | null }} args
 * @returns {{ quotes: object[], counts: object, fromCache: boolean, modelIdentity: null }}
 */
function groundAnswer({ source, model, answered, cache }) {
  if (!answered.has(source.id)) {
    // NOT "nothing quotable": an unanswered source is an unanswered question. Recording
    // it as an empty result would be a false-clean (TASK-15).
    throw new Error(
      `miner: model '${model.id}' returned no answer for requested source '${source.id}'; ` +
        'a missing answer is not the same as a source with nothing quotable'
    );
  }

  const candidates = answered.get(source.id);
  const result = groundSource(
    source,
    candidates,
    `miner: model '${model.id}' on source '${source.id}'`
  );
  result.fromCache = false;
  result.modelIdentity = null;

  // Persist only AFTER grounding normalized the candidates: a shape the normalizer rejects
  // is a model protocol violation, and caching it would make that failure stick to the
  // corpus forever.
  if (cache !== null) {
    cache.write(source, { modelIdentity: resolveModelIdentity(model), candidates });
  }

  return result;
}

/**
 * Ground candidates replayed from the cache.
 *
 * Cached candidates take the SAME grounding path as fresh ones — that is why a stale or
 * tampered entry can only cost quotes, never smuggle one in.
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {{ candidates: unknown[], modelIdentity: string }} entry
 * @returns {{ quotes: object[], counts: object, fromCache: true, modelIdentity: string }}
 */
export function replayCached(source, entry) {
  const result = groundSource(
    source,
    entry.candidates,
    `miner: cached model '${entry.modelIdentity}' on source '${source.id}'`
  );
  result.fromCache = true;
  result.modelIdentity = entry.modelIdentity;
  return result;
}

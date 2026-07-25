// GROUNDING — the fidelity step, plus the two small primitives that surround it.
//
// Extracted from src/miner.mjs so the per-source seam (src/miner.mjs), the batch seam
// (src/miner-batch.mjs), and any future seam all call THE SAME grounding function. Fidelity
// is the one thing in this package that must never have two implementations, so it lives
// alone in a module both callers import rather than in whichever file happened to need it
// first. The logic here is unchanged from where it used to live.

import { normalizeCandidates, buildQuote } from './corrections.mjs';

/**
 * GROUND a source's candidates: the one place a passage becomes a quote, shared by BOTH
 * model seams so they cannot drift apart.
 *
 * THE FIDELITY INVARIANT LIVES HERE. Grounding is `bytes.indexOf` against the bytes the
 * CALLER loaded for this source — never against whatever the model, a subagent that read the
 * file itself, or a persisted cache entry claims the file says. A candidate that is not an
 * exact byte substring of those bytes is OMITTED (FR-014). That is why neither fanning
 * selection out to subagents nor replaying candidates from disk changes anything about
 * fidelity: a subagent that misreads, paraphrases, or hallucinates — and a stale or tampered
 * cache entry — produce candidates that simply fail to ground, exactly as a hallucinating
 * single model's did.
 *
 * @param {{ id: string, bytes: Buffer }} source
 * @param {unknown[]} rawCandidates  whatever the model returned, unnormalized
 * @param {string} context  names the producer, for error messages
 * @returns {{ quotes: object[], counts: object }}
 */
export function groundSource({ id, bytes }, rawCandidates, context) {
  const candidates = normalizeCandidates(rawCandidates, context);

  const quotes = [];
  let grounded = 0;
  let omitted = 0;
  let proposed = 0;
  let applied = 0;
  let dropped = 0;

  for (const candidate of candidates) {
    // Ground by copying EXACT bytes: is the candidate an exact byte substring of
    // THIS source? (UTF-8 bytes, no normalization.)
    const candBuf = Buffer.from(candidate.text, 'utf8');
    if (bytes.indexOf(candBuf) >= 0) {
      // The grounded source bytes are the span's `raw` — always, uncorrected. Any
      // proposed correction is verified against those bytes, disclosed as an
      // `ocr-fix`, and `text` is derived mechanically (src/corrections.mjs).
      // Corrections are only counted for GROUNDED candidates: an omitted candidate
      // has no `raw` to verify a correction against.
      //
      // The `<n>` in the id counts grounded quotes WITHIN this source, so ids stay
      // stable no matter how many sources run at once.
      const built = buildQuote({
        id: `q-${id}-${grounded}`,
        source: id,
        raw: candidate.text,
        corrections: candidate.corrections
      });
      quotes.push(built.quote);
      proposed += built.proposed;
      applied += built.applied;
      dropped += built.dropped;
      grounded++;
    } else {
      // Ungrounded: OMIT it (never emit an unverified passage — FR-014).
      omitted++;
    }
  }

  return {
    quotes,
    counts: {
      id,
      selected: candidates.length,
      grounded,
      omitted,
      corrections_proposed: proposed,
      corrections_applied: applied,
      corrections_dropped: dropped
    }
  };
}

/**
 * Decode source bytes to UTF-8 text with FATAL decoding, throwing a named error if the
 * bytes are not valid UTF-8.
 *
 * Both seams run this BEFORE anything else touches a source — including before a cache
 * lookup — so a non-UTF-8 source fails the run whether or not someone once mined it.
 *
 * @param {string} id
 * @param {Buffer} bytes
 * @returns {string}
 */
export function decodeUtf8OrThrow(id, bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`source '${id}' is not valid UTF-8`);
  }
}

/**
 * The model's own account of which model it is.
 *
 * `resolvedId()` is the late-read seam both adapters expose (src/claude.mjs,
 * src/claude-agent.mjs) — it only reports the REAL model after a response envelope has been
 * seen (AUDIT-21/FR-020). A bare `id` is accepted for the simple model objects tests and
 * other callers construct.
 *
 * @param {{ id: string, resolvedId?: () => string }} model
 * @returns {string}
 */
export function resolveModelIdentity(model) {
  return typeof model.resolvedId === 'function' ? model.resolvedId() : model.id;
}

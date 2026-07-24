// Impure quote miner (US2 core). Selects quotable passages via an injected model
// (the impure "model points" step), then GROUNDS each selection deterministically by
// copying the exact UTF-8 bytes out of the source (FR-014: never emit an ungrounded
// passage). No production-control import; operates purely on values passed to it.
//
// The model call is impure (selection varies by model/run), but grounding + assembly
// are deterministic given the model's output. The miner NEVER returns a partial bank:
// a bad source id (FR-018), invalid UTF-8, or a model rejection (FR-015b/016) all throw
// before or instead of returning. It reports no validation verdict — acceptance is the
// independent validator's job (FR-013).

import { stringify } from 'yaml';
import { buildSourceMap } from './validator.mjs';

/**
 * Mine grounded quotes from a corpus of sources using an injected model.
 *
 * @param {{
 *   sources: Array<{ id: string, bytes: Buffer }>,
 *   model: { id: string, select: (sourceId: string, sourceText: string) => Promise<string[]> }
 * }} args
 * @returns {Promise<{ bank: object, report: object }>}
 */
export async function mine({ sources, model }) {
  // FR-018: enforce the source-id mapping BEFORE processing any quote. A duplicate,
  // case-collision, or invalid (path/control-char) id fails the whole run loud.
  const { errors } = buildSourceMap(sources);
  if (errors.length > 0) {
    throw new Error(`source-id mapping is ambiguous (FR-018): ${errors.join('; ')}`);
  }

  const quotes = [];
  const perSource = [];
  let totalSelected = 0;
  let totalGrounded = 0;
  let totalOmitted = 0;

  for (const { id, bytes } of sources) {
    // Decode with FATAL so invalid UTF-8 throws. A non-UTF-8 source fails the run
    // (FR-015b/016) — no partial bank, no catch-and-continue.
    const text = decodeUtf8OrThrow(id, bytes);

    // Impure step: the model points at candidate passages. A model rejection
    // propagates and fails the run.
    const candidates = await model.select(id, text);

    let grounded = 0;
    let omitted = 0;

    for (const candidate of candidates) {
      // Ground by copying EXACT bytes: is the candidate an exact byte substring of
      // THIS source? (UTF-8 bytes, no normalization.)
      const candBuf = Buffer.from(candidate, 'utf8');
      if (bytes.indexOf(candBuf) >= 0) {
        // v1 copies exact bytes, so text === raw and edits is empty.
        quotes.push({
          id: `q-${id}-${grounded}`,
          source: id,
          spans: [{ raw: candidate }],
          text: candidate,
          edits: []
        });
        grounded++;
      } else {
        // Ungrounded: OMIT it (never emit an unverified passage — FR-014).
        omitted++;
      }
    }

    const selected = candidates.length;
    totalSelected += selected;
    totalGrounded += grounded;
    totalOmitted += omitted;
    perSource.push({ id, selected, grounded, omitted });
  }

  const bank = { version: 1, quotes };

  const report = {
    selected: totalSelected,
    grounded: totalGrounded,
    omitted_ungrounded: totalOmitted,
    sources_processed: sources.length,
    // On any source failure the run THREW above, so a returned report always has 0
    // skipped and 0 failed.
    sources_skipped: 0,
    sources_failed: 0,
    per_source: perSource
  };

  return { bank, report };
}

/**
 * Serialize a bank object to a YAML string for the bin (T014) to write to disk.
 *
 * @param {object} bank
 * @returns {string}
 */
export function serializeBank(bank) {
  return stringify(bank);
}

/**
 * Decode source bytes to UTF-8 text with FATAL decoding, throwing a named error if the
 * bytes are not valid UTF-8.
 *
 * @param {string} id
 * @param {Buffer} bytes
 * @returns {string}
 */
function decodeUtf8OrThrow(id, bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`source '${id}' is not valid UTF-8`);
  }
}

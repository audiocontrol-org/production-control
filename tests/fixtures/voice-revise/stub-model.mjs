#!/usr/bin/env node

// Test-only deterministic stub model for the `voice-revise` integration test
// (tests/integration/voice-revise.test.ts, TASK-29). Stands in for a real
// language model behind the `VOICE_REVISE_MODEL` env seam
// (voice-tooling/src/revise/model.ts) -- MOCK CODE LIVES HERE, IN TEST FIXTURES,
// NEVER IN THE SHIPPED PACKAGE.
//
// The NEW protocol (TASK-29): the model reads the PROMPT on stdin (no longer
// JSON) and emits a `ModelReviseOutput` JSON object -- the revised edition BODY
// plus an INDEX-BASED coverage mapping. It does NOT emit the hash-keyed ledger:
// the PROVIDER (voice-tooling/src/revise/ledger-build.ts) derives units and
// builds the ledger from the declared indices.
//
// This stub is the SIMPLEST correct producer: it recovers each source unit's
// exact bytes from the numbered-units section of the prompt (the exact bytes
// between the `[SOURCE UNIT n]` ... `[/SOURCE UNIT n]` markers
// voice-tooling/src/revise/model.ts writes), emits `edition` = those units
// reproduced verbatim (blank-line separated, D6 canonical form), and one
// `verbatim` coverage entry per source unit mapping i -> [i]. `verbatim` is
// chosen deliberately: a destination whose bytes are identical to its source
// unit always satisfies `checkVerbatim` regardless of the unit's content (a
// quote, a citation, plain prose), so this stub is SUBJECT-AGNOSTIC and
// correct-by-construction for ANY plain-prose source, and never has to reason
// about payload survival at all.

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Recover each source unit's EXACT bytes from the prompt's numbered-units
 * section, in order, using the same per-unit markers model.ts wrote. The
 * non-greedy capture reproduces the unit content (its own terminators included)
 * byte-for-byte.
 */
function extractSourceUnits(prompt) {
  const pattern = /\[SOURCE UNIT (\d+)\]\n([\s\S]*?)\[\/SOURCE UNIT \1\]/g;
  const units = [];
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    units.push(match[2]);
  }
  return units;
}

async function main() {
  const prompt = await readStdinText();
  const units = extractSourceUnits(prompt);
  if (units.length === 0) {
    throw new Error('stub-model: prompt carried no [SOURCE UNIT n] markers -- nothing to revise');
  }

  // Reproduce the units verbatim, blank-line separated: each interior unit
  // already ends with its own terminator, so joining with a single "\n" yields
  // a blank separator line between units (D6 canonical form). deriveUnits over
  // this body recovers exactly these units, so each verbatim destination's
  // bytes equal its source unit's bytes.
  const edition = units.join('\n');
  const coverage = units.map((_unit, index) => ({ op: 'verbatim', edition_units: [index] }));

  process.stdout.write(JSON.stringify({ edition, coverage }));
}

main().catch((cause) => {
  process.stderr.write(`stub-model: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});

#!/usr/bin/env node

// Test-only deterministic stub model for the `voice-revise` integration test
// (tests/integration/voice-revise.test.ts, T018/T019). Stands in for a real
// language model behind the `VOICE_REVISE_MODEL` env seam
// (voice-tooling/src/revise/model.ts) -- MOCK CODE LIVES HERE, IN TEST FIXTURES,
// NEVER IN THE SHIPPED PACKAGE.
//
// Reads the same JSON `voice-tooling/src/revise/model.ts`'s `invokeModel`
// writes on stdin (`{ version, target, source: { identity, hash, text },
// voice: { identity, hash, doc } }`) and emits a FIXED, FAITHFUL edition: the
// source body reproduced byte-for-byte (a `verbatim` disposition for every
// derived source unit), plus a frontmatter `ledger:` block accounting for
// every one of them. `verbatim` is chosen deliberately -- not because a real
// revision would never reword anything, but because it makes this stub
// SUBJECT-AGNOSTIC and correct-by-construction for ANY plain-prose source: a
// destination whose bytes are identical to its source unit always satisfies
// `checkVerbatim` (voice-tooling/src/fidelity/check-op-obligations.ts)
// regardless of what that source unit's content actually is (a quote, a
// citation, a plain sentence), so this stub never has to reason about
// payload survival at all.
//
// Reuses voice-tooling's OWN `deriveUnits` (imported live via `tsx`, since
// voice-tooling ships no build step) rather than reimplementing the D6 unit
// algorithm here -- so the units this stub accounts for are computed by the
// EXACT SAME function the shipped `voice fidelity` validator uses, and can
// never silently drift from it.

import { register } from 'tsx/esm/api';

register();

const { deriveUnits } = await import('../../../voice-tooling/src/units/derive.ts');

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Minimal defensive YAML-safe double-quoting for a scalar value. */
function yamlString(value) {
  return JSON.stringify(String(value));
}

async function main() {
  const requestText = await readStdinText();
  const request = JSON.parse(requestText);

  const sourceText = request.source.text;
  const sourceIdentity = request.source.identity;
  const sourceHash = request.source.hash;
  const voiceIdentity = request.voice.identity;
  const voiceHash = request.voice.hash;

  const units = deriveUnits(sourceText, sourceIdentity);
  if (units.length === 0) {
    throw new Error('stub-model: source derived zero units -- nothing to account for');
  }

  const coverageLines = units
    .map((unit) => {
      const ref = `{ hash: "sha256:${unit.contentHash}", occurrence: ${unit.occurrenceIndex} }`;
      return [
        `    - source_unit: ${ref}`,
        '      op: verbatim',
        `      edition_units: [ ${ref} ]`,
      ].join('\n');
    })
    .join('\n');

  const frontmatter = [
    '---',
    'ledger:',
    '  version: 1',
    `  source: { identity: ${yamlString(sourceIdentity)}, hash: ${yamlString(sourceHash)} }`,
    `  voice: { identity: ${yamlString(voiceIdentity)}, hash: ${yamlString(voiceHash)} }`,
    '  coverage:',
    coverageLines,
    '---',
    '',
  ].join('\n');

  // The edition body is the source reproduced VERBATIM -- D7's "frontmatter
  // is written last, after unit derivation" holds trivially here since the
  // frontmatter is prepended to bytes that are themselves untouched.
  process.stdout.write(frontmatter + sourceText);
}

main().catch((cause) => {
  process.stderr.write(`stub-model: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});

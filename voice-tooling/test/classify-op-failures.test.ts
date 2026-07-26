// AUDIT-20260726-23 (FIX 3): failure classification must switch on the
// STRUCTURED failure kind, never regex-match the human-facing message.
//
// The pre-fix classifier regex-matched the failure PROSE, but a payload
// shortfall message interpolates the payload ITEM (a quoted span, a citation,
// a lexicon term). A quoted span whose text happens to contain the word
// "numeric" therefore flipped the WRONG named check (numeric_literals) in
// addition to the right one (verbatim_quotes). This test drives a real
// `checkOpObligations` run so it proves both halves: (a) a dropped quote is
// tagged kind 'quote' regardless of its text, and (b) `classifyOpFailures`
// buckets it under verbatim_quotes ONLY.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import { classifyOpFailures } from '@/fidelity/classify-op-failures.ts';
import type { CoverageEntry, CoverageLedger, UnitRef } from '@/schema/ledger.ts';

const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;

function ref(unit: SourceUnit): UnitRef {
  return { hash: `sha256:${unit.contentHash}`, occurrence: unit.occurrenceIndex };
}

function ledgerOf(coverage: CoverageEntry[]): CoverageLedger {
  return {
    version: 1,
    source: { identity: 'test-source', hash: PLACEHOLDER_HASH },
    voice: { identity: 'test-voice', hash: PLACEHOLDER_HASH },
    coverage,
  };
}

test('AUDIT-20260726-23 (FIX 3): a dropped quoted span whose text contains "numeric" flips ONLY verbatim_quotes', () => {
  // A blockquote (quote payload) whose remainder literally contains the word
  // "numeric". The edition drops the quoted line entirely, so the quote does
  // not survive -- the only obligation failure.
  const src = deriveUnits('> A quoted remark about a numeric detail.\n', 'src');
  const ed = deriveUnits('Rewritten prose that omits the quoted line.\n', 'ed');
  const s0 = src[0];
  const e0 = ed[0];
  assert.ok(s0 && e0);

  const result = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [ref(e0)] }]),
    src,
    ed,
  );

  assert.equal(result.ok, false);

  // (a) The failure is tagged kind 'quote' even though its message text
  // contains the word "numeric".
  const quoteFailure = result.failures.find((f) => f.kind === 'quote');
  assert.ok(quoteFailure, 'the dropped quote must be a kind:"quote" failure');
  assert.match(quoteFailure.message, /numeric/, 'the message text does contain the word "numeric"');
  assert.equal(result.failures.some((f) => f.kind === 'numeric'), false, 'no numeric-kind failure exists');

  // (b) Classification keys off the kind, so ONLY verbatim_quotes flips.
  const affected = classifyOpFailures(result.failures);
  assert.equal(affected.has('verbatim_quotes'), true, 'verbatim_quotes must flip');
  assert.equal(
    affected.has('numeric_literals'),
    false,
    'the word "numeric" in the quoted span must NOT flip numeric_literals',
  );
});

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
import {
  classifyOpFailures,
  findUnresolvedDestinationChecks,
  type NamedCheck,
} from '@/fidelity/classify-op-failures.ts';
import { indexSourceUnits } from '@/fidelity/run-support.ts';
import {
  computeVerdict,
  passed,
  failed,
  notRun,
  reported,
  notCheckable,
  type CheckResult,
} from '@/fidelity/report.ts';

/**
 * Mirror the orchestrator's verdict-from-check-map mapping (AUDIT-20260728-28):
 * every named check a set of op-failures flips becomes `failed`; the
 * `op_obligations` catch-all is added ONLY when present. The verdict then derives
 * from the check map ALONE -- there is no `failures.length` coupling.
 */
function applyOpFailureChecks(
  checks: Record<string, CheckResult>,
  affected: ReadonlySet<NamedCheck>,
): void {
  for (const name of affected) {
    checks[name] = failed(`${name}: op obligation not satisfied; see failures[]`);
  }
}
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

/**
 * A complete required-check set, every entry in a NON-blocking passing state, so
 * `computeVerdict` would return 'passed' unless something withholds it. Mirrors
 * report-types.test.ts's `fullChecks`.
 */
function fullPassingChecks(): Record<string, CheckResult> {
  return {
    source_hash: passed(),
    ledger_structure: passed(),
    unit_accounting: passed({ total: 3 }),
    verbatim_quotes: passed({ checked: 0 }),
    citations: passed({ checked: 0 }),
    numeric_literals: passed({ checked: 0 }),
    lexicon: notRun('no lexicon declared'),
    uncorroborated_units: reported({ count: 0 }),
    semantic_claim_fidelity: notCheckable('not provable under D4 — declared out of scope for v1'),
    voice_conformance: notCheckable('not provable under D16 — declared out of scope for v1'),
  };
}

test('AUDIT-20260727-18/-29, AUDIT-20260728-28: a `structural` op-failure maps to the op_obligations catch-all and withholds the verdict via the check map -- never passed-with-failures', () => {
  // Drive a REAL checkOpObligations run to a `structural` failure: a non-cut
  // entry with ZERO declared destinations (the AUDIT-20260726-19 empty-
  // destination guard). This kind maps to no PAYLOAD check -- pre-fix it flipped
  // nothing and let a run compute `passed` alongside a non-empty failures[]. The
  // new total classifier routes it to the `op_obligations` catch-all instead.
  const src = deriveUnits('Some prose that would be silently dropped.\n', 'src');
  const ed = deriveUnits('Unrelated edition content.\n', 'ed');
  const [s0] = src;
  assert.ok(s0);

  const opResult = checkOpObligations(
    ledgerOf([{ source_unit: ref(s0), op: 'represented', edition_units: [] }]),
    src,
    ed,
  );
  assert.equal(opResult.ok, false);
  assert.deepEqual(opResult.failures.map((f) => f.kind), ['structural']);

  // The structural failure now flips the `op_obligations` catch-all named check
  // (not a payload check) -- so it is visible to computeVerdict via the map.
  const affected = classifyOpFailures(opResult.failures);
  assert.deepEqual([...affected], ['op_obligations'], 'a structural failure maps to the op_obligations catch-all');

  // The orchestrator invariant: with every payload check passing but a structural
  // op-failure present, applying the check map marks op_obligations `failed`, and
  // the verdict -- derived from the check map ALONE -- is WITHHELD.
  const checks = fullPassingChecks();
  assert.equal(computeVerdict({ checks }), 'passed', 'precondition: the named-check map alone would pass');
  applyOpFailureChecks(checks, affected);
  assert.equal(
    computeVerdict({ checks }),
    undefined,
    'a failure that flipped the op_obligations catch-all must withhold the verdict',
  );
  assert.equal(checks['op_obligations']?.state, 'failed', 'the structural failure is surfaced as a decided op_obligations failure');
});

test('AUDIT-20260728-28: an all-checks-pass run yields `passed` from the check map alone -- nothing is coupled to failures.length', () => {
  // No op-failures at all: the classifier flips nothing, no op_obligations check
  // is added, and the verdict passes purely from the named-check map. There is no
  // `failures.length` side-channel that could withhold a legitimate pass.
  const affected = classifyOpFailures([]);
  assert.equal(affected.size, 0, 'no failures flip no checks');
  const checks = fullPassingChecks();
  applyOpFailureChecks(checks, affected);
  assert.equal('op_obligations' in checks, false, 'no op_obligations check is injected when there are no failures');
  assert.equal(computeVerdict({ checks }), 'passed', 'an all-pass check map yields passed');
});

test('AUDIT-20260728-28: a single `failed` named check blocks the verdict via the check map', () => {
  // The verdict derives from the check map ALONE: any one `failed` check blocks
  // it, with no advisory or failures.length coupling required.
  const checks = fullPassingChecks();
  checks['citations'] = failed('a citation obligation was not satisfied');
  assert.equal(computeVerdict({ checks }), undefined, 'a failed named check blocks the verdict');
});

test('AUDIT-20260727-28: a partially-unresolved entry whose payload SURVIVES in the resolved destination names the unresolved reference, NOT a fabricated non-survival', () => {
  // represented entry with TWO declared destinations: D1 resolves and carries
  // BOTH the source citation [^a] and the numeric 1978; D2 is a dangling
  // reference. The payload demonstrably SURVIVES in D1, so the ONLY real fault
  // is the unresolved D2 reference. Pre-fix, ANY dangling reference caused EVERY
  // payload item to be reported as "does not survive" -- fabricating a survival
  // failure. Post-fix, survival is evaluated against the RESOLVED union only.
  const src = deriveUnits('Beta cites [^a] and counts 1978.\n', 'src');
  const ed = deriveUnits('Rewritten beta citing [^a] with 1978.\n', 'ed');
  const [s0] = src;
  const [d1] = ed;
  assert.ok(s0 && d1);

  const dangling: UnitRef = { hash: `sha256:${'e'.repeat(64)}`, occurrence: 0 };
  const ledger = ledgerOf([
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(d1), dangling] },
  ]);

  const failures: string[] = [];
  const affected = findUnresolvedDestinationChecks(
    ledger,
    indexSourceUnits(src),
    indexSourceUnits(ed),
    undefined,
    failures,
  );

  assert.equal(
    failures.some((f) => /does not survive/.test(f)),
    false,
    `no payload item may be reported as "does not survive" when it survives in the resolved destination; got: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((f) => /does not resolve to an edition unit/.test(f)),
    `the reported fault must name the unresolved reference; got: ${failures.join(' | ')}`,
  );
  // Something still flips so the verdict is withheld (belt-and-suspenders with FIX 2).
  assert.ok(affected.size > 0, 'the entry still flips a named check for the unresolved reference');
});

test('AUDIT-20260728-24: a represented entry with a SINGLE unresolved destination and an ordinary-prose (no-payload) source FAILS, naming the unresolved reference -- never a "survives" blessing', () => {
  // The entry's ONLY declared destination is dangling, and the source is ordinary
  // connective prose with NO extractable payload -- exactly the case pre-fix
  // "blessed" with "the payload survives across the resolved destinations; the
  // unresolved reference is the fault" (there ARE no resolved destinations, so
  // that message is vacuous nonsense that passes off an absent paragraph as fine).
  // Post-fix: the unresolved reference is ALWAYS a fault -- it flips the
  // op_obligations catch-all so the verdict is withheld -- and the message names
  // the unresolved reference honestly, with no "survives" language.
  const src = deriveUnits('Plain connective prose with no literals at all.\n', 'src');
  const ed = deriveUnits('An unrelated edition paragraph.\n', 'ed');
  const [s0] = src;
  assert.ok(s0);

  const dangling: UnitRef = { hash: `sha256:${'e'.repeat(64)}`, occurrence: 0 };
  const ledger = ledgerOf([
    { source_unit: ref(s0), op: 'represented', edition_units: [dangling] },
  ]);

  const failures: string[] = [];
  const affected = findUnresolvedDestinationChecks(
    ledger,
    indexSourceUnits(src),
    indexSourceUnits(ed),
    undefined,
    failures,
  );

  assert.equal(
    failures.some((f) => /survives/.test(f)),
    false,
    `no "survives" blessing may be emitted for a totally-absent destination; got: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((f) => /does not resolve to an edition unit/.test(f)),
    `the reported fault must name the unresolved reference; got: ${failures.join(' | ')}`,
  );
  assert.ok(
    affected.has('op_obligations'),
    'the unresolved reference flips the op_obligations catch-all so the verdict is withheld',
  );
});

test('AUDIT-20260727-28: a partially-unresolved entry whose payload does NOT survive in the resolved destination still reports the genuine shortfall', () => {
  // Same two-destination shape, but D1 resolves WITHOUT the source's citation
  // [^a] (it survives nowhere resolved), while the numeric 1978 does survive in
  // D1. The fix must still report the genuine [^a] shortfall AND must not
  // fabricate a 1978 shortfall.
  const src = deriveUnits('Beta cites [^a] and counts 1978.\n', 'src');
  const ed = deriveUnits('Rewritten beta with only 1978, no marker.\n', 'ed');
  const [s0] = src;
  const [d1] = ed;
  assert.ok(s0 && d1);

  const dangling: UnitRef = { hash: `sha256:${'e'.repeat(64)}`, occurrence: 0 };
  const ledger = ledgerOf([
    { source_unit: ref(s0), op: 'represented', edition_units: [ref(d1), dangling] },
  ]);

  const failures: string[] = [];
  const affected = findUnresolvedDestinationChecks(
    ledger,
    indexSourceUnits(src),
    indexSourceUnits(ed),
    undefined,
    failures,
  );

  assert.ok(
    failures.some((f) => /citation \[\^a\] does not survive/.test(f)),
    `the genuinely-missing citation must still be reported; got: ${failures.join(' | ')}`,
  );
  assert.equal(
    failures.some((f) => /numeric 1978 does not survive/.test(f)),
    false,
    `the numeric survives in the resolved destination and must NOT be reported missing; got: ${failures.join(' | ')}`,
  );
  assert.equal(affected.has('citations'), true, 'the citations check flips for the genuine shortfall');
});

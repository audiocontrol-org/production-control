// TASK-29: unit coverage for the real producer protocol -- `parseModelOutput`
// (the model's index-based wire shape, `@/revise/protocol.ts`) and `buildEdition`
// (the provider that turns declared indices into a hash-keyed ledger,
// `@/revise/ledger-build.ts`). The end-to-end spawn+gate path is the repo-root
// integration test's job (tests/integration/voice-revise.test.ts).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseModelOutput } from '@/revise/protocol.ts';
import { buildEdition } from '@/revise/ledger-build.ts';
import { deriveUnits } from '@/units/derive.ts';
import { loadLedger } from '@/schema/ledger.ts';
import { extractLedgerYaml } from '@/fidelity/check-ledger-structure.ts';
import { checkUnitAccounting } from '@/fidelity/check-unit-accounting.ts';
import { checkOpObligations } from '@/fidelity/check-op-obligations.ts';
import { checkSourceHash } from '@/fidelity/check-source-hash.ts';

function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

// ---- parseModelOutput -----------------------------------------------------

test('parseModelOutput: accepts a valid raw JSON object', () => {
  const stdout = JSON.stringify({
    edition: 'Revised body.\n',
    coverage: [{ op: 'verbatim', edition_units: [0] }],
  });
  const out = parseModelOutput(stdout);
  assert.equal(out.edition, 'Revised body.\n');
  assert.equal(out.coverage.length, 1);
  assert.deepEqual(out.coverage[0], { op: 'verbatim', edition_units: [0] });
});

test('parseModelOutput: accepts a ```json fenced block amid surrounding prose', () => {
  const stdout = [
    'Here is my revision:',
    '```json',
    JSON.stringify({ edition: 'Body.\n', coverage: [{ op: 'cut', reason: 'redundant' }] }),
    '```',
    'Let me know if you want changes.',
  ].join('\n');
  const out = parseModelOutput(stdout);
  assert.equal(out.edition, 'Body.\n');
  assert.deepEqual(out.coverage[0], { op: 'cut', reason: 'redundant' });
});

test('parseModelOutput: carries an optional treatment note through', () => {
  const stdout = JSON.stringify({
    edition: 'B\n',
    coverage: [{ op: 'represented', edition_units: [0], treatment: 'condensed' }],
  });
  const out = parseModelOutput(stdout);
  assert.deepEqual(out.coverage[0], { op: 'represented', edition_units: [0], treatment: 'condensed' });
});

test('parseModelOutput: rejects output with no JSON object at all', () => {
  assert.throws(() => parseModelOutput('just prose, no json here'), /contains no JSON object/);
});

test('parseModelOutput: rejects a non-object root', () => {
  // A fenced JSON array parses cleanly but is not an object.
  assert.throws(() => parseModelOutput('```json\n[1, 2, 3]\n```'), /must be a JSON object/);
});

test('parseModelOutput: rejects a missing/non-string edition', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ coverage: [] })),
    /"edition" must be a string/,
  );
});

test('parseModelOutput: rejects coverage that is not an array', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: {} })),
    /"coverage" must be an array/,
  );
});

test('parseModelOutput: rejects an op outside the closed set', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [{ op: 'rewrite', edition_units: [0] }] })),
    /op must be one of verbatim, represented, merged, cut/,
  );
});

test('parseModelOutput: rejects a cut carrying edition_units', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [{ op: 'cut', reason: 'r', edition_units: [0] }] })),
    /op 'cut' must not carry edition_units/,
  );
});

test('parseModelOutput: rejects a cut missing/empty reason', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [{ op: 'cut', reason: '  ' }] })),
    /op 'cut' requires a non-empty reason/,
  );
});

test('parseModelOutput: rejects a non-cut missing/empty edition_units', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [{ op: 'verbatim', edition_units: [] }] })),
    /requires a non-empty edition_units array/,
  );
});

test('parseModelOutput: rejects a non-cut carrying a reason', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [{ op: 'verbatim', edition_units: [0], reason: 'r' }] })),
    /must not carry a reason/,
  );
});

// ---- parseModelOutput: grounding (T010, compose only) ---------------------

test('parseModelOutput: a revise-shaped output with no "grounding" key leaves grounding undefined', () => {
  const out = parseModelOutput(
    JSON.stringify({ edition: 'x', coverage: [{ op: 'verbatim', edition_units: [0] }] }),
  );
  assert.equal(out.grounding, undefined);
});

test('parseModelOutput: accepts a valid grounding array (grounded + connective + framing)', () => {
  const stdout = JSON.stringify({
    edition: 'Unit A.\n\nUnit B.\n\nUnit C.\n',
    coverage: [{ op: 'represented', edition_units: [0, 1, 2] }],
    grounding: [
      { edition_unit: 0, basis: 'grounded', beats: [0] },
      { edition_unit: 1, basis: 'connective' },
      { edition_unit: 2, basis: 'framing' },
    ],
  });
  const out = parseModelOutput(stdout);
  assert.deepEqual(out.grounding, [
    { edition_unit: 0, basis: 'grounded', beats: [0] },
    { edition_unit: 1, basis: 'connective' },
    { edition_unit: 2, basis: 'framing' },
  ]);
});

test('parseModelOutput: rejects grounding that is not an array', () => {
  assert.throws(
    () =>
      parseModelOutput(JSON.stringify({ edition: 'x', coverage: [], grounding: { not: 'array' } })),
    /"grounding" must be an array/,
  );
});

test('parseModelOutput: rejects a grounding entry that is not an object', () => {
  assert.throws(
    () => parseModelOutput(JSON.stringify({ edition: 'x', coverage: [], grounding: [42] })),
    /grounding\[0\] must be an object/,
  );
});

test('parseModelOutput: rejects a non-integer/negative edition_unit index', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: -1, basis: 'framing' }],
        }),
      ),
    /grounding\[0\]\.edition_unit must be a non-negative integer/,
  );
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 1.5, basis: 'framing' }],
        }),
      ),
    /grounding\[0\]\.edition_unit must be a non-negative integer/,
  );
});

test('parseModelOutput: rejects a basis outside the closed set', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'invented' }],
        }),
      ),
    /grounding\[0\]\.basis must be one of grounded, connective, framing/,
  );
});

test('parseModelOutput: rejects a "grounded" entry missing beats', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'grounded' }],
        }),
      ),
    /basis 'grounded' requires a non-empty beats array/,
  );
});

test('parseModelOutput: rejects a "grounded" entry with an empty beats array', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'grounded', beats: [] }],
        }),
      ),
    /basis 'grounded' requires a non-empty beats array/,
  );
});

test('parseModelOutput: rejects a "grounded" entry with a non-integer/negative beat index', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'grounded', beats: [-1] }],
        }),
      ),
    /grounding\[0\]\.beats\[0\] must be a non-negative integer/,
  );
});

test('parseModelOutput: rejects a non-"grounded" entry that carries beats', () => {
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'connective', beats: [0] }],
        }),
      ),
    /basis 'connective' must not carry beats/,
  );
  assert.throws(
    () =>
      parseModelOutput(
        JSON.stringify({
          edition: 'x',
          coverage: [],
          grounding: [{ edition_unit: 0, basis: 'framing', beats: [0] }],
        }),
      ),
    /basis 'framing' must not carry beats/,
  );
});

// ---- buildEdition ---------------------------------------------------------

const SOURCE_TEXT = 'First unit body.\n\nSecond unit body.\n';
const SOURCE_IDENTITY = 'draft';
const VOICE_IDENTITY = 'voice';
const SOURCE_HASH = sha256Of(SOURCE_TEXT);
const VOICE_HASH = sha256Of('voice-bytes');

test('buildEdition: builds a ledger whose refs resolve, round-tripping through the validator checks', () => {
  // A faithful verbatim revision: edition body == source body (canonical D6
  // form), one verbatim entry per source unit mapping i -> [i].
  const model = parseModelOutput(
    JSON.stringify({
      edition: SOURCE_TEXT,
      coverage: [
        { op: 'verbatim', edition_units: [0] },
        { op: 'verbatim', edition_units: [1] },
      ],
    }),
  );

  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    voiceIdentity: VOICE_IDENTITY,
    voiceHash: VOICE_HASH,
    sourceHash: SOURCE_HASH,
    model,
    mode: 'revise',
  });

  // The built edition is a frontmatter carrier the validator's extractLedgerYaml expects.
  assert.match(editionText, /^---\nledger:\n/);
  const ledger = loadLedger(extractLedgerYaml(editionText));
  assert.equal(ledger.version, 1);
  assert.equal(ledger.source.hash, SOURCE_HASH);
  assert.equal(ledger.voice.hash, VOICE_HASH);
  assert.equal(ledger.coverage.length, 2);

  // The ledger's declared source.hash matches the real source bytes.
  assert.equal(checkSourceHash(SOURCE_TEXT, ledger.source.hash).ok, true);

  // Every source unit is accounted for and every ref resolves; verbatim bytes match.
  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(editionText, 'edition');
  const accounting = checkUnitAccounting(sourceUnits, ledger);
  assert.deepEqual(accounting.failures, []);
  const obligations = checkOpObligations(ledger, sourceUnits, editionUnits);
  assert.deepEqual(obligations.failures, []);
  assert.equal(obligations.opCounts.verbatim, 2);
});

test('buildEdition: the ledger frontmatter does not perturb the body units (FR-011)', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: SOURCE_TEXT,
      coverage: [
        { op: 'verbatim', edition_units: [0] },
        { op: 'verbatim', edition_units: [1] },
      ],
    }),
  );
  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    voiceIdentity: VOICE_IDENTITY,
    voiceHash: VOICE_HASH,
    sourceHash: SOURCE_HASH,
    model,
    mode: 'revise',
  });

  // deriveUnits strips the leading frontmatter first, so the units of the FULL
  // built edition are byte-identical to the units of the body alone.
  const bodyUnits = deriveUnits(model.edition, 'body');
  const fullUnits = deriveUnits(editionText, 'edition');
  assert.deepEqual(
    fullUnits.map((u) => u.contentHash),
    bodyUnits.map((u) => u.contentHash),
  );
});

test('buildEdition: fails loud when coverage count does not match the source-unit count', () => {
  const model = parseModelOutput(
    JSON.stringify({ edition: SOURCE_TEXT, coverage: [{ op: 'verbatim', edition_units: [0] }] }),
  );
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model,
        mode: 'revise',
      }),
    /coverage must carry exactly one entry per source unit/,
  );
});

test('buildEdition: fails loud when an edition_units index is out of range', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: SOURCE_TEXT,
      coverage: [
        { op: 'verbatim', edition_units: [0] },
        { op: 'verbatim', edition_units: [5] },
      ],
    }),
  );
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model,
        mode: 'revise',
      }),
    /edition_units index 5 is out of range/,
  );
});

// ---- buildEdition: mode stamp + grounding resolution (T011) ---------------

const COMPOSE_MODEL = parseModelOutput(
  JSON.stringify({
    edition: 'Composed A.\n\nComposed B.\n',
    coverage: [
      { op: 'represented', edition_units: [0] },
      { op: 'represented', edition_units: [1] },
    ],
    grounding: [
      { edition_unit: 0, basis: 'grounded', beats: [0] },
      { edition_unit: 1, basis: 'grounded', beats: [1] },
    ],
  }),
);

test('buildEdition (T011): mode "revise" stamps mode: revise and omits grounding', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: SOURCE_TEXT,
      coverage: [
        { op: 'verbatim', edition_units: [0] },
        { op: 'verbatim', edition_units: [1] },
      ],
    }),
  );
  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    voiceIdentity: VOICE_IDENTITY,
    voiceHash: VOICE_HASH,
    sourceHash: SOURCE_HASH,
    model,
    mode: 'revise',
  });

  const ledger = loadLedger(extractLedgerYaml(editionText));
  assert.equal(ledger.mode, 'revise');
  assert.equal(ledger.grounding, undefined);
});

test('buildEdition (T011): mode "compose" stamps mode: compose and resolves the model\'s index-based grounding into hash-keyed records that round-trip through loadLedger', () => {
  const { editionText } = buildEdition({
    sourceText: SOURCE_TEXT,
    sourceIdentity: SOURCE_IDENTITY,
    voiceIdentity: VOICE_IDENTITY,
    voiceHash: VOICE_HASH,
    sourceHash: SOURCE_HASH,
    model: COMPOSE_MODEL,
    mode: 'compose',
  });

  const ledger = loadLedger(extractLedgerYaml(editionText));
  assert.equal(ledger.mode, 'compose');
  assert.equal(ledger.grounding?.length, 2);

  const sourceUnits = deriveUnits(SOURCE_TEXT, SOURCE_IDENTITY);
  const editionUnits = deriveUnits(COMPOSE_MODEL.edition, 'edition');
  const first = ledger.grounding?.[0];
  const second = ledger.grounding?.[1];
  assert.equal(first?.basis, 'grounded');
  assert.equal(first?.edition_unit.hash, `sha256:${editionUnits[0]?.contentHash}`);
  assert.equal(first?.beats?.[0]?.hash, `sha256:${sourceUnits[0]?.contentHash}`);
  assert.equal(second?.edition_unit.hash, `sha256:${editionUnits[1]?.contentHash}`);
  assert.equal(second?.beats?.[0]?.hash, `sha256:${sourceUnits[1]?.contentHash}`);
});

test('buildEdition (T011): fails loud when mode is "compose" and the model declared no grounding', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: 'Composed A.\n\nComposed B.\n',
      coverage: [
        { op: 'represented', edition_units: [0] },
        { op: 'represented', edition_units: [1] },
      ],
    }),
  );
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model,
        mode: 'compose',
      }),
    /mode 'compose' requires a non-empty grounding declaration/,
  );
});

test('buildEdition (T011): fails loud when mode is "revise" but the model declared a grounding anyway', () => {
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model: COMPOSE_MODEL,
        mode: 'revise',
      }),
    /mode 'revise' forbids a grounding declaration/,
  );
});

test('buildEdition (T011): fails loud when a grounding edition_unit index is out of range', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: 'Composed A.\n\nComposed B.\n',
      coverage: [
        { op: 'represented', edition_units: [0] },
        { op: 'represented', edition_units: [1] },
      ],
      grounding: [{ edition_unit: 9, basis: 'framing' }],
    }),
  );
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model,
        mode: 'compose',
      }),
    /grounding\[0\]: edition_unit index 9 is out of range/,
  );
});

test('buildEdition (T011): fails loud when a grounding beats index is out of range', () => {
  const model = parseModelOutput(
    JSON.stringify({
      edition: 'Composed A.\n\nComposed B.\n',
      coverage: [
        { op: 'represented', edition_units: [0] },
        { op: 'represented', edition_units: [1] },
      ],
      grounding: [{ edition_unit: 0, basis: 'grounded', beats: [9] }],
    }),
  );
  assert.throws(
    () =>
      buildEdition({
        sourceText: SOURCE_TEXT,
        sourceIdentity: SOURCE_IDENTITY,
        voiceIdentity: VOICE_IDENTITY,
        voiceHash: VOICE_HASH,
        sourceHash: SOURCE_HASH,
        model,
        mode: 'compose',
      }),
    /grounding\[0\]: beats index 9 is out of range/,
  );
});

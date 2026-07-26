// T011: unit tests for the ordered fidelity PRE-checks -- pure, deterministic,
// no-network, no-LLM functions run before any unit obligation is evaluated
// (contract steps 1, 2, 6; FR-017/023; D13.4/D20).
//
// Covers:
// - checkSourceHash: match, mismatch, and bare-hex/`sha256:`-prefix
//   normalization (source_hash is checked FIRST -- SC-003, D15).
// - checkLedgerStructure: delegates to loadLedger; ok on a valid ledger, and
//   a failure that names the offending structural defect on a malformed one.
// - extractLedgerYaml: pulls the `ledger:` sub-tree out of an edition's
//   frontmatter (using the existing faithful-edition.md fixture), plus the
//   two throwing cases (no frontmatter, no `ledger:` key).
// - checkSourceCitationAllowlist: the D13.4 precondition -- ok when every
//   source citation marker is declared, and the two failure shapes (marker
//   present but undeclared; markers present with no allow-list at all).
//
// `@/fidelity/run.ts` (T016) is NOT exercised here -- this file only tests
// the pre-check building blocks in isolation.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkSourceHash } from '@/fidelity/check-source-hash.ts';
import {
  checkLedgerStructure,
  checkSourceCitationAllowlist,
  extractLedgerYaml,
} from '@/fidelity/check-ledger-structure.ts';
import { readFixture } from './support.ts';

function sha256Hex(bytes: string | Uint8Array): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  return createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// checkSourceHash
// ---------------------------------------------------------------------------

test('checkSourceHash: matching source.hash (sha256:-prefixed) is ok', () => {
  const source = 'Alpha beta.\n\nGamma delta.\n';
  const ledgerHash = `sha256:${sha256Hex(source)}`;

  const result = checkSourceHash(source, ledgerHash);

  assert.equal(result.ok, true);
  assert.equal(result.failure, undefined);
});

test('checkSourceHash: bare 64-hex ledger value normalizes to match', () => {
  const source = 'Alpha beta.\n\nGamma delta.\n';
  const bareHex = sha256Hex(source);

  const result = checkSourceHash(source, bareHex);

  assert.equal(result.ok, true, 'a bare-hex ledger value must normalize the same as a prefixed one');
});

test('checkSourceHash: mismatch is refused, naming the ledger and computed hashes', () => {
  const source = 'Alpha beta.\n\nGamma delta.\n';
  const wrongHash = `sha256:${sha256Hex('different bytes entirely')}`;

  const result = checkSourceHash(source, wrongHash);

  assert.equal(result.ok, false);
  assert.match(result.failure ?? '', /source hash/i);
  assert.match(result.failure ?? '', /does not match/i);
  assert.ok(result.failure?.includes(wrongHash), 'failure must name the ledger hash');
  assert.ok(
    result.failure?.includes(sha256Hex(source)),
    'failure must name the computed source hash',
  );
});

test('checkSourceHash: works on raw bytes (Uint8Array), not just strings', () => {
  const bytes = new TextEncoder().encode('Alpha beta.\n\nGamma delta.\n');
  const ledgerHash = `sha256:${sha256Hex(bytes)}`;

  const result = checkSourceHash(bytes, ledgerHash);

  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// checkLedgerStructure
// ---------------------------------------------------------------------------

const VALID_LEDGER_YAML = `
version: 1
source: { identity: source-test, hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }
voice: { identity: voice-test, hash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb }
coverage:
  - source_unit: { hash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc, occurrence: 0 }
    op: verbatim
    edition_units: [ { hash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc, occurrence: 0 } ]
  - source_unit: { hash: sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd, occurrence: 0 }
    op: cut
    reason: "not needed"
`;

const MALFORMED_LEDGER_YAML = `
version: 1
source: { identity: source-test, hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }
voice: { identity: voice-test, hash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb }
coverage:
  - source_unit: { hash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc, occurrence: 0 }
    op: bogus
    edition_units: [ { hash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc, occurrence: 0 } ]
`;

test('checkLedgerStructure: a valid ledger loads ok and returns the parsed ledger', () => {
  const result = checkLedgerStructure(VALID_LEDGER_YAML);

  assert.equal(result.ok, true);
  assert.equal(result.failure, undefined);
  assert.equal(result.ledger?.source.identity, 'source-test');
  assert.equal(result.ledger?.coverage.length, 2);
});

test('checkLedgerStructure: a malformed ledger fails, naming the specific structural defect', () => {
  const result = checkLedgerStructure(MALFORMED_LEDGER_YAML);

  assert.equal(result.ok, false);
  assert.equal(result.ledger, undefined);
  assert.match(result.failure ?? '', /ledger structure:/i);
  assert.match(
    result.failure ?? '',
    /op must be one of verbatim, represented, merged, cut/i,
    `expected the failure to name the invalid op; got: ${result.failure}`,
  );
});

// ---------------------------------------------------------------------------
// extractLedgerYaml
// ---------------------------------------------------------------------------

test('extractLedgerYaml: pulls the ledger sub-tree out of faithful-edition.md and it loads via checkLedgerStructure', () => {
  const edition = readFixture('editions', 'faithful-edition.md');

  const ledgerYaml = extractLedgerYaml(edition);
  const result = checkLedgerStructure(ledgerYaml);

  assert.equal(result.ok, true, `expected the extracted ledger to load cleanly; got failure: ${result.failure}`);
  assert.equal(result.ledger?.source.identity, 'source-riverbank-survey');
  assert.equal(result.ledger?.voice.identity, 'voice-observational-distance');
  assert.equal(result.ledger?.coverage.length, 6);
  assert.equal(
    result.ledger?.source.hash,
    'sha256:7e76eae507dbe92c328efd7134f644aa2aa1819e87f8d77b77a887166c1ba503',
  );
});

test('extractLedgerYaml: throws naming the cause when there is no frontmatter block', () => {
  assert.throws(
    () => extractLedgerYaml('No frontmatter here.\n\nJust body text.\n'),
    /frontmatter/i,
  );
});

test('extractLedgerYaml: throws naming the cause when frontmatter has no "ledger:" key', () => {
  const editionWithoutLedgerKey = '---\ntitle: Test\n---\nBody text.\n';

  assert.throws(() => extractLedgerYaml(editionWithoutLedgerKey), /ledger/i);
});

// ---------------------------------------------------------------------------
// checkSourceCitationAllowlist
// ---------------------------------------------------------------------------

test('checkSourceCitationAllowlist: faithful-source.md fixture is ok (its one marker is declared)', () => {
  const source = readFixture('sources', 'faithful-source.md');

  const result = checkSourceCitationAllowlist(source);

  assert.equal(result.ok, true, `expected ok; got failure: ${result.failure}`);
  assert.equal(result.failure, undefined);
});

test('checkSourceCitationAllowlist: no markers and no allow-list is ok', () => {
  const source = readFixture('sources', 'basic-lf.md');

  const result = checkSourceCitationAllowlist(source);

  assert.equal(result.ok, true);
});

test('checkSourceCitationAllowlist: a marker present but NOT declared in the allow-list fails, naming the marker', () => {
  const source = [
    '---',
    'citation_allowlist:',
    '  - "[^1]"',
    '---',
    'Cited once[^1] and again with an undeclared marker[^2].',
    '',
  ].join('\n');

  const result = checkSourceCitationAllowlist(source);

  assert.equal(result.ok, false);
  assert.match(result.failure ?? '', /citation allow-list/i);
  assert.ok(result.failure?.includes('[^2]'), `expected the failure to name [^2]; got: ${result.failure}`);
});

test('checkSourceCitationAllowlist: markers present with NO declared allow-list at all fails', () => {
  const source = '---\ntitle: undeclared\n---\nA claim with a marker[^1].\n';

  const result = checkSourceCitationAllowlist(source);

  assert.equal(result.ok, false);
  assert.match(result.failure ?? '', /citation allow-list/i);
  assert.ok(result.failure?.includes('[^1]'));
});

test('checkSourceCitationAllowlist: works on raw bytes (Uint8Array), not just strings', () => {
  const source = readFixture('sources', 'faithful-source.md');
  const bytes = new TextEncoder().encode(source);

  const result = checkSourceCitationAllowlist(bytes);

  assert.equal(result.ok, true);
});

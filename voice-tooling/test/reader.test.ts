// Reader generator tests (discover + render): a tiny, deliberately
// subject-agnostic fixture tree -- 2 chapters x 2 voices -- built fresh under
// `withTempDir` for each test, per Constitution VII (no project/story/subject
// strings anywhere, including in these fixtures).

import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTempDir } from './support.ts';
import { discoverEditions } from '@/reader/discover.ts';
import { renderReader } from '@/reader/render.ts';

/** Variant A: verbatim + represented + cut (no merged); body carries a raw
 * "<" character (escaping regression coverage) and a generic [AB-01] tag. */
const EDITION_A = `---
ledger:
  version: 1
  source: { identity: src-1, hash: sha256:aaa1 }
  voice: { identity: voice-alpha, hash: sha256:bbb1 }
  coverage:
    - source_unit: { hash: sha256:u1, occurrence: 0 }
      op: verbatim
      edition_units: [ { hash: sha256:u1, occurrence: 0 } ]
    - source_unit: { hash: sha256:u2, occurrence: 0 }
      op: represented
      edition_units: [ { hash: sha256:e1, occurrence: 0 } ]
    - source_unit: { hash: sha256:u3, occurrence: 0 }
      op: cut
      reason: "restates the prior unit"
---
# A Study

The record states the value is less than the threshold: value < limit [AB-01].

> A preserved passage, kept verbatim [AB-01].
`;

/** Variant B: verbatim + merged (sharing a destination) + cut (no
 * represented). */
const EDITION_B = `---
ledger:
  version: 1
  source: { identity: src-1, hash: sha256:aaa2 }
  voice: { identity: voice-beta, hash: sha256:bbb2 }
  coverage:
    - source_unit: { hash: sha256:v1, occurrence: 0 }
      op: verbatim
      edition_units: [ { hash: sha256:f1, occurrence: 0 } ]
    - source_unit: { hash: sha256:v2, occurrence: 0 }
      op: merged
      edition_units: [ { hash: sha256:f1, occurrence: 0 } ]
    - source_unit: { hash: sha256:v3, occurrence: 0 }
      op: cut
      reason: "trimmed as redundant"
---
# Another Study

A second telling of the same event, condensed [AB-01].
`;

const VOICE_ALPHA_DOC = `version: 1
id: voice-alpha
label: Alpha Voice
purpose: Restrained and precise. It stays close to the record without embellishment.
narrator_distance: Third person, observational.
evidence_posture: Every claim traces to a source.
sentence_movement: Short declaratives.
paragraph_movement: One claim per paragraph.
transitions: Plain connectives.
emotional_temperature: Restrained.
quote_handling: Blockquotes preserved verbatim.
avoid:
  - rhetorical questions
`;

function buildFixture(tmpDir: string): { editionsRoot: string; voicesDir: string } {
  const editionsRoot = path.join(tmpDir, 'editions');
  const voicesDir = path.join(tmpDir, 'voices');

  for (const chapterSlug of ['chapter-one', 'chapter-two']) {
    const chapterDir = path.join(editionsRoot, chapterSlug);
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(path.join(chapterDir, 'voice-alpha.md'), EDITION_A, 'utf8');
    fs.writeFileSync(path.join(chapterDir, 'voice-beta.md'), EDITION_B, 'utf8');
  }

  fs.mkdirSync(voicesDir, { recursive: true });
  fs.writeFileSync(path.join(voicesDir, 'voice-alpha.yaml'), VOICE_ALPHA_DOC, 'utf8');
  // voice-beta.yaml deliberately absent -- exercises the slug-fallback path.

  return { editionsRoot, voicesDir };
}

test('discoverEditions: finds both chapters, sorted, with prettified titles', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    assert.equal(model.chapters.length, 2);
    assert.deepEqual(
      model.chapters.map((c) => c.slug),
      ['chapter-one', 'chapter-two'],
    );
    assert.deepEqual(
      model.chapters.map((c) => c.title),
      ['Chapter One', 'Chapter Two'],
    );
  });
});

test('discoverEditions: orders chapters for reading -- prologue first, numbered by value (ch2 < ch10), epilogue last (AUDIT-20260728-29)', async () => {
  await withTempDir((tmpDir) => {
    const editionsRoot = path.join(tmpDir, 'editions');
    const voicesDir = path.join(tmpDir, 'voices');
    fs.mkdirSync(voicesDir, { recursive: true });
    // created in a lexicographically-misleading order; ch2/ch10 unpadded so a
    // lexicographic sort would place ch10 before ch2 (proving numeric ordering).
    for (const slug of ['epilogue', 'ch10', 'ch2', 'prologue']) {
      const dir = path.join(editionsRoot, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'voice-alpha.md'), EDITION_A, 'utf8');
    }
    const model = discoverEditions({ editionsRoot, voicesDir });
    assert.deepEqual(
      model.chapters.map((c) => c.slug),
      ['prologue', 'ch2', 'ch10', 'epilogue'],
    );
  });
});

test('discoverEditions: each chapter has both voices, sorted by filename', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    for (const chapter of model.chapters) {
      assert.deepEqual(
        chapter.editions.map((e) => e.voiceSlug),
        ['voice-alpha', 'voice-beta'],
      );
    }
  });
});

test('discoverEditions: strips frontmatter, leaving only the body', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    const [chapterOne] = model.chapters;
    assert.ok(chapterOne !== undefined);
    const [alphaEdition] = chapterOne.editions;
    assert.ok(alphaEdition !== undefined);

    assert.ok(!alphaEdition.body.includes('ledger:'));
    assert.ok(!alphaEdition.body.startsWith('---'));
    assert.ok(alphaEdition.body.includes('# A Study'));
    assert.ok(alphaEdition.body.includes('value < limit [AB-01]'));
  });
});

test('discoverEditions: computes correct op-count summaries per edition', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    const [chapterOne] = model.chapters;
    assert.ok(chapterOne !== undefined);
    const [alphaEdition, betaEdition] = chapterOne.editions;
    assert.ok(alphaEdition !== undefined);
    assert.ok(betaEdition !== undefined);

    assert.deepEqual(alphaEdition.summary, { units: 3, verbatim: 1, represented: 1, merged: 0, cut: 1 });
    assert.deepEqual(betaEdition.summary, { units: 3, verbatim: 1, represented: 0, merged: 1, cut: 1 });
  });
});

test('discoverEditions: resolves label + register from a matching voice document', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    const [chapterOne] = model.chapters;
    assert.ok(chapterOne !== undefined);
    const [alphaEdition] = chapterOne.editions;
    assert.ok(alphaEdition !== undefined);

    assert.equal(alphaEdition.label, 'Alpha Voice');
    assert.equal(alphaEdition.register, 'Restrained and precise.');
  });
});

test('discoverEditions: falls back to a prettified slug + empty register when no voice document exists', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    const [chapterOne] = model.chapters;
    assert.ok(chapterOne !== undefined);
    const [, betaEdition] = chapterOne.editions;
    assert.ok(betaEdition !== undefined);

    assert.equal(betaEdition.label, 'Voice Beta');
    assert.equal(betaEdition.register, '');
  });
});

test('discoverEditions: falls back the same way with no voicesDir at all', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot });

    const [chapterOne] = model.chapters;
    assert.ok(chapterOne !== undefined);
    const [alphaEdition] = chapterOne.editions;
    assert.ok(alphaEdition !== undefined);

    assert.equal(alphaEdition.label, 'Voice Alpha');
    assert.equal(alphaEdition.register, '');
  });
});

test('discoverEditions: voices union is stable and matches the discovered slugs', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });

    assert.deepEqual(
      model.voices.map((v) => v.slug),
      ['voice-alpha', 'voice-beta'],
    );
    assert.deepEqual(model.voices[0], { slug: 'voice-alpha', label: 'Alpha Voice', register: 'Restrained and precise.' });
    assert.deepEqual(model.voices[1], { slug: 'voice-beta', label: 'Voice Beta', register: '' });
  });
});

test('discoverEditions: throws naming the path when editionsRoot does not exist', async () => {
  await withTempDir((tmpDir) => {
    const missing = path.join(tmpDir, 'does-not-exist');
    assert.throws(() => discoverEditions({ editionsRoot: missing }), new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('discoverEditions: throws naming the path when editionsRoot has no chapters', async () => {
  await withTempDir((tmpDir) => {
    const editionsRoot = path.join(tmpDir, 'editions');
    fs.mkdirSync(editionsRoot, { recursive: true });
    assert.throws(() => discoverEditions({ editionsRoot }), /contains no chapter subdirectories/);
  });
});

test('discoverEditions: throws naming the chapter when it has no editions', async () => {
  await withTempDir((tmpDir) => {
    const editionsRoot = path.join(tmpDir, 'editions');
    fs.mkdirSync(path.join(editionsRoot, 'empty-chapter'), { recursive: true });
    assert.throws(() => discoverEditions({ editionsRoot }), /empty-chapter.*contains no voice editions/);
  });
});

test('discoverEditions: throws naming the offending file when a ledger is malformed', async () => {
  await withTempDir((tmpDir) => {
    const editionsRoot = path.join(tmpDir, 'editions');
    const chapterDir = path.join(editionsRoot, 'chapter-one');
    fs.mkdirSync(chapterDir, { recursive: true });
    const badFile = path.join(chapterDir, 'voice-alpha.md');
    fs.writeFileSync(
      badFile,
      `---
ledger:
  version: 2
---
Body text.
`,
      'utf8',
    );

    assert.throws(() => discoverEditions({ editionsRoot }), new RegExp(badFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('renderReader: produces a self-contained HTML document with every chapter + voice', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });
    const html = renderReader(model, { title: 'Test Reader Title' });

    assert.ok(html.includes('<title>Test Reader Title</title>'));
    assert.ok(html.includes('Chapter One'));
    assert.ok(html.includes('Chapter Two'));
    assert.ok(html.includes('Alpha Voice'));
    assert.ok(html.includes('Voice Beta'));
    assert.ok(html.includes('id="reader-data"'));
    assert.ok(html.includes('application/json'));
  });
});

test('renderReader: has no external http(s) resource URLs', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });
    const html = renderReader(model, { title: 'Test Reader Title' });

    assert.ok(!html.includes('http://'));
    assert.ok(!html.includes('https://'));
  });
});

test('renderReader: escapes "<" inside the embedded JSON data island', async () => {
  await withTempDir((tmpDir) => {
    const { editionsRoot, voicesDir } = buildFixture(tmpDir);
    const model = discoverEditions({ editionsRoot, voicesDir });
    const html = renderReader(model, { title: 'Test Reader Title' });

    // The raw body text has a literal "value < limit" -- if the data island
    // were not escaped, that literal sequence (a "<" immediately following
    // "value ") would appear verbatim in the document, which could break out
    // of the enclosing <script> element.
    assert.ok(!html.includes('value < limit'));
    assert.ok(html.includes('value \\u003c limit'));
  });
});

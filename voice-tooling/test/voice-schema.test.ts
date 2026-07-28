import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { VoiceDocument } from '@/schema/voice.ts';
import { loadVoice } from '@/schema/voice.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('voice-schema: valid voice document loads and round-trips', () => {
  const yaml = `version: 1
id: observational-distance
label: Observational Distance
purpose: For exposition and background—a distanced, source-anchored narration that states what the record shows without dramatizing it.
narrator_distance: Third-person, observational; the narrator does not enter characters' interiority.
evidence_posture: Every claim traces to a source; uncertainty is stated, never smoothed over.
sentence_movement: Short declaratives; subordinate clauses carry qualification, not drama.
paragraph_movement: One claim develops per paragraph; transitions are chronological or causal, not rhetorical.
transitions: Plain connectives (then, afterward, meanwhile)—no scene-setting flourish.
emotional_temperature: Restrained. Documented consequence is stated once, without repetition for effect.
quote_handling: Blockquotes are preserved verbatim and introduced plainly.
avoid:
  - present-tense narration
  - rhetorical questions
  - unattributed emotional language`;

  const doc = loadVoice(yaml);
  assert.equal(doc.version, 1);
  assert.equal(doc.id, 'observational-distance');
  assert.equal(doc.label, 'Observational Distance');
  assert.equal(doc.avoid.length, 3);
  assert.deepEqual(doc.avoid, [
    'present-tense narration',
    'rhetorical questions',
    'unattributed emotional language',
  ]);
});

test('voice-schema: unknown version refused before any other field is read', () => {
  const yaml = `version: 2
id: should-not-matter
label: Should Not Matter`;

  assert.throws(
    () => loadVoice(yaml),
    /version must be the literal 1/,
  );
});

test('voice-schema: missing version field refused (treated as unknown version)', () => {
  const yaml = `id: test-voice
label: Test Voice
purpose: A test voice`;

  assert.throws(
    () => loadVoice(yaml),
    /version must be the literal 1/,
  );
});

test('voice-schema: missing id field refused, naming the field', () => {
  const yaml = `version: 1
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*id/,
  );
});

test('voice-schema: missing label field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*label/,
  );
});

test('voice-schema: missing purpose field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*purpose/,
  );
});

test('voice-schema: missing narrator_distance field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*narrator_distance/,
  );
});

test('voice-schema: missing evidence_posture field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*evidence_posture/,
  );
});

test('voice-schema: missing sentence_movement field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*sentence_movement/,
  );
});

test('voice-schema: missing paragraph_movement field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*paragraph_movement/,
  );
});

test('voice-schema: missing transitions field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*transitions/,
  );
});

test('voice-schema: missing emotional_temperature field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
quote_handling: Verbatim
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*emotional_temperature/,
  );
});

test('voice-schema: missing quote_handling field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
avoid: []`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*quote_handling/,
  );
});

test('voice-schema: missing avoid field refused, naming the field', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim`;

  assert.throws(
    () => loadVoice(yaml),
    /missing required field.*avoid/,
  );
});

test('voice-schema: avoid must be a list of strings, refuse non-list', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: "not a list"`;

  assert.throws(
    () => loadVoice(yaml),
    /avoid must be a list/,
  );
});

test('voice-schema: avoid list with non-string elements refused', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid:
  - valid string
  - 42
  - another string`;

  assert.throws(
    () => loadVoice(yaml),
    /avoid.*must contain only strings/,
  );
});

test('voice-schema: unknown extra keys accepted and preserved', () => {
  const yaml = `version: 1
id: test-voice
label: Test Voice
purpose: A test voice
narrator_distance: Third person
evidence_posture: Source-anchored
sentence_movement: Short
paragraph_movement: One claim per paragraph
transitions: Chronological
emotional_temperature: Restrained
quote_handling: Verbatim
avoid: []
custom_pacing_notes: Slower than the investigative-momentum voice.
metadata:
  author: someone
  timestamp: 2026-07-26`;

  const doc = loadVoice(yaml);
  assert.equal((doc as Record<string, unknown>).custom_pacing_notes, 'Slower than the investigative-momentum voice.');
  assert.deepEqual((doc as Record<string, unknown>).metadata, {
    author: 'someone',
    timestamp: '2026-07-26',
  });
});

test('voice-schema: documented no-author-imitation refusal statement present in module', () => {
  // Read the source file and verify the documented refusal is present
  const filePath = path.join(__dirname, '..', 'src', 'schema', 'voice.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  // Check that the documented refusal statement is present in the file
  const hasDocumentedRefusal =
    content.includes('named living author') ||
    content.includes('independently-useful traits') ||
    (content.includes('no-author') && content.includes('refusal'));

  assert.ok(
    hasDocumentedRefusal,
    'Voice document schema must contain documented no-author-imitation refusal in its documentation',
  );
});

test('voice-schema: invalid YAML throws with context', () => {
  const yaml = `version: 1
id: test
: : invalid`;

  assert.throws(
    () => loadVoice(yaml),
    /Voice document.*YAML/,
  );
});

test('voice-schema: non-mapping root rejected', () => {
  const yaml = `- just
- a
- list`;

  assert.throws(
    () => loadVoice(yaml),
    /Voice document must be a YAML mapping/,
  );
});

// T020 (US2): assert and lock down the v1 source-locked constraint (FR-007/D5) — a governed
// `voice-revise` target MUST declare EXACTLY ONE source draft input. `parseReviseRequest`
// (@/revise/request.ts) discriminates source vs. voice by TYPE (whatever `loadVoice` accepts is
// the voice; the request's one remaining non-voice input is the source), so "exactly one source"
// really means "exactly one non-voice input" — declaring zero or more than one is refused loudly,
// naming the offending TARGET and the cause, never silently picking one or falling back.
//
// `test/revise.test.ts` already covers the zero-source refusal (via a looser regex) and the
// zero/multi-voice refusals; this file is the focused T020 regression that additionally proves:
//   (a) a well-formed request (1 source + 1 voice) parses cleanly;
//   (b) TWO source-draft inputs (2 non-voice + 1 voice) is refused, naming the target and
//       "exactly one source";
//   (c) ZERO source-draft inputs (only a voice) is refused, naming the target.
// No production-control core change backs this (D1/D19/FR-029): it drives the EXISTING
// `parseReviseRequest` contract directly, the same entry point `bin/voice-revise.mjs` calls.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseReviseRequest } from '@/revise/request.ts';
import { withTempDir } from './support.ts';

const TARGET = 'edition';

const VALID_VOICE_YAML = `
version: 1
id: test-voice
label: "Test voice"
purpose: A fixture voice for unit testing only.
narrator_distance: Third-person, observational.
evidence_posture: Every claim traces to the source.
sentence_movement: Short declaratives.
paragraph_movement: One claim per paragraph.
transitions: Plain connectives.
emotional_temperature: Restrained.
quote_handling: Verbatim spans are preserved.
avoid:
  - present-tense narration
`;

function writeFile(dir: string, name: string, contents: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function wireInput(filePath: string, hashByte: string): { path: string; hash: string } {
  return { path: filePath, hash: `sha256:${hashByte.repeat(64)}` };
}

test('parseReviseRequest: (a) a well-formed request — exactly one source, one voice — parses cleanly', async () => {
  await withTempDir((dir) => {
    const sourcePath = writeFile(dir, 'draft.md', 'The device completed its startup sequence.\n');
    const voicePath = writeFile(dir, 'voice.yaml', VALID_VOICE_YAML);

    const parsed = parseReviseRequest({
      version: 1,
      target: TARGET,
      inputs: {
        source: wireInput(sourcePath, 'a'),
        voice: wireInput(voicePath, 'b'),
      },
      output_dir: dir,
    });

    assert.equal(parsed.target, TARGET);
    assert.equal(parsed.source.identity, 'source');
    assert.equal(parsed.voice.identity, 'voice');
  });
});

test('parseReviseRequest: (b) TWO source-draft inputs are refused, naming the target and "exactly one source"', async () => {
  await withTempDir((dir) => {
    const sourcePathA = writeFile(dir, 'draft-a.md', 'First candidate source draft.\n');
    const sourcePathB = writeFile(dir, 'draft-b.md', 'Second candidate source draft.\n');
    const voicePath = writeFile(dir, 'voice.yaml', VALID_VOICE_YAML);

    const raw = {
      version: 1,
      target: TARGET,
      inputs: {
        'draft-a': wireInput(sourcePathA, 'a'),
        'draft-b': wireInput(sourcePathB, 'b'),
        voice: wireInput(voicePath, 'c'),
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`target ${TARGET}`));
        assert.match(error.message, /expected exactly one source draft input, found 2/);
        assert.match(error.message, /draft-a/);
        assert.match(error.message, /draft-b/);
        return true;
      },
      'must refuse two source-draft candidates, naming the target and the cause',
    );
  });
});

test('parseReviseRequest: (c) ZERO source-draft inputs (only a voice) is refused, naming the target', async () => {
  await withTempDir((dir) => {
    const voicePath = writeFile(dir, 'voice.yaml', VALID_VOICE_YAML);

    const raw = {
      version: 1,
      target: TARGET,
      inputs: {
        voice: wireInput(voicePath, 'a'),
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`target ${TARGET}`));
        assert.match(error.message, /no source draft input declared/);
        assert.match(error.message, /found 0/);
        return true;
      },
      'must refuse zero source-draft candidates, naming the target and the cause',
    );
  });
});

test('parseReviseRequest: the target-naming refusal names a DIFFERENT target for a different request', async () => {
  await withTempDir((dir) => {
    const voicePath = writeFile(dir, 'voice.yaml', VALID_VOICE_YAML);

    const raw = {
      version: 1,
      target: 'some-other-target',
      inputs: {
        voice: wireInput(voicePath, 'a'),
      },
      output_dir: dir,
    };

    assert.throws(() => parseReviseRequest(raw), /target some-other-target/);
  });
});

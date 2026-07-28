// T019: unit coverage for the `voice-revise` provider's request parsing and
// response assembly. The full end-to-end path (spawn the model, gate via
// `voice fidelity`) is covered by the repo-root integration test
// (tests/integration/voice-revise.test.ts, T018/T020); this file exercises
// `@/revise/request.ts`'s source/voice discrimination and fail-loud refusals,
// and `@/revise/emit.ts`'s BuildResponse assembly, in isolation.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseReviseRequest } from '@/revise/request.ts';
import { buildRevisePrompt, invokeModel, resolveModelCommand } from '@/revise/model.ts';
import { emitEdition } from '@/revise/emit.ts';
import { loadVoice } from '@/schema/voice.ts';
import { withTempDir } from './support.ts';

/**
 * AUDIT-20260726-12: `parseReviseRequest` now verifies each declared input
 * hash against the bytes actually read off disk, so every fixture below must
 * declare the REAL digest of the bytes it writes -- a fake placeholder hash
 * (the fixtures used to use `'sha256:' + 'a'.repeat(64)`) is now correctly
 * refused, which would break every test below that isn't the dedicated
 * wrong-hash regression test.
 */
function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

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

const SOURCE_TEXT = 'The device completed its startup sequence without incident.\n';
const SOURCE_HASH = sha256Of(SOURCE_TEXT);
const VOICE_HASH = sha256Of(VALID_VOICE_YAML);

function writeFile(dir: string, name: string, contents: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function buildRequest(
  dir: string,
  overrides: { sourcePath: string; voicePath: string; extra?: Record<string, unknown> },
): unknown {
  return {
    version: 1,
    target: 'edition',
    inputs: {
      source: { path: overrides.sourcePath, hash: SOURCE_HASH },
      voice: { path: overrides.voicePath, hash: VOICE_HASH },
    },
    output_dir: dir,
    ...(overrides.extra ?? {}),
  };
}

test('parseReviseRequest: discriminates source vs voice by TYPE, regardless of input key names', async () => {
  await withTempDir((dir) => {
    const sourcePath = writeFile(dir, 'draft.md', SOURCE_TEXT);
    const voicePath = writeFile(dir, 'v.yaml', VALID_VOICE_YAML);

    // Deliberately swap the wire key NAMES relative to the "obvious" ones --
    // discrimination must be by loadVoice-acceptance, never by key name.
    const raw = {
      version: 1,
      target: 'edition',
      inputs: {
        draft: { path: sourcePath, hash: SOURCE_HASH },
        style: { path: voicePath, hash: VOICE_HASH },
      },
      output_dir: dir,
    };

    const parsed = parseReviseRequest(raw);

    assert.equal(parsed.target, 'edition');
    assert.equal(parsed.source.identity, 'draft');
    assert.equal(parsed.source.path, sourcePath);
    assert.equal(parsed.source.bytes.toString('utf8'), SOURCE_TEXT);
    assert.equal(parsed.voice.identity, 'style');
    assert.equal(parsed.voice.path, voicePath);
    assert.equal(parsed.voice.doc.id, 'test-voice');
    assert.equal(parsed.outputDir, dir);
    assert.equal(parsed.modelCmd, undefined);
  });
});

test('parseReviseRequest: reads an explicit model_cmd off the wire when present', async () => {
  await withTempDir((dir) => {
    const sourcePath = writeFile(dir, 'draft.md', SOURCE_TEXT);
    const voicePath = writeFile(dir, 'v.yaml', VALID_VOICE_YAML);
    const raw = buildRequest(dir, {
      sourcePath,
      voicePath,
      extra: { model_cmd: 'node ./some-model.mjs' },
    });

    const parsed = parseReviseRequest(raw);
    assert.equal(parsed.modelCmd, 'node ./some-model.mjs');
  });
});

test('parseReviseRequest: fails loud naming the cause when no input is a valid voice document', async () => {
  await withTempDir((dir) => {
    const sourcePath = writeFile(dir, 'draft.md', SOURCE_TEXT);
    const otherText = 'Also just plain prose.\n';
    const otherPath = writeFile(dir, 'also-prose.md', otherText);
    const raw = {
      version: 1,
      target: 'edition',
      inputs: {
        source: { path: sourcePath, hash: SOURCE_HASH },
        other: { path: otherPath, hash: sha256Of(otherText) },
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      /no declared input is a valid voice document/,
      'must name the missing-voice cause',
    );
  });
});

test('parseReviseRequest: fails loud naming the cause when no non-voice (source) input is declared', async () => {
  await withTempDir((dir) => {
    const voicePath = writeFile(dir, 'v.yaml', VALID_VOICE_YAML);
    const raw = {
      version: 1,
      target: 'edition',
      inputs: {
        voice: { path: voicePath, hash: VOICE_HASH },
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      /no source draft input declared/,
      'must name the missing-source cause',
    );
  });
});

test('parseReviseRequest: fails loud when more than one declared input is a valid voice document', async () => {
  await withTempDir((dir) => {
    const voiceTextB = VALID_VOICE_YAML.replace('test-voice', 'another-voice');
    const voicePathA = writeFile(dir, 'a.yaml', VALID_VOICE_YAML);
    const voicePathB = writeFile(dir, 'b.yaml', voiceTextB);
    const raw = {
      version: 1,
      target: 'edition',
      inputs: {
        a: { path: voicePathA, hash: VOICE_HASH },
        b: { path: voicePathB, hash: sha256Of(voiceTextB) },
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      /more than one declared input parses as a valid voice document/,
    );
  });
});

test('parseReviseRequest: fails loud on a malformed BuildRequest shape (missing version)', async () => {
  assert.throws(
    () => parseReviseRequest({ target: 'edition', inputs: {}, output_dir: '/tmp' }),
    /version must be the literal 1/,
  );
});

test('parseReviseRequest (AUDIT-20260726-12): refuses, naming the input, when a declared hash does not match the bytes on disk', async () => {
  await withTempDir((dir) => {
    const sourcePath = writeFile(dir, 'draft.md', SOURCE_TEXT);
    const voicePath = writeFile(dir, 'v.yaml', VALID_VOICE_YAML);
    const wrongHash = 'sha256:' + 'f'.repeat(64);
    assert.notEqual(wrongHash, SOURCE_HASH, 'the wrong hash must actually differ from the real one');

    const raw = {
      version: 1,
      target: 'edition',
      inputs: {
        // The source's declared hash is deliberately wrong; the voice's is correct, so the
        // failure must be attributable specifically to the "source" input, not a generic parse
        // failure or the wrong entry.
        source: { path: sourcePath, hash: wrongHash },
        voice: { path: voicePath, hash: VOICE_HASH },
      },
      output_dir: dir,
    };

    assert.throws(
      () => parseReviseRequest(raw),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /voice-revise: declared hash/);
        assert.ok(err.message.includes(wrongHash), 'must name the declared (wrong) hash');
        assert.ok(err.message.includes('source'), 'must name the offending input identity');
        assert.ok(err.message.includes(sourcePath), 'must name the input path');
        assert.ok(
          err.message.includes(SOURCE_HASH),
          'must name the actual hash of the bytes on disk',
        );
        return true;
      },
      'a wrong declared hash must be refused, naming the input identity, its path, the declared ' +
        'hash, and the actual hash',
    );
  });
});

test('buildRevisePrompt: presents the source as numbered units and demands the ModelReviseOutput protocol', () => {
  const voice = loadVoice(VALID_VOICE_YAML);
  const sourceText = 'First unit line one.\nFirst unit line two.\n\nSecond unit only line.\n';
  const prompt = buildRevisePrompt({
    target: 'edition',
    source: { identity: 'draft', text: sourceText },
    voice: { identity: 'style', doc: voice },
  });

  // The two source units appear, in order, with their exact bytes between markers.
  assert.match(prompt, /\[SOURCE UNIT 0\]\nFirst unit line one\.\nFirst unit line two\.\n\[\/SOURCE UNIT 0\]/);
  assert.match(prompt, /\[SOURCE UNIT 1\]\nSecond unit only line\.\n\[\/SOURCE UNIT 1\]/);

  // Every voice trait directive is stated so the model can honour the voice.
  assert.ok(prompt.includes('narrator_distance:'), 'states narrator_distance');
  assert.ok(prompt.includes('quote_handling:'), 'states quote_handling');
  assert.ok(prompt.includes('avoid:'), 'states avoid');
  assert.ok(prompt.includes('present-tense narration'), 'includes an avoid item');

  // The fidelity contract and the required output shape are stated.
  assert.ok(/VERBATIM \(byte-exact\)/.test(prompt), 'states the byte-exact fidelity contract');
  assert.ok(prompt.includes('"edition"') && prompt.includes('"coverage"'), 'names the output shape');
  assert.ok(prompt.includes('0-based indices'), 'demands 0-based edition-unit indices');
});

// ---- resolveModelCommand (FR-005 / SC-002) --------------------------------
//
// The model command is operator-supplied via VOICE_REVISE_MODEL; there is NO
// baked-in default and NO fallback output. These tests pin the fail-loud
// refusal (US1 Acceptance Scenario 2 / SC-002) and the two resolution paths.
// Each mutates the process-global env var and restores it in a `finally` so it
// never leaks into a sibling test.

function withEnvVar(value: string | undefined, body: () => void): void {
  const saved = process.env.VOICE_REVISE_MODEL;
  try {
    if (value === undefined) {
      delete process.env.VOICE_REVISE_MODEL;
    } else {
      process.env.VOICE_REVISE_MODEL = value;
    }
    body();
  } finally {
    if (saved === undefined) {
      delete process.env.VOICE_REVISE_MODEL;
    } else {
      process.env.VOICE_REVISE_MODEL = saved;
    }
  }
}

test('resolveModelCommand: fails loud naming VOICE_REVISE_MODEL when neither an explicit command nor the env var is set (FR-005/SC-002)', () => {
  withEnvVar(undefined, () => {
    assert.throws(
      () => resolveModelCommand(undefined),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /VOICE_REVISE_MODEL/, 'must name the missing environment variable');
        assert.match(
          err.message,
          /never invents a default model|falls back to mock output/,
          'must state there is no default model / no fallback',
        );
        return true;
      },
      'an unset VOICE_REVISE_MODEL with no explicit command must refuse, naming the missing configuration',
    );
  });
});

test('resolveModelCommand: an empty/whitespace VOICE_REVISE_MODEL is still a refusal (no silent fallback)', () => {
  withEnvVar('   ', () => {
    assert.throws(() => resolveModelCommand(undefined), /VOICE_REVISE_MODEL/);
  });
});

test('resolveModelCommand: reads the VOICE_REVISE_MODEL env var and tokenizes it into command + args', () => {
  withEnvVar('my-model --flag', () => {
    const cmd = resolveModelCommand(undefined);
    assert.equal(cmd.command, 'my-model');
    assert.deepEqual(cmd.args, ['--flag']);
  });
});

test('resolveModelCommand: an explicit command wins over the env var and is tokenized', () => {
  withEnvVar('env-model', () => {
    const cmd = resolveModelCommand('claude -p --model sonnet');
    assert.equal(cmd.command, 'claude');
    assert.deepEqual(cmd.args, ['-p', '--model', 'sonnet']);
  });
});

test('invokeModel: writes the prompt on stdin and returns the raw stdout', async () => {
  // Echo stdin back to stdout, verifying the prompt is delivered on stdin and the
  // exact stdout is returned for parseModelOutput. `command`/`args` are supplied
  // directly (bypassing resolveModelCommand's whitespace tokenizer).
  const cmd = {
    command: process.execPath,
    args: ['-e', 'process.stdin.on("data", (d) => process.stdout.write(d));'],
  };
  const out = await invokeModel(cmd, 'THE PROMPT PAYLOAD');
  assert.equal(out, 'THE PROMPT PAYLOAD');
});

test('invokeModel: fails loud on a non-zero model exit', async () => {
  const cmd = { command: process.execPath, args: ['-e', 'process.exit(3)'] };
  await assert.rejects(() => invokeModel(cmd, 'x'), /exited with code 3/);
});

test('emit: writes the edition and returns an impure BuildResponse naming the target file, with no validation verdict', async () => {
  await withTempDir(async (dir) => {
    const editionText = '---\nledger:\n  version: 1\n---\nSome revised body.\n';
    const response = await emitEdition(dir, 'edition', editionText, '0.1.0');

    assert.equal(response.version, 1);
    assert.deepEqual(response.outputs, [{ path: 'edition.md' }]);
    assert.equal(response.tool.name, 'voice-revise');
    assert.equal(response.tool.version, '0.1.0');
    assert.ok(response.impure.reason.trim().length > 0, 'impure.reason must be non-empty (FR-032)');
    assert.equal(
      'validation' in response,
      false,
      'voice-revise reports no validation verdict of its own (D3)',
    );

    const written = fs.readFileSync(path.join(dir, 'edition.md'), 'utf8');
    assert.equal(written, editionText);
  });
});

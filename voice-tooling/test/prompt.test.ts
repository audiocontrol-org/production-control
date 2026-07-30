// T004 (RED-first): unit coverage for the mode-keyed prompt module
// (`@/revise/prompt/index.ts`'s `buildPrompt(mode, input)`), per
// specs/006-voice-compose-from-spine/contracts/voice-compose-cli.md
// ("Model protocol (compose)") and plan.md's Project Structure
// (`revise/prompt/{compose,revise}.ts`).
//
// `@/revise/prompt/index.ts` does not exist yet at RED time (T003 implements
// it) -- this file is expected to fail to load with a "cannot find module"
// error until then, which is the correct RED state for a test-first task.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { buildPrompt } from '@/revise/prompt/index.ts';
import { loadVoice } from '@/schema/voice.ts';
import { readFixture } from './support.ts';

const voice = loadVoice(readFixture('spine', 'compose-voice.md'));
const spineText = readFixture('spine', 'minimal-spine.md');

const input = {
  target: 'edition',
  source: { identity: 'spine', text: spineText },
  voice: { identity: 'compose-voice', doc: voice },
};

// ---- compose ---------------------------------------------------------------

test('buildPrompt(compose): demands expansion of beats into voiced prose', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /expand/i, 'must instruct the model to EXPAND beats into prose');
  assert.match(prompt, /voiced prose|full prose|full voiced prose/i);
});

test('buildPrompt(compose): demands a grounding declaration', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /"grounding"/, 'names the grounding field in the output shape');
  assert.match(prompt, /grounded\|connective\|framing|"grounded"|"connective"|"framing"/);
  assert.match(prompt, /"beats"/, 'names the 0-based beat indices field');
});

test('buildPrompt(compose): states grounding as a UNION -- grounded records carry beats, connective/framing do NOT (D10, AUDIT-22)', () => {
  const prompt = buildPrompt('compose', input);
  // The output shape must NOT show `beats` on every entry: the parser rejects
  // `beats` for connective/framing, so a model following the shape literally
  // would be refused. Grounded → beats; connective/framing → no beats.
  assert.match(
    prompt,
    /"basis":\s*"grounded",\s*"beats"/,
    'a grounded record in the output shape must carry "beats"',
  );
  assert.match(
    prompt,
    /"basis":\s*"connective\|framing"\s*}/,
    'a connective/framing record in the output shape must NOT carry "beats"',
  );
});

test('buildPrompt(compose): FORBIDS verbatim reproduction', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /never\s+"?verbatim"?/i, 'must forbid the verbatim op');
});

test('buildPrompt(compose): FORBIDS cut', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /never\s+"?cut"?/i, 'must forbid the cut op');
});

test('buildPrompt(compose): states the output is one JSON object with edition, coverage, grounding', () => {
  const prompt = buildPrompt('compose', input);
  assert.ok(prompt.includes('"edition"'));
  assert.ok(prompt.includes('"coverage"'));
  assert.ok(prompt.includes('"grounding"'));
  assert.match(prompt, /represented\|merged|"represented"|"merged"/);
});

test('buildPrompt(compose): preserves OPEN-QUESTION markers and forbids invention', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /OPEN-QUESTION/, 'states the open-question marker must be preserved');
  assert.match(prompt, /invent nothing|do not invent|never invent/i);
});

test('buildPrompt(compose): numbers the spine beats for unambiguous indexing', () => {
  const prompt = buildPrompt('compose', input);
  assert.match(prompt, /\[BEAT 0\]/, 'presents beat 0 with a numbered marker');
  assert.match(prompt, /\[BEAT 1\]/, 'presents beat 1 with a numbered marker');
});

// ---- revise -----------------------------------------------------------------

test('buildPrompt(revise): states that verbatim == byte-exact destination equality', () => {
  const prompt = buildPrompt('revise', input);
  assert.match(
    prompt,
    /verbatim.{0,200}byte-exact|byte-exact.{0,200}verbatim/is,
    'must tie the "verbatim" op to byte-exact destination equality (TASK-50)',
  );
});

test('buildPrompt(revise): still numbers source units and states the ModelReviseOutput shape', () => {
  const prompt = buildPrompt('revise', input);
  assert.match(prompt, /\[SOURCE UNIT 0\]/);
  assert.ok(prompt.includes('"edition"') && prompt.includes('"coverage"'));
});

// ---- mode dispatch ------------------------------------------------------------

test('buildPrompt: compose and revise produce distinct prompt bodies', () => {
  const compose = buildPrompt('compose', input);
  const revise = buildPrompt('revise', input);
  assert.notEqual(compose, revise);
});

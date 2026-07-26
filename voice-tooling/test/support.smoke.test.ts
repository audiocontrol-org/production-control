import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { fixturePath, readFixture, withTempDir } from './support.ts';

test('support: fixturePath resolves correctly', () => {
  const sourcesPath = fixturePath('sources');
  assert.match(sourcesPath, /test\/fixtures\/sources$/);
  assert.ok(fs.existsSync(sourcesPath), 'sources fixture directory should exist');
});

test('support: readFixture can read fixture files', () => {
  // Write a test fixture and read it back
  const testContent = 'test fixture content';
  const testFile = fixturePath('test-temp.txt');

  try {
    fs.writeFileSync(testFile, testContent, 'utf8');
    const content = readFixture('test-temp.txt');
    assert.strictEqual(content, testContent);
  } finally {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
});

test('support: withTempDir creates and cleans up directory', async () => {
  let createdDir: string | undefined;

  await withTempDir((dir) => {
    createdDir = dir;
    assert.ok(fs.existsSync(dir), 'temp directory should exist during execution');

    // Write a file to verify it's writable
    const testFile = `${dir}/test.txt`;
    fs.writeFileSync(testFile, 'test content', 'utf8');
    assert.ok(fs.existsSync(testFile), 'should be able to write files to temp directory');
  });

  assert.ok(
    createdDir !== undefined,
    'directory should have been created',
  );
  assert.ok(
    !fs.existsSync(createdDir),
    'temp directory should be cleaned up after execution',
  );
});

test('support: withTempDir cleans up on async function error', async () => {
  let createdDir: string | undefined;

  try {
    await withTempDir(async (dir) => {
      createdDir = dir;
      assert.ok(fs.existsSync(dir), 'temp directory should exist during execution');
      throw new Error('test error');
    });
  } catch (err) {
    // Expected error
  }

  assert.ok(
    createdDir !== undefined,
    'directory should have been created',
  );
  assert.ok(
    !fs.existsSync(createdDir),
    'temp directory should be cleaned up even after error',
  );
});

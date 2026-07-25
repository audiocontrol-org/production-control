// Contract tests for the shared source loader (src/sources.mjs), used by BOTH bins.
// Covers the manifest id carrier (stable ids that are NOT filenames, nested paths),
// the v1 filename-stem fallback, path containment, and the "name EVERY problem in one
// refusal" requirement (a 122-source corpus must be fixable in a single pass).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSources } from '../src/sources.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qb-sources-'));
}

function writeFileDeep(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/** Assemble a sources dir from a { relPath: contents } map, plus optional manifest text. */
function makeDir(tmp, files, manifestText) {
  const sourcesDir = path.join(tmp, 'sources');
  fs.mkdirSync(sourcesDir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    writeFileDeep(path.join(sourcesDir, rel), contents);
  }
  if (manifestText !== undefined) {
    fs.writeFileSync(path.join(sourcesDir, 'sources.yaml'), manifestText, 'utf8');
  }
  return sourcesDir;
}

/** Run loadSources expecting a refusal; return the thrown Error's message. */
function refusalMessage(sourcesDir) {
  try {
    loadSources(sourcesDir);
  } catch (err) {
    return err.message;
  }
  throw new Error('expected loadSources to throw, but it returned');
}

test('sources: manifest mode (stable ids, nested paths)', async (t) => {
  await t.test('maps stable ids to nested paths and reads exact bytes', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        {
          'newspapers/la-nouvelle-france/1879-07-15_x/issue.txt': 'first issue text\n',
          'newspapers/a-nobleman/issue.txt': 'second issue text\n',
        },
        [
          'version: 1',
          'sources:',
          '  PB-P001: newspapers/la-nouvelle-france/1879-07-15_x/issue.txt',
          '  PB-P023: newspapers/a-nobleman/issue.txt',
          '',
        ].join('\n')
      );

      const { files, manifestUsed } = loadSources(sourcesDir);

      assert.equal(manifestUsed, true, 'manifest should be used when sources.yaml exists');
      assert.deepEqual(
        files.map((f) => f.id),
        ['PB-P001', 'PB-P023']
      );
      assert.equal(files[0].bytes.toString('utf8'), 'first issue text\n');
      assert.equal(files[1].bytes.toString('utf8'), 'second issue text\n');
      assert.equal(
        files[0].path,
        path.join(sourcesDir, 'newspapers/la-nouvelle-france/1879-07-15_x/issue.txt')
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('every document may share the same filename (the real-archive case)', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        {
          'a/issue.txt': 'alpha\n',
          'b/issue.txt': 'beta\n',
          'c/issue.txt': 'gamma\n',
        },
        ['version: 1', 'sources:', '  PB-P001: a/issue.txt', '  PB-P002: b/issue.txt', '  PB-P003: c/issue.txt', ''].join(
          '\n'
        )
      );

      const { files } = loadSources(sourcesDir);
      assert.deepEqual(
        files.map((f) => f.id),
        ['PB-P001', 'PB-P002', 'PB-P003']
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('returns files sorted by id', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'z.txt': 'z\n', 'm.txt': 'm\n', 'a.txt': 'a\n' },
        ['version: 1', 'sources:', '  PB-P030: z.txt', '  PB-P002: m.txt', '  PB-P011: a.txt', ''].join('\n')
      );

      const { files } = loadSources(sourcesDir);
      assert.deepEqual(
        files.map((f) => f.id),
        ['PB-P002', 'PB-P011', 'PB-P030']
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('sources.yaml is never itself loaded as a source document', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', ''].join('\n')
      );

      const { files } = loadSources(sourcesDir);
      assert.equal(files.length, 1);
      assert.equal(files[0].id, 'PB-P001');
      const manifestPath = path.join(sourcesDir, 'sources.yaml');
      assert.ok(
        files.every((f) => f.path !== manifestPath),
        'the manifest must not appear among the loaded sources'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a manifest entry declaring sources.yaml itself is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  PB-P002: sources.yaml', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /sources\.yaml/);
      assert.match(message, /PB-P002/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('sources: fallback mode (v1 filename-stem rule, unchanged)', async (t) => {
  await t.test('ids are filename stems of regular files directly in the dir', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, {
        'winthrop.txt': 'city upon a hill\n',
        'speech.md': 'four score\n',
        'nested/ignored.txt': 'nested files are not flat sources\n',
      });

      const { files, manifestUsed } = loadSources(sourcesDir);

      assert.equal(manifestUsed, false, 'no manifest present, so fallback mode');
      assert.deepEqual(
        files.map((f) => f.id),
        ['speech', 'winthrop']
      );
      assert.equal(files[1].bytes.toString('utf8'), 'city upon a hill\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('duplicate stems (FR-018) are refused, naming both files', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, { 'dup.txt': 'a\n', 'dup.md': 'b\n' });

      const message = refusalMessage(sourcesDir);
      assert.match(message, /duplicate/i);
      assert.match(message, /dup/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a non-UTF-8 file is refused and named', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, { 'ok.txt': 'fine\n' });
      fs.writeFileSync(path.join(sourcesDir, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x00, 0x9c]));

      const message = refusalMessage(sourcesDir);
      assert.match(message, /utf-?8/i);
      assert.match(message, /bad/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('sources: manifest refusals', async (t) => {
  await t.test('an unknown manifest version is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 2', 'sources:', '  PB-P001: a.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /version/i);
      assert.match(message, /2/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a missing or non-object sources map is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, { 'a.txt': 'alpha\n' }, 'version: 1\n');
      assert.match(refusalMessage(sourcesDir), /sources/i);

      const other = makeDir(tmp, {}, undefined);
      fs.writeFileSync(path.join(other, 'sources.yaml'), 'version: 1\nsources: [a.txt]\n', 'utf8');
      assert.match(refusalMessage(other), /sources/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('unparseable manifest YAML is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, { 'a.txt': 'alpha\n' }, 'version: 1\nsources:\n  - [unclosed\n');
      assert.match(refusalMessage(sourcesDir), /manifest|yaml|parse/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a path escaping the sources dir is REFUSED (containment)', () => {
    const tmp = mkTmp();
    try {
      fs.writeFileSync(path.join(tmp, 'outside.txt'), 'secret\n', 'utf8');
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  PB-P002: ../outside.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /escape|outside|contain/i);
      assert.match(message, /PB-P002/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('an absolute path is REFUSED (containment)', () => {
    const tmp = mkTmp();
    try {
      const outside = path.join(tmp, 'outside.txt');
      fs.writeFileSync(outside, 'secret\n', 'utf8');
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', `  PB-P002: ${outside}`, ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /absolute|escape|contain/i);
      assert.match(message, /PB-P002/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a missing declared path is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  PB-P002: nope/missing.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /missing|not found|does not exist/i);
      assert.match(message, /nope\/missing\.txt/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a declared path that is a directory is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'dir/a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: dir', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /regular file|not a file|directory/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('duplicate ids are refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  PB-P001: b.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /duplicate/i);
      assert.match(message, /PB-P001/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('case-colliding ids are refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  pb-p001: b.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /case/i);
      assert.match(message, /pb-p001/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('an id containing a path separator or an empty id is refused', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' },
        ['version: 1', 'sources:', '  a/b: a.txt', '  "": b.txt', ''].join('\n')
      );

      const message = refusalMessage(sourcesDir);
      assert.match(message, /invalid source id/i);
      assert.match(message, /a\/b/);
      assert.match(message, /empty/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('a non-UTF-8 declared source is refused and named', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'a.txt': 'alpha\n' },
        ['version: 1', 'sources:', '  PB-P001: a.txt', '  PB-P002: nested/bad.txt', ''].join('\n')
      );
      writeFileDeep(path.join(sourcesDir, 'nested/bad.txt'), Buffer.from([0xc3, 0x28]));

      const message = refusalMessage(sourcesDir);
      assert.match(message, /utf-?8/i);
      assert.match(message, /PB-P002/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('sources: EVERY problem is named in ONE refusal (TASK-10)', async (t) => {
  await t.test('two non-UTF-8 sources are BOTH named in a single error', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'ok.txt': 'fine\n' },
        [
          'version: 1',
          'sources:',
          '  PB-P001: ok.txt',
          '  PB-P002: one/issue.txt',
          '  PB-P003: two/issue.txt',
          '',
        ].join('\n')
      );
      writeFileDeep(path.join(sourcesDir, 'one/issue.txt'), Buffer.from([0xff, 0xff]));
      writeFileDeep(path.join(sourcesDir, 'two/issue.txt'), Buffer.from([0x80, 0x80]));

      const message = refusalMessage(sourcesDir);
      assert.match(message, /one\/issue\.txt/, 'the FIRST bad source must be named');
      assert.match(message, /two\/issue\.txt/, 'the SECOND bad source must ALSO be named');
      assert.match(message, /PB-P002/);
      assert.match(message, /PB-P003/);
      assert.equal(
        message.split('\n').filter((line) => /utf-?8/i.test(line)).length,
        2,
        'one line per bad source'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('mixed problem kinds are all reported together', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(
        tmp,
        { 'ok.txt': 'fine\n' },
        [
          'version: 1',
          'sources:',
          '  PB-P001: ok.txt',
          '  PB-P002: gone.txt',
          '  PB-P003: ../escape.txt',
          '  bad/id: ok.txt',
          '  PB-P004: bin/bad.txt',
          '',
        ].join('\n')
      );
      writeFileDeep(path.join(sourcesDir, 'bin/bad.txt'), Buffer.from([0xff]));

      const message = refusalMessage(sourcesDir);
      for (const needle of ['PB-P002', 'PB-P003', 'bad/id', 'PB-P004']) {
        assert.ok(message.includes(needle), `expected refusal to name '${needle}': ${message}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('two non-UTF-8 files in fallback mode are BOTH named', () => {
    const tmp = mkTmp();
    try {
      const sourcesDir = makeDir(tmp, { 'ok.txt': 'fine\n' });
      fs.writeFileSync(path.join(sourcesDir, 'bad-one.txt'), Buffer.from([0xff, 0xff]));
      fs.writeFileSync(path.join(sourcesDir, 'bad-two.txt'), Buffer.from([0x80, 0x80]));

      const message = refusalMessage(sourcesDir);
      assert.match(message, /bad-one/);
      assert.match(message, /bad-two/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('sources: unreadable sources directory is refused', () => {
  const tmp = mkTmp();
  try {
    const missing = path.join(tmp, 'no-such-dir');
    const message = refusalMessage(missing);
    assert.match(message, /no-such-dir/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

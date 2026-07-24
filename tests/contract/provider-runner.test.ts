import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { subprocessRunner } from '@/providers/run.js';
import { makeRequest, fakeDecl, nodeDecl, expectedContent } from './provider-support.js';

/**
 * The provider runner (`subprocessRunner`) against the REAL fake provider (T052).
 *
 * The failure modes are not defensive padding. Each one is a specific FALSE-CLEAN the ledger
 * exists to prevent (FR-033): an empty success recorded as success, an undeclared file whose
 * origin nothing captures, a missing tool quietly skipped.
 */
describe('contract: the producing tool (provider)', () => {
  let work: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-provider-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(work, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T052 — the runner against the real fake provider
  // -------------------------------------------------------------------------

  describe('a well-formed provider', () => {
    it('is accepted, and its outputs land in output_dir', async () => {
      const request = await makeRequest(work);
      const response = await subprocessRunner().run(request, fakeDecl);

      expect(response).toEqual({
        version: 1,
        outputs: [{ path: 'podcast.out' }],
        tool: { name: 'fake-provider', version: '1.0.0' },
        validation: { state: 'passed' },
      });

      const produced = await fs.readFile(path.join(request.output_dir, 'podcast.out'), 'utf8');
      expect(produced).toBe(expectedContent(request, 'podcast'));
    });

    it('omits `impure` when it is referentially transparent (absence is the honest case)', async () => {
      const response = await subprocessRunner().run(await makeRequest(work), fakeDecl);
      expect(response.impure).toBeUndefined();
    });
  });

  describe('FAKE_PROVIDER_MODE=fail — a non-zero exit', () => {
    it('is a failure, with stderr surfaced verbatim', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'fail');
      const request = await makeRequest(work);

      // The provider's own diagnostic is the only account of what went wrong. It must reach
      // the operator intact, not paraphrased into "provider failed".
      await expect(subprocessRunner().run(request, fakeDecl)).rejects.toThrow(
        /FAKE_PROVIDER_MODE=fail -- simulated failure/
      );
      await expect(subprocessRunner().run(request, fakeDecl)).rejects.toThrow(/exited with code 1/);
    });
  });

  describe('FAKE_PROVIDER_MODE=silent — exit 0 with zero outputs', () => {
    it('is a FAILURE: silence is failure (contract Rule 7, FR-033)', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'silent');
      const request = await makeRequest(work);

      // The provider exits 0 and reports a passing validation. Trusting the exit code would
      // record an empty build as a success — exactly the false-clean the ledger exists to
      // prevent. The refusal names `outputs`.
      await expect(subprocessRunner().run(request, fakeDecl)).rejects.toThrow(
        /malformed BuildResponse — outputs: must be non-empty/
      );
    });
  });

  describe('FAKE_PROVIDER_MODE=undeclared — a file the response never named', () => {
    it('is a FAILURE naming the undeclared file (contract Rule 5, FR-033)', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'undeclared');
      const request = await makeRequest(work);

      // It looks like a bonus and is actually a hole in the record: the ledger is written from
      // the declared list, so an undeclared file is one whose origin nothing captures.
      await expect(subprocessRunner().run(request, fakeDecl)).rejects.toThrow(
        /podcast\.undeclared/
      );
      await expect(subprocessRunner().run(request, fakeDecl)).rejects.toThrow(/did not declare/);
    });
  });

  describe('FAKE_PROVIDER_MODE=impure — a declared impurity', () => {
    it("carries the provider's `impure.reason` through to the caller (FR-032)", async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'impure');
      const response = await subprocessRunner().run(await makeRequest(work), fakeDecl);

      // The reason is the payload, not the flag. A reader deciding whether to trust, cache, or
      // repair the artifact needs to know WHICH kind of impurity — so it must survive the
      // boundary intact rather than be flattened to a boolean.
      expect(response.impure).toEqual({
        reason: 'emits a per-run timestamp and random nonce; output varies by invocation',
      });
    });

    it('is still a success — impurity is declared, not forbidden', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'impure');
      const response = await subprocessRunner().run(await makeRequest(work), fakeDecl);
      expect(response.outputs).toEqual([{ path: 'podcast.out' }]);
    });

    it('really does vary per run (the fixture is not lying about being impure)', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'impure');
      const runner = subprocessRunner();
      const first = await makeRequest(work, { outputDir: path.join(work, 'imp-1') });
      const second = await makeRequest(work, { outputDir: path.join(work, 'imp-2') });
      await runner.run(first, fakeDecl);
      await runner.run(second, fakeDecl);

      const a = await fs.readFile(path.join(first.output_dir, 'podcast.out'), 'utf8');
      const b = await fs.readFile(path.join(second.output_dir, 'podcast.out'), 'utf8');
      expect(a).not.toBe(b);
    });
  });

  describe('a command that cannot be run', () => {
    it('fails NAMING the command when it is not on PATH (FR-036)', async () => {
      const missing = 'pc-definitely-not-a-real-provider';
      await expect(
        subprocessRunner().run(await makeRequest(work), { cmd: [missing] })
      ).rejects.toThrow(new RegExp(`provider command not found: "${missing}"`));
    });

    it('fails NAMING the command when the path does not exist', async () => {
      const missing = path.join(work, 'nope', 'not-here');
      await expect(
        subprocessRunner().run(await makeRequest(work), { cmd: [missing] })
      ).rejects.toThrow(missing);
    });

    it('fails NAMING the command when the file is not executable', async () => {
      const notExecutable = path.join(work, 'not-executable');
      await fs.writeFile(notExecutable, 'irrelevant\n', { mode: 0o644 });
      await expect(
        subprocessRunner().run(await makeRequest(work), { cmd: [notExecutable] })
      ).rejects.toThrow(new RegExp(`not executable: "${notExecutable.replace(/\//g, '\\/')}"`));
    });

    it('never substitutes a default or skips the target — it only throws (FR-036)', async () => {
      // The negative half of the same rule: no code path turns an absent tool into a
      // no-op success. If this ever resolves, a target silently stopped being built.
      const request = await makeRequest(work);
      await expect(
        subprocessRunner().run(request, { cmd: [path.join(work, 'absent-tool')] })
      ).rejects.toThrow();
      await expect(fs.readdir(request.output_dir)).rejects.toThrow();
    });

    it('refuses a declaration with an empty cmd rather than spawning undefined', async () => {
      await expect(subprocessRunner().run(await makeRequest(work), { cmd: [] })).rejects.toThrow(
        /empty `cmd`/
      );
    });
  });

  describe('stdout that is not a well-formed BuildResponse', () => {
    it('fails naming it as invalid JSON, and shows what was written', async () => {
      await expect(
        subprocessRunner().run(
          await makeRequest(work),
          nodeDecl('process.stdout.write("this is not json")')
        )
      ).rejects.toThrow(/not valid JSON[\s\S]*this is not json/);
    });

    it('fails when stdout is empty despite exit 0', async () => {
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl('process.exit(0)'))
      ).rejects.toThrow(/wrote nothing to stdout; expected a BuildResponse/);
    });

    it('fails naming the MISSING field when the shape is wrong', async () => {
      const script = 'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}]}))';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/malformed BuildResponse — tool:/);
    });

    it('refuses an unknown `version` rather than parsing it best-effort (FR-005)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:2,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"}}))';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/malformed BuildResponse — version:/);
    });

    it('refuses a BARE BOOLEAN `impure` — the reason is the point (FR-032)', async () => {
      // contracts/provider.md Rule 4 and the table both spell the transparent case as the
      // field being ABSENT. Accepting `impure: false` would re-admit the flag-shaped impurity
      // FR-032 forbids, and `impure: true` would follow one release later with nothing to say.
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"},impure:false}))';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/malformed BuildResponse — impure:/);
    });

    it('refuses `impure` with no reason (FR-032)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"},impure:{}}))';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/malformed BuildResponse — impure\.reason:/);
    });
  });

  describe('a declared output that does not exist on disk', () => {
    it('fails naming it (FR-033)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"never-written.mp3"}],tool:{name:"t",version:"1"}}))';
      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/declared 1 output\(s\) that do not exist[\s\S]*never-written\.mp3/);
    });
  });

  describe('the undeclared-output check', () => {
    it('finds a file hiding in a SUBDIRECTORY of output_dir', async () => {
      // A top-level-only walk would let an undeclared file hide one directory down, which is
      // precisely where it would hide.
      const script = [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'let raw = "";',
        'process.stdin.on("data", (c) => (raw += c));',
        'process.stdin.on("end", () => {',
        '  const req = JSON.parse(raw);',
        '  fs.mkdirSync(path.join(req.output_dir, "nested"), { recursive: true });',
        '  fs.writeFileSync(path.join(req.output_dir, "declared.out"), "ok");',
        '  fs.writeFileSync(path.join(req.output_dir, "nested", "sneaky.tmp"), "surprise");',
        '  process.stdout.write(JSON.stringify({version:1,outputs:[{path:"declared.out"}],tool:{name:"t",version:"1"}}));',
        '});',
      ].join('');

      await expect(
        subprocessRunner().run(await makeRequest(work), nodeDecl(script))
      ).rejects.toThrow(/nested\/sneaky\.tmp/);
    });
  });
});

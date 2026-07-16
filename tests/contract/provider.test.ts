import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import type { ProviderDecl } from '@/manifest/schema.js';
import { BuildOutputSchema, parseBuildResponse, type BuildRequest } from '@/providers/contract.js';
import { subprocessRunner } from '@/providers/run.js';

/**
 * The provider contract (contracts/provider.md) and its runner.
 *
 * This drives the REAL `tests/fixtures/fake-provider` — an actual executable, spawned as an
 * actual subprocess — rather than a mock of one. A mocked provider would prove only that the
 * runner agrees with my idea of the contract; the point of the contract is that it holds
 * across a process boundary, for a program that knows nothing about production-control.
 *
 * The failure modes are not defensive padding. Each one is a specific FALSE-CLEAN the ledger
 * exists to prevent (FR-033): an empty success recorded as success, an undeclared file whose
 * origin nothing captures, a missing tool quietly skipped.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_PROVIDER = path.join(ROOT, 'tests', 'fixtures', 'fake-provider');

/** The bytes the fake provider derives from a request — sorted `<identity>:<hash>`, then target. */
function expectedContent(request: BuildRequest, target: string): string {
  const lines = Object.keys(request.inputs)
    .sort()
    .map((identity) => {
      const input = request.inputs[identity];
      if (input === undefined) {
        throw new Error(`input "${identity}" vanished from the request`);
      }
      return `${identity}:${input.hash}`;
    });
  lines.push(`target:${target}`);
  return `${lines.join('\n')}\n`;
}

interface RawResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/**
 * Spawns a command and pipes it a BuildRequest — WITHOUT the runner. Used by the "runnable by
 * hand" proof (T056), where routing through production-control's own runner would beg the
 * question the test exists to answer.
 */
function pipeRequest(
  command: string,
  request: BuildRequest,
  env?: Readonly<Record<string, string>>
): Promise<RawResult> {
  return new Promise<RawResult>((resolve, reject) => {
    const child = childProcess.spawn(command, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

describe('contract: the producing tool (provider)', () => {
  let work: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-provider-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(work, { recursive: true, force: true });
  });

  /**
   * Builds a request against a real input file with a real hash. `inputs` carries an
   * ALREADY-RESOLVED LOCAL path — the whole point of FR-030. Nothing here fetches, and the
   * provider is never handed a credential or a store.
   */
  async function makeRequest(options?: {
    readonly target?: string;
    readonly outputDir?: string;
  }): Promise<BuildRequest> {
    const inputDir = path.join(work, 'in');
    await fs.mkdir(inputDir, { recursive: true });
    const inputPath = path.join(inputDir, 'voiceover.wav');
    await fs.writeFile(inputPath, 'the quick brown fox\n');
    return {
      version: 1,
      target: options?.target ?? 'podcast',
      inputs: { voiceover: { path: inputPath, hash: await hashFile(inputPath) } },
      output_dir: options?.outputDir ?? path.join(work, 'out'),
    };
  }

  const fakeDecl: ProviderDecl = { cmd: [FAKE_PROVIDER] };

  /** A provider written inline, for shapes the fake provider deliberately cannot produce. */
  function nodeDecl(script: string): ProviderDecl {
    return { cmd: [process.execPath, '-e', script] };
  }

  // -------------------------------------------------------------------------
  // T052 — the runner against the real fake provider
  // -------------------------------------------------------------------------

  describe('a well-formed provider', () => {
    it('is accepted, and its outputs land in output_dir', async () => {
      const request = await makeRequest();
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
      const response = await subprocessRunner().run(await makeRequest(), fakeDecl);
      expect(response.impure).toBeUndefined();
    });
  });

  describe('FAKE_PROVIDER_MODE=fail — a non-zero exit', () => {
    it('is a failure, with stderr surfaced verbatim', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'fail');
      const request = await makeRequest();

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
      const request = await makeRequest();

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
      const request = await makeRequest();

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
      const response = await subprocessRunner().run(await makeRequest(), fakeDecl);

      // The reason is the payload, not the flag. A reader deciding whether to trust, cache, or
      // repair the artifact needs to know WHICH kind of impurity — so it must survive the
      // boundary intact rather than be flattened to a boolean.
      expect(response.impure).toEqual({
        reason: 'emits a per-run timestamp and random nonce; output varies by invocation',
      });
    });

    it('is still a success — impurity is declared, not forbidden', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'impure');
      const response = await subprocessRunner().run(await makeRequest(), fakeDecl);
      expect(response.outputs).toEqual([{ path: 'podcast.out' }]);
    });

    it('really does vary per run (the fixture is not lying about being impure)', async () => {
      vi.stubEnv('FAKE_PROVIDER_MODE', 'impure');
      const runner = subprocessRunner();
      const first = await makeRequest({ outputDir: path.join(work, 'imp-1') });
      const second = await makeRequest({ outputDir: path.join(work, 'imp-2') });
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
      await expect(subprocessRunner().run(await makeRequest(), { cmd: [missing] })).rejects.toThrow(
        new RegExp(`provider command not found: "${missing}"`)
      );
    });

    it('fails NAMING the command when the path does not exist', async () => {
      const missing = path.join(work, 'nope', 'not-here');
      await expect(subprocessRunner().run(await makeRequest(), { cmd: [missing] })).rejects.toThrow(
        missing
      );
    });

    it('fails NAMING the command when the file is not executable', async () => {
      const notExecutable = path.join(work, 'not-executable');
      await fs.writeFile(notExecutable, 'irrelevant\n', { mode: 0o644 });
      await expect(
        subprocessRunner().run(await makeRequest(), { cmd: [notExecutable] })
      ).rejects.toThrow(new RegExp(`not executable: "${notExecutable.replace(/\//g, '\\/')}"`));
    });

    it('never substitutes a default or skips the target — it only throws (FR-036)', async () => {
      // The negative half of the same rule: no code path turns an absent tool into a
      // no-op success. If this ever resolves, a target silently stopped being built.
      const request = await makeRequest();
      await expect(
        subprocessRunner().run(request, { cmd: [path.join(work, 'absent-tool')] })
      ).rejects.toThrow();
      await expect(fs.readdir(request.output_dir)).rejects.toThrow();
    });

    it('refuses a declaration with an empty cmd rather than spawning undefined', async () => {
      await expect(subprocessRunner().run(await makeRequest(), { cmd: [] })).rejects.toThrow(
        /empty `cmd`/
      );
    });
  });

  describe('stdout that is not a well-formed BuildResponse', () => {
    it('fails naming it as invalid JSON, and shows what was written', async () => {
      await expect(
        subprocessRunner().run(
          await makeRequest(),
          nodeDecl('process.stdout.write("this is not json")')
        )
      ).rejects.toThrow(/not valid JSON[\s\S]*this is not json/);
    });

    it('fails when stdout is empty despite exit 0', async () => {
      await expect(
        subprocessRunner().run(await makeRequest(), nodeDecl('process.exit(0)'))
      ).rejects.toThrow(/wrote nothing to stdout; expected a BuildResponse/);
    });

    it('fails naming the MISSING field when the shape is wrong', async () => {
      const script = 'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}]}))';
      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /malformed BuildResponse — tool:/
      );
    });

    it('refuses an unknown `version` rather than parsing it best-effort (FR-005)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:2,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"}}))';
      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /malformed BuildResponse — version:/
      );
    });

    it('refuses a BARE BOOLEAN `impure` — the reason is the point (FR-032)', async () => {
      // contracts/provider.md Rule 4 and the table both spell the transparent case as the
      // field being ABSENT. Accepting `impure: false` would re-admit the flag-shaped impurity
      // FR-032 forbids, and `impure: true` would follow one release later with nothing to say.
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"},impure:false}))';
      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /malformed BuildResponse — impure:/
      );
    });

    it('refuses `impure` with no reason (FR-032)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"a.out"}],tool:{name:"t",version:"1"},impure:{}}))';
      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /malformed BuildResponse — impure\.reason:/
      );
    });
  });

  describe('a declared output that does not exist on disk', () => {
    it('fails naming it (FR-033)', async () => {
      const script =
        'process.stdout.write(JSON.stringify({version:1,outputs:[{path:"never-written.mp3"}],tool:{name:"t",version:"1"}}))';
      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /declared 1 output\(s\) that do not exist[\s\S]*never-written\.mp3/
      );
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

      await expect(subprocessRunner().run(await makeRequest(), nodeDecl(script))).rejects.toThrow(
        /nested\/sneaky\.tmp/
      );
    });
  });

  // -------------------------------------------------------------------------
  // T056 — the provider runs BY HAND, with no production-control present
  // -------------------------------------------------------------------------

  describe('runnable by hand, with no production-control present (FR-031, SC-008)', () => {
    it('answers a BuildRequest piped straight to it — no runner involved', async () => {
      // Deliberately NOT through subprocessRunner. The claim under test is that the provider
      // needs nothing from us: pipe it JSON, get JSON back. If this fails, the boundary is
      // drawn wrong and every "just run it yourself" debugging story is a lie.
      const request = await makeRequest({ outputDir: path.join(work, 'by-hand') });
      const result = await pipeRequest(FAKE_PROVIDER, request);

      expect(result.code).toBe(0);

      // Asserted structurally rather than through our own schema: validating with
      // production-control's parser would beg the question this test asks.
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toEqual({
        version: 1,
        outputs: [{ path: 'podcast.out' }],
        tool: { name: 'fake-provider', version: '1.0.0' },
        validation: { state: 'passed' },
      });

      const produced = await fs.readFile(path.join(request.output_dir, 'podcast.out'), 'utf8');
      expect(produced).toBe(expectedContent(request, 'podcast'));
    });

    it('needs no network and no craft tools — only local inputs (FR-030, SC-007)', async () => {
      const request = await makeRequest({ outputDir: path.join(work, 'local-only') });
      // Every input is an absolute local path that exists before the provider is invoked.
      for (const input of Object.values(request.inputs)) {
        expect(path.isAbsolute(input.path)).toBe(true);
        await expect(fs.stat(input.path)).resolves.toBeDefined();
      }
      const result = await pipeRequest(FAKE_PROVIDER, request);
      expect(result.code).toBe(0);
    });

    it('is DETERMINISTIC: the same request twice yields byte-identical outputs', async () => {
      // This is what lets every downstream test assert exact hashes. Two DIFFERENT output dirs
      // for the same inputs: if output_dir (or a clock, or a pid) leaked into the bytes, these
      // would differ and every hash assertion downstream would be built on sand.
      const first = await makeRequest({ outputDir: path.join(work, 'det-1') });
      const second = await makeRequest({ outputDir: path.join(work, 'det-2') });

      expect((await pipeRequest(FAKE_PROVIDER, first)).code).toBe(0);
      expect((await pipeRequest(FAKE_PROVIDER, second)).code).toBe(0);

      const pathA = path.join(first.output_dir, 'podcast.out');
      const pathB = path.join(second.output_dir, 'podcast.out');
      const bytesA = await fs.readFile(pathA);
      const bytesB = await fs.readFile(pathB);

      expect(bytesA.equals(bytesB)).toBe(true);
      expect(await hashFile(pathA)).toBe(await hashFile(pathB));
    });

    it('surfaces its own diagnostic on stderr and a non-zero exit, by hand', async () => {
      const request = await makeRequest({ outputDir: path.join(work, 'by-hand-fail') });
      const result = await pipeRequest(FAKE_PROVIDER, request, { FAKE_PROVIDER_MODE: 'fail' });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('simulated failure');
      expect(result.stdout).toBe('');
    });

    it('rejects a malformed BuildRequest on its own, naming the field', async () => {
      // The contract is a real boundary in BOTH directions: the provider validates what it is
      // handed rather than trusting production-control to have been careful.
      const child = childProcess.spawn(FAKE_PROVIDER, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const stderr: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ version: 99, target: 'podcast' }));

      const code = await new Promise<number | null>((resolve) => {
        child.on('close', (value: number | null) => resolve(value));
      });

      expect(code).toBe(1);
      expect(Buffer.concat(stderr).toString('utf8')).toContain('BuildRequest.version must be 1');
    });
  });
});

/**
 * AUDIT-20260716-07 / -15 / -16 — a provider-declared output path is RELATIVE to `output_dir`,
 * and the schema now ENFORCES that rather than only asserting it in a message.
 *
 * This is the wire boundary both the runner (which resolves `path.resolve(output_dir, path)`) and
 * `ingest` (which composes `path.join(episodeDir, 'dist', path)`) trust. Refusing a traversing
 * path HERE — where `parseBuildResponse` runs before either resolves anything — means an absolute
 * or `..`-escaping output can never reach the filesystem composition in the first place. The
 * refusal names the offending field (FR-036).
 */
describe('contract: a declared output path cannot escape output_dir (BuildOutputSchema)', () => {
  it('accepts an ordinary relative output path', () => {
    expect(BuildOutputSchema.safeParse({ path: 'podcast.out' }).success).toBe(true);
    expect(BuildOutputSchema.safeParse({ path: 'sub/dir/podcast.out' }).success).toBe(true);
  });

  it('refuses a "../"-escaping output path, naming `path`', () => {
    const result = BuildOutputSchema.safeParse({ path: '../../../.ssh/authorized_keys' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('path'))).toBe(true);
    }
  });

  it('refuses an absolute output path', () => {
    expect(BuildOutputSchema.safeParse({ path: '/etc/cron.d/evil' }).success).toBe(false);
  });

  it('refuses a whitespace-only `impure.reason`, exactly as a waiver reason is (AUDIT-20260716-17)', () => {
    // `.min(1)` would let "   " through: three spaces state no more than the empty string does.
    // FR-032 wants WHICH kind of impurity, and the ledger's waiver reason already refuses a
    // whitespace-only decision by trimming — the two must behave identically, so this must refuse.
    const whitespaceReason = {
      version: 1,
      outputs: [{ path: 'a.out' }],
      tool: { name: 't', version: '1' },
      impure: { reason: '   ' },
    };
    let message = '';
    try {
      parseBuildResponse(whitespaceReason);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Names the offending field (FR-036), the same shape the empty-object case reports.
    expect(message).toContain('impure.reason');

    // Non-vacuity: a real reason still parses, so the refinement is not blanket-rejecting.
    const realReason = { ...whitespaceReason, impure: { reason: 'model call; non-deterministic' } };
    expect(() => parseBuildResponse(realReason)).not.toThrow();
  });

  it('a whole BuildResponse carrying a traversing output is refused by parseBuildResponse', () => {
    // The runner parses the provider's stdout through this same function BEFORE it resolves any
    // output path against output_dir, so the escape is refused before it can be walked (finding 07).
    const escaping = {
      version: 1,
      outputs: [{ path: '../escaped.txt' }],
      tool: { name: 'evil', version: '1.0.0' },
    };
    let message = '';
    try {
      parseBuildResponse(escaping);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('outputs');
    expect(message).toContain('path');
  });
});

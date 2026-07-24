import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import { BuildOutputSchema, parseBuildResponse } from '@/providers/contract.js';
import { makeRequest, pipeRequest, expectedContent, FAKE_PROVIDER } from './provider-support.js';

/**
 * The provider contract (contracts/provider.md) exercised with NO production-control present
 * (T056), plus the wire-boundary schema that refuses a traversing declared output path.
 */
describe('contract: the producing tool (provider) — by hand', () => {
  let work: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-provider-'));
  });

  afterEach(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T056 — the provider runs BY HAND, with no production-control present
  // -------------------------------------------------------------------------

  describe('runnable by hand, with no production-control present (FR-031, SC-008)', () => {
    it('answers a BuildRequest piped straight to it — no runner involved', async () => {
      // Deliberately NOT through subprocessRunner. The claim under test is that the provider
      // needs nothing from us: pipe it JSON, get JSON back. If this fails, the boundary is
      // drawn wrong and every "just run it yourself" debugging story is a lie.
      const request = await makeRequest(work, { outputDir: path.join(work, 'by-hand') });
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
      const request = await makeRequest(work, { outputDir: path.join(work, 'local-only') });
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
      const first = await makeRequest(work, { outputDir: path.join(work, 'det-1') });
      const second = await makeRequest(work, { outputDir: path.join(work, 'det-2') });

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
      const request = await makeRequest(work, { outputDir: path.join(work, 'by-hand-fail') });
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

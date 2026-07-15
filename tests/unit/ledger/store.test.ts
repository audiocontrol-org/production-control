import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readLedger, writeLedger, emptyLedger } from '@/ledger/store.js';
import type { ArtifactRecord, Ledger, Waiver } from '@/ledger/schema.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const ISO_AT = '2024-01-01T00:00:00Z';

function artifactRecord(seed: string): ArtifactRecord {
  return {
    producer: { tool: `tool-${seed}`, version: '1.0.0' },
    inputs: { [`input-${seed}`]: HASH_A },
    output: { path: `dist/${seed}.out`, hash: HASH_B },
    built_at: ISO_AT,
  };
}

function waiver(seed: string): Waiver {
  return {
    waived_hash: HASH_A,
    reason: `waived because ${seed}`,
    at: ISO_AT,
  };
}

function ledgerPathFor(episodeDir: string): string {
  return path.join(episodeDir, '.production', 'ledger.yaml');
}

describe('ledger/store', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  async function makeTempEpisodeDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-ledger-store-test-'));
    tempDirs.push(dir);
    return dir;
  }

  it('emptyLedger returns { version: 1, artifacts: {}, reviews: {} }', () => {
    expect(emptyLedger()).toEqual({ version: 1, artifacts: {}, reviews: {} });
  });

  it('returns the empty ledger and does not throw when the episode has never been built', async () => {
    const dir = await makeTempEpisodeDir();
    const ledger = await readLedger(dir);
    expect(ledger).toEqual(emptyLedger());
  });

  it('round-trips: writeLedger then readLedger returns an equal value', async () => {
    const dir = await makeTempEpisodeDir();
    const ledger: Ledger = {
      version: 1,
      artifacts: { narration: artifactRecord('narration') },
      reviews: { spoken: waiver('spoken') },
    };

    await writeLedger(dir, ledger);
    const readBack = await readLedger(dir);
    expect(readBack).toEqual(ledger);
  });

  it('throws naming the path when ledger.yaml is malformed YAML', async () => {
    const dir = await makeTempEpisodeDir();
    const ledgerPath = ledgerPathFor(dir);
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(ledgerPath, 'version: 1\nartifacts: [unterminated\n', 'utf8');

    await expect(readLedger(dir)).rejects.toThrow(ledgerPath);
  });

  it('throws naming the path and "version" when ledger.yaml declares version: 2', async () => {
    const dir = await makeTempEpisodeDir();
    const ledgerPath = ledgerPathFor(dir);
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(
      ledgerPath,
      ['version: 2', 'artifacts: {}', 'reviews: {}', ''].join('\n'),
      'utf8'
    );

    try {
      await readLedger(dir);
      expect.unreachable('expected readLedger to throw on version: 2');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(ledgerPath);
      expect(message).toContain('version');
    }
  });

  it('writes byte-identical files regardless of key insertion order (determinism)', async () => {
    const dirA = await makeTempEpisodeDir();
    const dirB = await makeTempEpisodeDir();

    const ledgerKeysAscending: Ledger = {
      version: 1,
      artifacts: {
        alpha: artifactRecord('alpha'),
        beta: artifactRecord('beta'),
      },
      reviews: {
        one: waiver('one'),
        two: waiver('two'),
      },
    };

    const ledgerKeysDescending: Ledger = {
      version: 1,
      reviews: {
        two: waiver('two'),
        one: waiver('one'),
      },
      artifacts: {
        beta: artifactRecord('beta'),
        alpha: artifactRecord('alpha'),
      },
    };

    await writeLedger(dirA, ledgerKeysAscending);
    await writeLedger(dirB, ledgerKeysDescending);

    const bytesA = await fs.readFile(ledgerPathFor(dirA), 'utf8');
    const bytesB = await fs.readFile(ledgerPathFor(dirB), 'utf8');
    expect(bytesA).toBe(bytesB);
  });

  it('refuses to write an invalid ledger (bad hash format) rather than writing it', async () => {
    const dir = await makeTempEpisodeDir();
    const invalidLedger: Ledger = {
      version: 1,
      artifacts: {
        narration: {
          producer: { tool: 'tool', version: '1.0.0' },
          inputs: {},
          output: { path: 'dist/narration.out', hash: 'not-a-valid-hash' },
          built_at: ISO_AT,
        },
      },
      reviews: {},
    };

    await expect(writeLedger(dir, invalidLedger)).rejects.toThrow();

    const exists = await fs
      .access(ledgerPathFor(dir))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

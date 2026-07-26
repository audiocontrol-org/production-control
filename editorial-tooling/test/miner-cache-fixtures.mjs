// Shared fixtures and helpers for miner-cache tests.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION, entryFileName } from '../src/cache.mjs';

/** A fresh temp directory; node's test runner leaves them for post-mortem on failure. */
export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The one quotable line source `i` contains. */
export function lineFor(index) {
  return `Line number ${index} is quotable.`;
}

/** `count` sources, each with an id, a path (the batch seam needs one) and its own line. */
export function makeSources(count) {
  const sources = [];
  for (let i = 0; i < count; i++) {
    sources.push({
      id: `s-${i}`,
      path: `/corpus/s-${i}.txt`,
      bytes: Buffer.from(`${lineFor(i)}\n`, 'utf8'),
    });
  }
  return sources;
}

/** A per-source fake that RECORDS every source id it was asked about. */
export function countingModel({ id = 'fake-model', failOn = null, candidatesFor = null } = {}) {
  const asked = [];
  return {
    id,
    asked,
    resolvedId() {
      return id;
    },
    async select(sourceId) {
      asked.push(sourceId);
      if (failOn !== null && failOn === sourceId) {
        throw new Error(`fake model: refusing source '${sourceId}'`);
      }
      const index = Number(sourceId.slice('s-'.length));
      return candidatesFor === null ? [lineFor(index)] : candidatesFor(index);
    },
  };
}

/** A batch fake that RECORDS the chunks (as id arrays) it was actually dispatched. */
export function countingBatchModel({ id = 'fake-batch-model' } = {}) {
  const chunks = [];
  return {
    id,
    chunks,
    resolvedId() {
      return id;
    },
    async selectBatch(sources) {
      chunks.push(sources.map((s) => s.id));
      const answer = new Map();
      for (const source of sources) {
        answer.set(source.id, [lineFor(Number(source.id.slice('s-'.length)))]);
      }
      return answer;
    },
  };
}

/** Seed a cache entry by hand, exactly where the cache would look for it. */
export function seedEntry(dir, source, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, entryFileName(source.bytes)), JSON.stringify(entry), 'utf8');
}

/** Every regular file in `dir` (recursively), relative to it. */
export function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

// Export PROTOCOL_VERSION for use in tests
export { PROTOCOL_VERSION };

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/**
 * Resolve a fixture path relative to test/fixtures directory.
 * @param segments Path segments to join under test/fixtures/
 * @returns Absolute path to the fixture
 */
export function fixturePath(...segments: string[]): string {
  const currentFile = fileURLToPath(import.meta.url);
  const testDir = path.dirname(currentFile);
  return path.join(testDir, 'fixtures', ...segments);
}

/**
 * Read a fixture file relative to test/fixtures directory.
 * @param segments Path segments to join under test/fixtures/
 * @returns File contents as a string
 */
export function readFixture(...segments: string[]): string {
  const filePath = fixturePath(...segments);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Create a temporary directory, run a function with its path, and clean it up.
 * @param fn Function to run with the temp directory path; can be async
 */
export async function withTempDir(
  fn: (dir: string) => void | Promise<void>,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-tooling-'));
  try {
    await fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

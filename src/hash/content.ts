import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export type Hash = string;

export function hashBytes(bytes: Buffer): Hash {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `sha256:${digest}`;
}

export async function hashFile(filePath: string): Promise<Hash> {
  const hasher = createHash('sha256');
  try {
    await pipeline(createReadStream(filePath), hasher);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to hash file at path "${filePath}": ${message}`, { cause: error });
  }
  return `sha256:${hasher.digest('hex')}`;
}

import { hashBytes, type Hash } from '@/hash/content.js';

export interface AssetStore {
  /** Store bytes under their own content address. Returns the address. Idempotent. */
  put(bytes: Buffer): Promise<Hash>;
  /** Retrieve bytes by content address. Rejects (naming the address) if absent. */
  get(address: Hash): Promise<Buffer>;
  /** Whether the address exists in the store. */
  has(address: Hash): Promise<boolean>;
}

/**
 * In-memory implementation of AssetStore for testing.
 * Content-addressed, idempotent, and immutable.
 */
export class MemoryAssetStore implements AssetStore {
  private store: Map<Hash, Buffer> = new Map();

  private unreachable: boolean = false;

  async put(bytes: Buffer): Promise<Hash> {
    await Promise.resolve();

    if (this.unreachable) {
      throw new Error('Asset store is unreachable');
    }

    const address = hashBytes(bytes);

    // Idempotent: only store if not already present
    if (!this.store.has(address)) {
      // Store immutable copy
      this.store.set(address, Buffer.from(bytes));
    }

    return address;
  }

  async get(address: Hash): Promise<Buffer> {
    await Promise.resolve();

    if (this.unreachable) {
      throw new Error('Asset store is unreachable');
    }

    const bytes = this.store.get(address);

    if (bytes === undefined) {
      throw new Error(`Asset not found at address: ${address}`);
    }

    // Return a copy to prevent external mutation
    return Buffer.from(bytes);
  }

  async has(address: Hash): Promise<boolean> {
    await Promise.resolve();

    if (this.unreachable) {
      throw new Error('Asset store is unreachable');
    }

    return this.store.has(address);
  }

  /**
   * Returns the count of distinct stored objects.
   * Exposed for testing dedupe behavior.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Simulate store being unreachable for testing error handling.
   * When true, all operations (get, put, has) will reject.
   */
  setUnreachable(unreachable: boolean): void {
    this.unreachable = unreachable;
  }
}

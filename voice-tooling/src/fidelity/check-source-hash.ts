import { createHash } from 'node:crypto';

/**
 * Result of the `source_hash` pre-check (contract step 1, FR-017, SC-003,
 * D15): the ledger's declared `source.hash` MUST equal the hash of the
 * supplied source bytes, checked FIRST — before any unit obligation is
 * evaluated. A mismatch means the ledger was written against a different
 * source version, invalidating every downstream disposition it makes.
 */
export interface SourceHashCheckResult {
  ok: boolean;
  failure?: string;
}

/**
 * Compute `sha256:<64 lowercase hex>` over the supplied source bytes (a
 * string's UTF-8 bytes, or raw bytes as given) and compare against the
 * ledger's declared `source.hash`. The ledger value is normalized so a bare
 * 64-hex value or an already `sha256:`-prefixed value both compare correctly
 * -- the ledger schema always carries the prefix (`schema/ledger.ts`), but
 * this check does not assume that upstream validation ran first.
 *
 * Pure, deterministic, no I/O, no network.
 */
export function checkSourceHash(
  sourceBytes: string | Uint8Array,
  ledgerSourceHash: string,
): SourceHashCheckResult {
  const bytes =
    typeof sourceBytes === 'string' ? Buffer.from(sourceBytes, 'utf8') : sourceBytes;
  const computedHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const normalizedLedgerHash = normalizeHash(ledgerSourceHash);

  if (computedHash !== normalizedLedgerHash) {
    return {
      ok: false,
      failure: `source hash: ledger source.hash ${normalizedLedgerHash} does not match supplied source hash ${computedHash}`,
    };
  }
  return { ok: true };
}

/** Ensure a hash value carries the `sha256:` prefix, without double-prefixing. */
function normalizeHash(hash: string): string {
  return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
}

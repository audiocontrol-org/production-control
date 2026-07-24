import { describe, it, expect } from 'vitest';
import { HashSchema, EpisodeManifestSchema, ProviderDeclSchema } from '@/manifest/schema.js';
import { WaiverSchema, ArtifactRecordSchema, LedgerSchema } from '@/ledger/schema.js';
import { AssetPointerSchema } from '@/assets/pointer.js';

describe('schema validation (RED tests)', () => {
  describe('HashSchema', () => {
    // Case 5: HashSchema refuses malformed hashes
    it('Case 5a: accepts well-formed sha256 hash', () => {
      const validHash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = HashSchema.safeParse(validHash);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(validHash);
      }
    });

    it('Case 5b: refuses hash with no prefix', () => {
      const malformedHash: unknown =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5c: refuses hash with wrong prefix (md5:)', () => {
      const malformedHash: unknown =
        'md5:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5d: refuses uppercase hex', () => {
      const malformedHash: unknown =
        'sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5e: refuses wrong length (63 chars)', () => {
      const malformedHash: unknown =
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5f: refuses wrong length (65 chars)', () => {
      const malformedHash: unknown =
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8550';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5g: refuses non-hex characters', () => {
      const malformedHash: unknown =
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852bGHI';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });
  });

  describe('WaiverSchema', () => {
    // Case 6: WaiverSchema refuses empty or whitespace-only reason
    it('Case 6a: accepts waiver with valid reason', () => {
      const waiver = {
        waived_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        reason: 'This change is acceptable',
        at: '2026-01-01T00:00:00Z',
      };

      const result = WaiverSchema.safeParse(waiver);
      expect(result.success).toBe(true);
    });

    it('Case 6b: refuses empty reason', () => {
      const waiver: unknown = {
        waived_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        reason: '',
        at: '2026-01-01T00:00:00Z',
      };

      const result = WaiverSchema.safeParse(waiver);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('reason'))).toBe(true);
      }
    });

    it('Case 6c: refuses whitespace-only reason', () => {
      const waiver: unknown = {
        waived_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        reason: '   ',
        at: '2026-01-01T00:00:00Z',
      };

      const result = WaiverSchema.safeParse(waiver);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('reason'))).toBe(true);
      }
    });
  });

  describe('ArtifactRecordSchema', () => {
    // Case 8: validation absent parses; validation with passed/failed parses; validation with invalid state refused
    it('Case 8a: parses without validation (not yet validated)', () => {
      const record = {
        producer: {
          tool: 'tts',
          version: '1.0.0',
        },
        inputs: {
          spoken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        output: {
          path: 'dist/narration.mp3',
          hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        built_at: '2026-01-01T00:00:00Z',
      };

      const result = ArtifactRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('Case 8b: parses with validation passed', () => {
      const record = {
        producer: {
          tool: 'tts',
          version: '1.0.0',
        },
        inputs: {
          spoken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        output: {
          path: 'dist/narration.mp3',
          hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        built_at: '2026-01-01T00:00:00Z',
        validation: {
          state: 'passed',
          at: '2026-01-02T00:00:00Z',
        },
      };

      const result = ArtifactRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('Case 8c: parses with validation failed', () => {
      const record = {
        producer: {
          tool: 'tts',
          version: '1.0.0',
        },
        inputs: {
          spoken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        output: {
          path: 'dist/narration.mp3',
          hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        built_at: '2026-01-01T00:00:00Z',
        validation: {
          state: 'failed',
          at: '2026-01-02T00:00:00Z',
        },
      };

      const result = ArtifactRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('Case 8d: refuses validation with invalid state', () => {
      const record: unknown = {
        producer: {
          tool: 'tts',
          version: '1.0.0',
        },
        inputs: {
          spoken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        output: {
          path: 'dist/narration.mp3',
          hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        built_at: '2026-01-01T00:00:00Z',
        validation: {
          state: 'maybe',
          at: '2026-01-02T00:00:00Z',
        },
      };

      const result = ArtifactRecordSchema.safeParse(record);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) =>
              issue.path.join('.').includes('validation') || issue.path.join('.').includes('state')
          )
        ).toBe(true);
      }
    });
  });

  describe('AssetPointerSchema', () => {
    // Case 9: well-formed parses; malformed asset hash refused; bytes must be non-negative integer
    it('Case 9a: parses well-formed asset pointer', () => {
      const pointer = {
        asset: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        media: 'audio/mpeg',
        bytes: 1024000,
      };

      const result = AssetPointerSchema.safeParse(pointer);
      expect(result.success).toBe(true);
    });

    it('Case 9b: refuses malformed asset hash', () => {
      const pointer: unknown = {
        asset: 'md5:notahash',
        media: 'audio/mpeg',
        bytes: 1024000,
      };

      const result = AssetPointerSchema.safeParse(pointer);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('asset'))).toBe(true);
      }
    });

    it('Case 9c: refuses negative bytes', () => {
      const pointer: unknown = {
        asset: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        media: 'audio/mpeg',
        bytes: -1024,
      };

      const result = AssetPointerSchema.safeParse(pointer);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('bytes'))).toBe(true);
      }
    });

    it('Case 9d: accepts zero bytes', () => {
      const pointer = {
        asset: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        media: 'application/empty',
        bytes: 0,
      };

      const result = AssetPointerSchema.safeParse(pointer);
      expect(result.success).toBe(true);
    });
  });

  describe('Error path assertions', () => {
    // Case 10: Every refusal produces an error that NAMES the offending field/path
    it('Case 10a: error on unknown manifest version names version field', () => {
      const manifest: unknown = {
        version: 'unknown',
        id: 'ep-001',
        title: 'Title',
        profile: 'default',
        authored: {},
        targets: [],
      };

      const result = EpisodeManifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
      if (!result.success) {
        const versionError = result.error.issues.find((issue) => issue.path.includes('version'));
        expect(versionError).toBeDefined();
      }
    });

    it('Case 10b: error on malformed hash names the hash field', () => {
      const pointer: unknown = {
        asset: 'invalid',
        media: 'type',
        bytes: 100,
      };

      const result = AssetPointerSchema.safeParse(pointer);
      expect(result.success).toBe(false);
      if (!result.success) {
        const assetError = result.error.issues.find((issue) => issue.path.includes('asset'));
        expect(assetError).toBeDefined();
      }
    });

    it('Case 10c: error on empty waiver reason names reason field', () => {
      const waiver: unknown = {
        waived_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        reason: '',
        at: '2026-01-01T00:00:00Z',
      };

      const result = WaiverSchema.safeParse(waiver);
      expect(result.success).toBe(false);
      if (!result.success) {
        const reasonError = result.error.issues.find((issue) => issue.path.includes('reason'));
        expect(reasonError).toBeDefined();
      }
    });

    it('Case 10d: error on invalid provider impure names impure field', () => {
      const provider: unknown = {
        cmd: ['cmd'],
        impure: 'not-an-object',
      };

      const result = ProviderDeclSchema.safeParse(provider);
      expect(result.success).toBe(false);
      if (!result.success) {
        const impureError = result.error.issues.find((issue) => issue.path.includes('impure'));
        expect(impureError).toBeDefined();
      }
    });
  });

  describe('LedgerSchema', () => {
    it('should parse a well-formed ledger', () => {
      const ledger = {
        version: 1,
        artifacts: {
          narration: {
            producer: {
              tool: 'tts',
              version: '1.0.0',
            },
            inputs: {
              spoken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
            output: {
              path: 'dist/narration.mp3',
              hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            },
            built_at: '2026-01-01T00:00:00Z',
          },
        },
        reviews: {
          spoken: {
            waived_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            reason: 'reviewed and approved',
            at: '2026-01-01T12:00:00Z',
          },
        },
      };

      const result = LedgerSchema.safeParse(ledger);
      expect(result.success).toBe(true);
    });

    it('should refuse ledger with version 2', () => {
      const ledger: unknown = {
        version: 2,
        artifacts: {},
        reviews: {},
      };

      const result = LedgerSchema.safeParse(ledger);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('version'))).toBe(true);
      }
    });
  });
});

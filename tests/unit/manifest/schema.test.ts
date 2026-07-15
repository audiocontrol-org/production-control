import { describe, it, expect } from 'vitest';
import {
  HashSchema,
  AuthoredDeclSchema,
  ProviderDeclSchema,
  TargetDeclSchema,
  EpisodeManifestSchema,
  ProfileSchema,
} from '@/manifest/schema.js';
import { WaiverSchema, ArtifactRecordSchema, LedgerSchema } from '@/ledger/schema.js';
import { AssetPointerSchema } from '@/assets/pointer.js';

describe('schema validation (RED tests)', () => {
  describe('EpisodeManifest', () => {
    // Case 1: A well-formed episode manifest PARSES and yields the right typed value
    it('Case 1: parses a well-formed episode manifest', () => {
      const manifest = {
        version: 1,
        id: 'ep-001',
        title: 'Episode One',
        profile: 'default',
        authored: {
          spoken: {
            path: 'content/spoken.md',
          },
        },
        targets: ['narration'],
      };

      const result = EpisodeManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
        expect(result.data.id).toBe('ep-001');
        expect(result.data.title).toBe('Episode One');
      }
    });

    // Case 2: Unknown version is REFUSED, not best-effort parsed
    it('Case 2a: refuses version 2', () => {
      const manifest = {
        version: 2,
        id: 'ep-001',
        title: 'Episode One',
        profile: 'default',
        authored: {},
        targets: [],
      };

      const result = EpisodeManifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('version'))).toBe(true);
      }
    });

    it('Case 2b: refuses missing version', () => {
      const manifest = {
        id: 'ep-001',
        title: 'Episode One',
        profile: 'default',
        authored: {},
        targets: [],
      };

      const result = EpisodeManifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('version'))).toBe(true);
      }
    });
  });

  describe('Profile', () => {
    // Case 3: A well-formed profile parses; a profile with version 2 is refused
    it('Case 3a: parses a well-formed profile', () => {
      const profile = {
        version: 1,
        targets: {
          narration: {
            inputs: ['spoken'],
            provider: {
              cmd: ['tts', 'generate'],
            },
          },
        },
      };

      const result = ProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });

    it('Case 3b: refuses profile with version 2', () => {
      const profile = {
        version: 2,
        targets: {},
      };

      const result = ProfileSchema.safeParse(profile);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('version'))).toBe(true);
      }
    });
  });

  describe('AuthoredDecl', () => {
    // Case 4: AuthoredDecl without follows parses; with follows parses
    it('Case 4a: parses without follows', () => {
      const decl = {
        path: 'content/spoken.md',
      };

      const result = AuthoredDeclSchema.safeParse(decl);
      expect(result.success).toBe(true);
    });

    it('Case 4b: parses with follows', () => {
      const decl = {
        path: 'content/narration.md',
        follows: 'spoken',
      };

      const result = AuthoredDeclSchema.safeParse(decl);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.follows).toBe('spoken');
      }
    });
  });

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
      const malformedHash: unknown = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5c: refuses hash with wrong prefix (md5:)', () => {
      const malformedHash: unknown = 'md5:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5d: refuses uppercase hex', () => {
      const malformedHash: unknown = 'sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
      const result = HashSchema.safeParse(malformedHash);
      expect(result.success).toBe(false);
    });

    it('Case 5e: refuses wrong length (63 chars)', () => {
      const malformedHash: unknown = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85';
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
      const malformedHash: unknown = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852bGHI';
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

  describe('ProviderDeclSchema', () => {
    // Case 7: impure absent parses; with reason parses; bare boolean is REFUSED
    it('Case 7a: parses without impure (transparent)', () => {
      const provider = {
        cmd: ['tts', 'generate'],
      };

      const result = ProviderDeclSchema.safeParse(provider);
      expect(result.success).toBe(true);
    });

    it('Case 7b: parses with impure reason', () => {
      const provider = {
        cmd: ['model', 'inference'],
        impure: {
          reason: 'calls a language model',
        },
      };

      const result = ProviderDeclSchema.safeParse(provider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.impure?.reason).toBe('calls a language model');
      }
    });

    it('Case 7c: refuses impure as bare boolean', () => {
      const provider: unknown = {
        cmd: ['model', 'inference'],
        impure: true,
      };

      const result = ProviderDeclSchema.safeParse(provider);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('impure'))).toBe(true);
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
          result.error.issues.some((issue) =>
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

  describe('TargetDeclSchema', () => {
    it('should parse a well-formed target declaration', () => {
      const target = {
        inputs: ['spoken'],
        provider: {
          cmd: ['tts', 'generate'],
        },
      };

      const result = TargetDeclSchema.safeParse(target);
      expect(result.success).toBe(true);
    });

    it('should parse with impure provider', () => {
      const target = {
        inputs: ['spoken'],
        provider: {
          cmd: ['model', 'generate'],
          impure: {
            reason: 'model is non-deterministic',
          },
        },
      };

      const result = TargetDeclSchema.safeParse(target);
      expect(result.success).toBe(true);
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

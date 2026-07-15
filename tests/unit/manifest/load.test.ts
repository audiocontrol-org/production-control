import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEpisode, loadProfile } from '@/manifest/load.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const PROFILES_DIR = path.join(ROOT, 'profiles');

describe('manifest/load', () => {
  describe('loadEpisode — real fixtures', () => {
    it('loads the minimal fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'minimal'));
      expect(manifest.version).toBe(1);
      expect(manifest.id).toBe('minimal');
      expect(manifest.profile).toBe('editorial-audio');
      expect(manifest.authored.longform?.path).toBe('article.mdx');
      expect(manifest.targets).toEqual(['epub']);
    });

    it('loads the blocked fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'blocked'));
      expect(manifest.id).toBe('blocked');
      expect(manifest.authored.narration?.path).toBe('assets/narration/take-01.wav');
      expect(manifest.targets).toEqual(['epub', 'voiceover']);
    });

    it('loads the chain fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'chain'));
      expect(manifest.id).toBe('chain');
      expect(manifest.authored.narration?.path).toBe('assets/narration/take-01.wav');
      expect(manifest.authored.spoken?.path).toBe('script.md');
      expect(manifest.targets).toEqual(['voiceover', 'podcast']);
    });

    it('loads the advisory fixture and preserves the follows edge', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'advisory'));
      expect(manifest.id).toBe('advisory');
      expect(manifest.authored.narration?.follows).toBe('spoken');
      expect(manifest.targets).toEqual(['voiceover']);
    });

    it('loads the dual-signal fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'dual-signal'));
      expect(manifest.id).toBe('dual-signal');
      expect(manifest.authored.narration?.follows).toBe('spoken');
      expect(manifest.targets).toEqual(['transcript']);
    });

    it('loads the tree-output fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'tree-output'));
      expect(manifest.id).toBe('tree-output');
      expect(manifest.authored.assets?.path).toBe('assets');
      expect(manifest.targets).toEqual(['website']);
    });

    it('loads the asset fixture', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'asset'));
      expect(manifest.id).toBe('asset');
      expect(manifest.authored.narration?.path).toBe('assets/narration/take-01.wav');
      expect(manifest.targets).toEqual(['voiceover']);
    });

    it('loads the cycle fixture episode (the cycle itself is a graph violation, not a schema one)', async () => {
      const manifest = await loadEpisode(path.join(FIXTURES, 'cycle'));
      expect(manifest.id).toBe('cycle');
      expect(manifest.profile).toBe('profile-cycle');
    });

    it('throws naming the path when the episode dir does not exist', async () => {
      const missingDir = path.join(FIXTURES, 'does-not-exist');
      await expect(loadEpisode(missingDir)).rejects.toThrow(path.join(missingDir, 'episode.yaml'));
    });
  });

  describe('loadProfile — real fixtures and repo profiles', () => {
    it('loads profiles/editorial-audio.yaml, and podcast depends on voiceover (not narration)', async () => {
      const profile = await loadProfile('editorial-audio', [PROFILES_DIR]);
      expect(profile.version).toBe(1);
      expect(profile.targets.podcast?.inputs).toEqual(['voiceover']);
      expect(profile.targets.voiceover?.inputs).toEqual(['narration']);
    });

    it("resolves the cycle fixture's own profile-cycle.yaml via the search-dir mechanism, and loading SUCCEEDS (the cycle is a graph violation caught later by validateGraph, not a schema violation)", async () => {
      const cycleDir = path.join(FIXTURES, 'cycle');
      const profile = await loadProfile('profile-cycle', [cycleDir, PROFILES_DIR]);
      expect(profile.version).toBe(1);
      expect(profile.targets.a?.inputs).toEqual(['b']);
      expect(profile.targets.b?.inputs).toEqual(['c']);
      expect(profile.targets.c?.inputs).toEqual(['a']);
    });

    it('throws naming the profile and every directory searched when unresolvable', async () => {
      const dirA = path.join(FIXTURES, 'minimal');
      const dirB = path.join(FIXTURES, 'blocked');
      await expect(loadProfile('no-such-profile', [dirA, dirB])).rejects.toThrow(/no-such-profile/);
      try {
        await loadProfile('no-such-profile', [dirA, dirB]);
        expect.unreachable('expected loadProfile to throw');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain('no-such-profile');
        expect(message).toContain(dirA);
        expect(message).toContain(dirB);
      }
    });
  });

  describe('malformed inputs on disk', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      await Promise.all(
        tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
      );
    });

    async function makeTempEpisodeDir(episodeYaml: string): Promise<string> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-load-test-'));
      tempDirs.push(dir);
      await fs.writeFile(path.join(dir, 'episode.yaml'), episodeYaml, 'utf8');
      return dir;
    }

    it('throws naming the path when episode.yaml is malformed YAML', async () => {
      const dir = await makeTempEpisodeDir('version: 1\nid: [unterminated\n');
      const manifestPath = path.join(dir, 'episode.yaml');
      await expect(loadEpisode(dir)).rejects.toThrow(manifestPath);
    });

    it('throws naming "version" when episode.yaml declares version: 2', async () => {
      const dir = await makeTempEpisodeDir(
        [
          'version: 2',
          'id: bad-version',
          'title: Bad Version',
          'profile: editorial-audio',
          'authored: {}',
          'targets: []',
          '',
        ].join('\n')
      );
      const manifestPath = path.join(dir, 'episode.yaml');
      try {
        await loadEpisode(dir);
        expect.unreachable('expected loadEpisode to throw on version: 2');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain(manifestPath);
        expect(message).toContain('version');
      }
    });
  });
});

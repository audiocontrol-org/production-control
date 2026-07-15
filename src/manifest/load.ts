import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { ZodError } from 'zod';
import {
  EpisodeManifestSchema,
  ProfileSchema,
  type EpisodeManifest,
  type Profile,
} from '@/manifest/schema.js';

/**
 * Reads and parses `<episodeDir>/episode.yaml` through `EpisodeManifestSchema`.
 * Returns the schema's parsed (typed) output — never the raw YAML object.
 *
 * Every failure throws, naming the file path (FR-036, constitution Principle V):
 *   - the file does not exist
 *   - the YAML is malformed (parser's message included)
 *   - the schema rejects it (offending field named via the zod issue's `path`)
 */
export async function loadEpisode(episodeDir: string): Promise<EpisodeManifest> {
  const manifestPath = path.join(episodeDir, 'episode.yaml');
  const text = await readFileIfExists(manifestPath);
  if (text === null) {
    throw new Error(`Episode manifest not found: ${manifestPath}`);
  }

  const raw = parseYaml(manifestPath, text);
  const result = EpisodeManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatSchemaError(manifestPath, result.error));
  }
  return result.data;
}

/**
 * Resolves `<name>.yaml` by searching `searchDirs` in order — first match wins.
 * This lets a fixture (or any episode) carry its own profile beside its
 * episode.yaml, while normal episodes resolve shared profiles from the
 * repo's `profiles/` directory.
 *
 * Returns the schema's parsed (typed) output — never the raw YAML object.
 *
 * Every failure throws, naming the file path:
 *   - a candidate exists but its YAML is malformed
 *   - a candidate exists but the schema rejects it (offending field named)
 *   - no candidate exists in any search dir (names the profile and every
 *     directory searched)
 */
export async function loadProfile(
  profileName: string,
  searchDirs: readonly string[]
): Promise<Profile> {
  const fileName = `${profileName}.yaml`;

  for (const dir of searchDirs) {
    const candidatePath = path.join(dir, fileName);
    const text = await readFileIfExists(candidatePath);
    if (text === null) {
      continue;
    }

    const raw = parseYaml(candidatePath, text);
    const result = ProfileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(formatSchemaError(candidatePath, result.error));
    }
    return result.data;
  }

  const searched = searchDirs.length > 0 ? searchDirs.join(', ') : '(no directories given)';
  throw new Error(
    `Profile "${profileName}" not found (looked for "${fileName}"). Searched: ${searched}`
  );
}

/**
 * Reads a file as UTF-8 text, returning `null` if it does not exist. Any
 * other filesystem failure (permissions, etc.) is re-thrown naming the path.
 */
async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read "${filePath}": ${message}`, { cause: error });
  }
}

/**
 * Parses YAML text, naming the file path and surfacing the parser's own
 * message on failure.
 */
function parseYaml(filePath: string, text: string): unknown {
  try {
    const raw: unknown = parse(text);
    return raw;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: malformed YAML — ${message}`, { cause: error });
  }
}

/**
 * Renders a zod validation failure naming both the file path and the
 * offending field (from the issue's `path`), e.g. `episode.yaml: version:
 * Invalid input: expected 1`.
 */
function formatSchemaError(filePath: string, error: ZodError): string {
  const details = error.issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : '(root)';
      return `${field}: ${issue.message}`;
    })
    .join('; ');
  return `${filePath}: ${details}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

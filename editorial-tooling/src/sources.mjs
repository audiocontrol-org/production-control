// Shared source loading for BOTH bins (quote-miner, quote-validator). One module, one
// id->bytes mapping rule, so the two entry points cannot drift apart (AUDIT-17).
//
// Two modes:
//   - MANIFEST: `<sourcesDir>/sources.yaml` is the id carrier. Stable ids (e.g.
//     `PB-P001`) map to paths RELATIVE to the sources dir, nesting allowed — a corpus
//     whose every document is named `issue.txt` is therefore loadable, which the v1
//     filename-stem rule made impossible.
//   - FALLBACK (no manifest): the v1 rule verbatim — every regular file directly in the
//     sources dir, id = filename stem. Unchanged, so existing corpora keep working.
//
// The FIDELITY MODEL IS UNTOUCHED: this module only decides which bytes carry which id.
// Spans, reconstruction, and validator verdicts are evaluated over the exact bytes on
// disk exactly as before (data-model.md: "a manifest carrier may be added later WITHOUT
// CHANGING THE FIDELITY MODEL").
//
// Refusals name EVERY problem at once (TASK-10). A pre-scan collects each defect and
// throws ONE error listing all of them, so a 122-source archive is fixable in a single
// pass rather than one run per bad file. A non-UTF-8 source stays a HARD FAILURE
// (FR-001/FR-015b) — never silently skipped, which would be exactly the false-clean the
// spec forbids.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isMap, parseDocument } from 'yaml';

const MANIFEST_NAME = 'sources.yaml';
const MANIFEST_VERSION = 1;

/**
 * Load every source document for a run, mapping each to its stable id.
 *
 * @param {string} sourcesDir Directory holding the corpus (and optionally its manifest).
 * @returns {{ files: Array<{ id: string, path: string, bytes: Buffer }>, manifestUsed: boolean }}
 * @throws {Error} A single error naming EVERY problem found, one per line.
 */
export function loadSources(sourcesDir) {
  const problems = [];
  const manifestPath = join(sourcesDir, MANIFEST_NAME);
  const manifestUsed = isRegularFile(manifestPath);

  const entries = manifestUsed
    ? readManifestEntries(manifestPath, problems)
    : readFlatEntries(sourcesDir, problems);

  const files = resolveEntries(sourcesDir, entries, problems);

  if (problems.length > 0) {
    throw new Error(`cannot load sources from '${sourcesDir}':\n  ${problems.join('\n  ')}`);
  }

  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { files, manifestUsed };
}

/**
 * Read the manifest into declared { id, relPath } entries, collecting shape problems.
 * Parses with `uniqueKeys: false` and walks the raw map items so a DUPLICATE id is
 * observed here and reported alongside every other problem, rather than aborting the
 * parse on the first one.
 *
 * @param {string} manifestPath
 * @param {string[]} problems
 * @returns {Array<{ id: unknown, relPath: unknown }>}
 */
function readManifestEntries(manifestPath, problems) {
  let text;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    problems.push(`cannot read manifest '${MANIFEST_NAME}': ${err.message}`);
    return [];
  }

  let doc;
  try {
    doc = parseDocument(text, { uniqueKeys: false });
  } catch (err) {
    problems.push(`manifest parse error: ${err.message}`);
    return [];
  }

  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      problems.push(`manifest parse error: ${err.message}`);
    }
    return [];
  }

  const version = doc.get('version');
  if (version === undefined || version === null) {
    problems.push(`manifest is missing 'version' (expected ${MANIFEST_VERSION})`);
    return [];
  }
  if (version !== MANIFEST_VERSION) {
    problems.push(`unknown manifest version '${version}' (expected ${MANIFEST_VERSION})`);
    return [];
  }

  const node = doc.get('sources', true);
  if (!isMap(node)) {
    problems.push(`manifest 'sources' is missing or is not a mapping of source id to path`);
    return [];
  }

  const entries = [];
  for (const item of node.items) {
    const id = scalarValue(item.key);
    const relPath = scalarValue(item.value);
    if (typeof id !== 'string') {
      problems.push(`manifest 'sources' has a non-string source id: ${String(id)}`);
      continue;
    }
    if (typeof relPath !== 'string') {
      problems.push(`source '${id}': declared path must be a string, got ${String(relPath)}`);
      continue;
    }
    entries.push({ id, relPath });
  }
  return entries;
}

/**
 * The v1 fallback: every regular file directly in `sourcesDir`, id = filename stem.
 * `sources.yaml` is never itself a source document.
 *
 * @param {string} sourcesDir
 * @param {string[]} problems
 * @returns {Array<{ id: string, relPath: string }>}
 */
function readFlatEntries(sourcesDir, problems) {
  let names;
  try {
    names = readdirSync(sourcesDir);
  } catch (err) {
    problems.push(`cannot read sources directory '${sourcesDir}': ${err.message}`);
    return [];
  }

  const entries = [];
  for (const name of [...names].sort()) {
    if (name === MANIFEST_NAME) continue;
    const full = join(sourcesDir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch (err) {
      problems.push(`cannot stat source entry '${name}': ${err.message}`);
      continue;
    }
    if (!stats.isFile()) continue;
    entries.push({ id: basename(name, extname(name)), relPath: name });
  }
  return entries;
}

/**
 * Validate ids, contain paths, and read bytes — collecting EVERY problem rather than
 * throwing on the first.
 *
 * @param {string} sourcesDir
 * @param {Array<{ id: unknown, relPath: unknown }>} entries
 * @param {string[]} problems
 * @returns {Array<{ id: string, path: string, bytes: Buffer }>}
 */
function resolveEntries(sourcesDir, entries, problems) {
  const files = [];
  const seenById = new Map(); // id -> declared path first seen
  const seenByLower = new Map(); // lowercased id -> original id first seen

  for (const { id, relPath } of entries) {
    if (!checkId(id, relPath, problems, seenById, seenByLower)) continue;

    const full = containedPath(sourcesDir, id, relPath, problems);
    if (full === null) continue;

    let stats;
    try {
      stats = statSync(full);
    } catch {
      problems.push(`source '${id}': declared path '${relPath}' is missing`);
      continue;
    }
    if (!stats.isFile()) {
      problems.push(`source '${id}': declared path '${relPath}' is not a regular file`);
      continue;
    }

    let bytes;
    try {
      bytes = readFileSync(full);
    } catch (err) {
      problems.push(`source '${id}': cannot read '${relPath}': ${err.message}`);
      continue;
    }

    // FR-001/FR-015b: a non-UTF-8 source is a HARD failure. It is reported, never
    // skipped — the improvement is only that every bad source is named at once.
    if (!isValidUtf8(bytes)) {
      problems.push(`source '${id}' ('${relPath}') is not valid UTF-8`);
      continue;
    }

    files.push({ id, path: full, bytes });
  }

  return files;
}

/**
 * FR-018 id rules, shared by both modes: non-empty, no path separator, no control
 * character, unique, and not a case-collision with another id.
 *
 * @returns {boolean} true if the id is usable
 */
function checkId(id, relPath, problems, seenById, seenByLower) {
  if (typeof id !== 'string' || id.length === 0) {
    problems.push(`invalid source id: empty id (declared path '${String(relPath)}')`);
    return false;
  }
  if (id.includes('/') || id.includes('\\')) {
    problems.push(`invalid source id '${id}': contains a path separator`);
    return false;
  }
  if (hasControlChar(id)) {
    problems.push(`invalid source id '${id}': contains a control character`);
    return false;
  }

  const prior = seenById.get(id);
  if (prior !== undefined) {
    problems.push(`duplicate source id '${id}' (paths '${prior}' and '${String(relPath)}')`);
    return false;
  }

  const lower = id.toLowerCase();
  const priorCase = seenByLower.get(lower);
  if (priorCase !== undefined && priorCase !== id) {
    problems.push(`source id case-collision: '${priorCase}' vs '${id}'`);
    return false;
  }

  seenById.set(id, String(relPath));
  seenByLower.set(lower, id);
  return true;
}

/**
 * PATH CONTAINMENT: resolve a declared path under `sourcesDir` and refuse anything that
 * escapes it (absolute path, `..` traversal) or that names the manifest itself.
 *
 * @returns {string|null} the absolute path, or null when refused
 */
function containedPath(sourcesDir, id, relPath, problems) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    problems.push(`source '${id}': declared path is empty`);
    return null;
  }
  if (isAbsolute(relPath)) {
    problems.push(
      `source '${id}': declared path '${relPath}' is absolute; paths must be relative to the sources directory`
    );
    return null;
  }

  const base = resolve(sourcesDir);
  const full = resolve(base, relPath);
  const rel = relative(base, full);
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    problems.push(`source '${id}': declared path '${relPath}' escapes the sources directory`);
    return null;
  }
  if (rel === MANIFEST_NAME) {
    problems.push(`source '${id}': '${MANIFEST_NAME}' is the manifest, not a source document`);
    return null;
  }

  return full;
}

function isRegularFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function hasControlChar(str) {
  const SPACE_CODE = ' '.codePointAt(0);
  for (let i = 0; i < str.length; i++) {
    if (str.codePointAt(i) < SPACE_CODE) return true;
  }
  return false;
}

/** Unwrap a YAML scalar node to its JS value (nodes carry `.value`; plain keys do not). */
function scalarValue(node) {
  if (node !== null && typeof node === 'object' && 'value' in node) return node.value;
  return node;
}

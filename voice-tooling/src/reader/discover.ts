// Subject-agnostic reader discovery (Constitution VII): pure filesystem
// discovery for the `voice reader` generator. No HTML, no subject strings --
// every chapter/voice/label/register below is either read from disk (an
// edition's own coverage ledger, an optional voice document) or derived
// mechanically from a directory/file slug. Nothing here names a project,
// story, or subject.
//
// Layout contract: `<editionsRoot>/<chapter>/<voice>.md` -- each chapter is a
// subdirectory, each voice is one markdown file inside it. Reuses the
// existing carrier-independent modules rather than re-implementing any of
// their parsing:
//   - `@/fidelity/check-ledger-structure.ts`'s `extractLedgerYaml` +
//     `extractFrontmatterBlock` (the SAME frontmatter-stripped body the
//     fidelity validator uses) pull the ledger YAML and the body out of an
//     edition's frontmatter.
//   - `@/schema/ledger.ts`'s `loadLedger` validates + parses that YAML.
//   - `@/schema/voice.ts`'s `loadVoice` reads an optional voice document for
//     display label/register.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractLedgerYaml,
  extractFrontmatterBlock,
} from '@/fidelity/check-ledger-structure.ts';
import { loadLedger } from '@/schema/ledger.ts';
import { loadVoice } from '@/schema/voice.ts';

export interface OpCountSummary {
  units: number;
  verbatim: number;
  represented: number;
  merged: number;
  cut: number;
}

export interface ReaderEdition {
  voiceSlug: string;
  label: string;
  register: string;
  body: string;
  summary: OpCountSummary;
}

export interface ReaderChapter {
  slug: string;
  title: string;
  editions: ReaderEdition[];
}

export interface ReaderVoice {
  slug: string;
  label: string;
  register: string;
}

export interface ReaderModel {
  chapters: ReaderChapter[];
  voices: ReaderVoice[];
}

export interface DiscoverEditionsArgs {
  editionsRoot: string;
  voicesDir?: string;
}

/**
 * Discover every chapter/voice edition under `editionsRoot` and build a
 * `ReaderModel` -- pure data, no rendering. Fails loud (naming the offending
 * path) rather than silently skipping or substituting a fallback for any
 * structural problem it can detect.
 */
export function discoverEditions(args: DiscoverEditionsArgs): ReaderModel {
  const { editionsRoot, voicesDir } = args;

  if (!fs.existsSync(editionsRoot) || !fs.statSync(editionsRoot).isDirectory()) {
    throw new Error(`discoverEditions: editionsRoot "${editionsRoot}" does not exist (or is not a directory)`);
  }

  const chapterSlugs = listSubdirectories(editionsRoot);
  if (chapterSlugs.length === 0) {
    throw new Error(`discoverEditions: editionsRoot "${editionsRoot}" contains no chapter subdirectories`);
  }

  const chapters: ReaderChapter[] = [];
  const voiceOrder: string[] = [];
  const voicesBySlug = new Map<string, ReaderVoice>();

  for (const chapterSlug of chapterSlugs) {
    const chapterDir = path.join(editionsRoot, chapterSlug);
    const voiceFileNames = listMarkdownFiles(chapterDir);
    if (voiceFileNames.length === 0) {
      throw new Error(`discoverEditions: chapter "${chapterSlug}" (${chapterDir}) contains no voice editions (*.md)`);
    }

    const editions: ReaderEdition[] = [];
    for (const fileName of voiceFileNames) {
      const voiceSlug = fileName.slice(0, -'.md'.length);
      const filePath = path.join(chapterDir, fileName);
      const edition = loadEdition(filePath, voiceSlug, voicesDir);
      editions.push(edition);

      if (!voicesBySlug.has(voiceSlug)) {
        voicesBySlug.set(voiceSlug, {
          slug: voiceSlug,
          label: edition.label,
          register: edition.register,
        });
        voiceOrder.push(voiceSlug);
      }
    }

    chapters.push({
      slug: chapterSlug,
      title: prettifySlug(chapterSlug),
      editions,
    });
  }

  const voices = voiceOrder.map((slug) => {
    const voice = voicesBySlug.get(slug);
    if (voice === undefined) {
      throw new Error(`discoverEditions: internal error -- voice "${slug}" tracked but not recorded`);
    }
    return voice;
  });

  return { chapters, voices };
}

/** Load and parse one edition file into a `ReaderEdition`, resolving its
 * display label/register and its op-count summary. */
function loadEdition(filePath: string, voiceSlug: string, voicesDir: string | undefined): ReaderEdition {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    throw new Error(`discoverEditions: could not read "${filePath}": ${describeError(cause)}`);
  }

  let summary: OpCountSummary;
  let body: string;
  try {
    const ledgerYaml = extractLedgerYaml(text);
    const ledger = loadLedger(ledgerYaml);
    summary = summarizeCoverage(ledger.coverage);

    const block = extractFrontmatterBlock(text);
    if (block === undefined) {
      throw new Error('edition has no leading frontmatter block (expected a "---" ... "---" section)');
    }
    body = block.body.trim();
  } catch (cause) {
    throw new Error(`discoverEditions: ${filePath}: ${describeError(cause)}`);
  }

  const { label, register } = resolveVoiceDisplay(voiceSlug, voicesDir);

  return { voiceSlug, label, register, body, summary };
}

function summarizeCoverage(coverage: readonly { op: string }[]): OpCountSummary {
  const summary: OpCountSummary = { units: coverage.length, verbatim: 0, represented: 0, merged: 0, cut: 0 };
  for (const entry of coverage) {
    switch (entry.op) {
      case 'verbatim':
        summary.verbatim += 1;
        break;
      case 'represented':
        summary.represented += 1;
        break;
      case 'merged':
        summary.merged += 1;
        break;
      case 'cut':
        summary.cut += 1;
        break;
      default:
        // loadLedger already restricts op to the closed set -- unreachable,
        // but named rather than silently ignored if that guarantee ever lapses.
        throw new Error(`discoverEditions: unexpected coverage op "${entry.op}"`);
    }
  }
  return summary;
}

/**
 * Resolve a voice's display `label` + `register` (contract: FIRST SENTENCE of
 * `purpose`, up to the first '. '). Falls back to a prettified slug label
 * and an empty register when no `voicesDir` is given or the voice document
 * is absent -- this is a documented, deliberate fallback for DISPLAY COPY
 * ONLY (not data/logic), spelled out here rather than silently substituted.
 */
function resolveVoiceDisplay(voiceSlug: string, voicesDir: string | undefined): { label: string; register: string } {
  if (voicesDir !== undefined) {
    const voicePath = path.join(voicesDir, `${voiceSlug}.yaml`);
    if (fs.existsSync(voicePath)) {
      let text: string;
      try {
        text = fs.readFileSync(voicePath, 'utf8');
      } catch (cause) {
        throw new Error(`discoverEditions: could not read voice document "${voicePath}": ${describeError(cause)}`);
      }
      let voice: ReturnType<typeof loadVoice>;
      try {
        voice = loadVoice(text);
      } catch (cause) {
        throw new Error(`discoverEditions: ${voicePath}: ${describeError(cause)}`);
      }
      return { label: voice.label, register: firstSentence(voice.purpose) };
    }
  }
  return { label: prettifySlug(voiceSlug), register: '' };
}

/** The first sentence of `text`, up to (and including) the first '. ' --
 * or the whole trimmed text when no '. ' is present. */
function firstSentence(text: string): string {
  const index = text.indexOf('. ');
  if (index === -1) {
    return text.trim();
  }
  return text.slice(0, index + 1).trim();
}

/** Title Case, hyphens -> spaces (e.g. "chapter-one" -> "Chapter One"). */
function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function listSubdirectories(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listMarkdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

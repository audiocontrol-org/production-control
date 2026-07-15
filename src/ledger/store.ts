import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import type { ZodError } from 'zod';
import { LedgerSchema, type Ledger } from '@/ledger/schema.js';

/**
 * Returns the empty ledger: `{ version: 1, artifacts: {}, reviews: {} }`. This is the state
 * of an episode that has never been built — the starting point `readLedger` returns when
 * `.production/ledger.yaml` is absent.
 */
export function emptyLedger(): Ledger {
  return { version: 1, artifacts: {}, reviews: {} };
}

/**
 * Reads and parses `<episodeDir>/.production/ledger.yaml` through `LedgerSchema`.
 * Returns the schema's parsed (typed) output — never the raw YAML object.
 *
 * An absent ledger is a valid, empty state (the episode has never been built) and returns
 * `emptyLedger()` — it does NOT throw. This is what lets the oracle answer "everything is
 * missing" against a never-built episode.
 *
 * A ledger that EXISTS but is malformed throws, naming the file path (FR-036, constitution
 * Principle V):
 *   - the YAML is malformed (parser's message included)
 *   - the schema rejects it (offending field named via the zod issue's `path`)
 */
export async function readLedger(episodeDir: string): Promise<Ledger> {
  const ledgerPath = ledgerPathFor(episodeDir);
  const text = await readFileIfExists(ledgerPath);
  if (text === null) {
    return emptyLedger();
  }

  const raw = parseYaml(ledgerPath, text);
  const result = LedgerSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatSchemaError(ledgerPath, result.error));
  }
  return result.data;
}

/**
 * Validates `ledger` through `LedgerSchema` and writes it to
 * `<episodeDir>/.production/ledger.yaml`, creating `.production/` if needed.
 *
 * Never writes an invalid ledger — validation happens before anything touches disk, and a
 * schema rejection throws naming the file path and the offending field, exactly like
 * `readLedger`.
 *
 * Serialization sorts every map's keys (via the `yaml` package's `sortMapEntries`), so
 * `artifacts` and `reviews` — and everything nested inside them — always serialize in the
 * same order regardless of insertion order. The ledger is committed, so a stable byte layout
 * matters: a rewrite that only reorders keys is a diff nobody wants to review.
 */
export async function writeLedger(episodeDir: string, ledger: Ledger): Promise<void> {
  const ledgerPath = ledgerPathFor(episodeDir);
  const result = LedgerSchema.safeParse(ledger);
  if (!result.success) {
    throw new Error(formatSchemaError(ledgerPath, result.error));
  }

  const text = stringify(result.data, { sortMapEntries: true });
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, text, 'utf8');
}

function ledgerPathFor(episodeDir: string): string {
  return path.join(episodeDir, '.production', 'ledger.yaml');
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
 * offending field (from the issue's `path`), e.g. `ledger.yaml: version:
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

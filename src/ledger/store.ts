import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import type { ZodError } from 'zod';
import type { Hash } from '@/hash/content.js';
import { LedgerSchema, type Ledger, type Waiver } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';

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

/**
 * What a human decided, and about what (T049, FR-021, FR-022, FR-022b).
 *
 * `waivedHash` is the followed node's hash AT THE MOMENT OF THE DECISION, and it is what makes
 * the waiver a statement about a specific change rather than about the node forever. The caller
 * supplies it — hashed from real bytes — rather than this module resolving it, because resolving
 * an identity is `state/identity.ts`'s job and a ledger writer that also decided what it was
 * writing about could pin a hash nobody ever observed.
 *
 * `at` is likewise the caller's: a clock is a seam, and a store that read one directly could not
 * be tested without also testing the clock.
 */
export interface WaiverInput {
  readonly id: Identity;
  readonly waivedHash: Hash;
  readonly reason: string;
  /** ISO-8601 with an offset (`new Date().toISOString()` qualifies). */
  readonly at: string;
}

/**
 * Records a human's waiver of advisory drift on `id`, merging it into the committed ledger and
 * returning the record that landed (FR-021).
 *
 * Read-modify-write over the whole ledger: a waiver is a decision about a review, and it must
 * disturb nothing else. `artifacts` is carried across untouched — a review is not a build, and
 * `pc review` writing a build record would be the false clean of FR-022a from the other side.
 *
 * An existing waiver for `id` is REPLACED, and that is the correct semantics rather than an
 * append: the waiver is a baseline ("the human accepted the tracker against THIS content"), and a
 * baseline has exactly one current value. Keeping the old pin alongside the new one would leave
 * two answers to a question that has one.
 *
 * The empty-reason refusal (FR-022b) is checked HERE, before anything is read or written, even
 * though `WaiverSchema` would also catch it at the `writeLedger` below. That is deliberate: the
 * schema's rejection surfaces as a zod issue rendered against a file path
 * (`…/ledger.yaml: reviews.narration.reason: …`), which names the ledger rather than the mistake.
 * This names the field and says why the rule exists. The schema stays as the structural backstop
 * — nothing reaches disk without passing it — but it is not the message a human should have to
 * read.
 */
export async function recordWaiver(episodeDir: string, input: WaiverInput): Promise<Waiver> {
  if (input.reason.trim().length === 0) {
    throw new Error(
      `Cannot waive the review on "${input.id}": "reason" must not be empty or whitespace-only. ` +
        `A waiver without a reason is not a decision, and recording it as one would defeat the ` +
        `purpose of the record (FR-022b).`
    );
  }

  const ledger = await readLedger(episodeDir);
  const waiver: Waiver = {
    waived_hash: input.waivedHash,
    reason: input.reason,
    at: input.at,
  };

  await writeLedger(episodeDir, {
    ...ledger,
    reviews: { ...ledger.reviews, [input.id]: waiver },
  });

  return waiver;
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

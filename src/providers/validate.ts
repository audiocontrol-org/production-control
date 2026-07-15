import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ArtifactRecord } from '@/ledger/schema.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
import type { Identity } from '@/manifest/schema.js';
import { derivedNode, type BuildContext } from '@/providers/build.js';
import { resolveInputs } from '@/providers/inputs.js';
import { invokeProvider } from '@/providers/invoke.js';

/**
 * Running a provider's validation and recording the verdict (T062, FR-006b,
 * contracts/cli.md § `pc validate`).
 *
 * **Why this re-invokes the provider.** The contract has exactly one channel for a verdict:
 * `validation` on a `BuildResponse` — the provider's own judgement on what it just produced
 * (contracts/provider.md). There is no "validate this file" call to make, so obtaining a
 * verdict means running the tool. That is not redundant with the build: a verdict can depend on
 * things that are not inputs (a schema, a ruleset, a spec the tool ships with), so re-running
 * validation can honestly turn `passed` into `failed` with nothing about the episode having
 * changed. That is the whole reason this verb exists separately.
 *
 * **Why it re-derives into a throwaway directory and refuses on any divergence.** The one thing
 * this verb must never do is rebuild. A `modified` artifact is a human's edit to a machine-made
 * file, and rebuilding over it destroys their work (FR-017a, FR-017b) — a gate must not do that
 * on the operator's behalf. So the provider's output lands in scratch space that is deleted on
 * every path, and it is used for exactly one purpose: to establish that what the provider just
 * judged is byte-for-byte the artifact this record describes. If it is not, this verdict is
 * about something else, and recording it against this record would be a fabricated fact.
 * `pc build` is the path that records new bytes, because `pc build` records what it produced.
 */

/** What the provider judged, and about which artifact. */
export interface Verdict {
  readonly state: 'passed' | 'failed';
  readonly record: ArtifactRecord;
}

/**
 * Validates `id` and records the verdict, returning it. Throws — naming what failed — when no
 * verdict can honestly be recorded; a refusal is never a `failed` verdict, and never a `passed`
 * one either (FR-006b: absent is its own thing, and this leaves it absent).
 */
export async function validateTarget(context: BuildContext, id: Identity): Promise<Verdict> {
  const node = derivedNode(context.graph, id);
  const decl = node.provider;
  if (decl === undefined) {
    throw new Error(`Derived node "${id}" declares no provider, so it has no validation to run.`);
  }

  const existing = context.ledger.artifacts[id];
  if (existing === undefined) {
    throw new Error(
      `Cannot validate "${id}": it has never been built, so there is no artifact to validate ` +
        `and no record to record a verdict against. Build it first.`
    );
  }

  const inputs = await resolveInputs(context, node);
  const outputDir = path.join(context.episodeDir, 'dist', `.pc-validate-${id}`);

  try {
    const { response, output } = await invokeProvider({
      runner: context.runner,
      decl,
      target: id,
      inputs,
      outputDir,
    });

    if (output.hash !== existing.output.hash) {
      throw new Error(
        `Cannot validate "${id}": the provider's verdict is about bytes that are not the ` +
          `recorded artifact. It produced ${output.hash}; the record for "${existing.output.path}" ` +
          `names ${existing.output.hash}. Either an input has moved, or the tool cannot ` +
          `reproduce its own output (an impure provider). Recording this verdict would attach a ` +
          `judgement about one artifact to the record of another. Run \`pc build ${id}\` — a ` +
          `build records the bytes it actually produced, and the verdict that came with them.`
      );
    }

    const validation = response.validation;
    if (validation === undefined) {
      throw new Error(
        `Cannot validate "${id}": the provider "${decl.cmd.join(' ')}" reported no verdict. ` +
          `"${id}" remains NOT VALIDATED — which is distinct from both passed and failed ` +
          `(FR-006b), and this will not record it as either.`
      );
    }

    const record = await recordVerdict(context, id, existing, validation.state);
    return { state: validation.state, record };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

/**
 * Merges the verdict into the artifact's existing record, leaving every other field exactly as
 * the build wrote it.
 *
 * A validation is a fact recorded ABOUT a build, never a substitute for one: this must not
 * rewrite `inputs`, `output`, `producer`, or `built_at`, or a gate would be quietly claiming to
 * have produced something. The ledger is re-read for the same reason `build.ts` re-reads it —
 * nothing else in it may be disturbed.
 */
async function recordVerdict(
  context: BuildContext,
  id: Identity,
  existing: ArtifactRecord,
  state: 'passed' | 'failed'
): Promise<ArtifactRecord> {
  const updated: ArtifactRecord = { ...existing, validation: { state, at: context.at } };

  const current = await readLedger(context.episodeDir);
  await writeLedger(context.episodeDir, {
    ...current,
    artifacts: { ...current.artifacts, [id]: updated },
  });

  return updated;
}

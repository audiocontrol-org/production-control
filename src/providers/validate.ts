import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from '@/hash/content.js';
import type { Node } from '@/graph/build.js';
import type { ArtifactRecord } from '@/ledger/schema.js';
import { readLedger, writeLedger } from '@/ledger/store.js';
import type { Identity, ValidatorDecl } from '@/manifest/schema.js';
import type { ValidateRequest } from '@/providers/contract.js';
import { derivedNode, type BuildContext } from '@/providers/build.js';
import { resolveInputs } from '@/providers/inputs.js';
import { invokeProvider } from '@/providers/invoke.js';
import { subprocessValidatorRunner } from '@/providers/validate-run.js';

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

/**
 * What the provider judged, and about which artifact.
 *
 * `errors` is what the judgement NAMED — the validator's own prose, verbatim and in its order.
 * A verdict word alone is nearly as unactionable as no verdict: the entire reason an independent
 * deterministic validator exists is that it can say *which* quote, *which* span, *which* byte.
 * Empty when nothing was named (a pass, or the producer self-report path, whose channel —
 * `BuildValidation` — carries no errors at all).
 */
export interface Verdict {
  readonly state: 'passed' | 'failed';
  readonly errors: readonly string[];
  readonly record: ArtifactRecord;
}

/**
 * Validates `id` and records the verdict, returning it. Throws — naming what failed — when no
 * verdict can honestly be recorded; a refusal is never a `failed` verdict, and never a `passed`
 * one either (FR-006b: absent is its own thing, and this leaves it absent).
 */
export async function validateTarget(context: BuildContext, id: Identity): Promise<Verdict> {
  const node = derivedNode(context.graph, id);

  const existing = context.ledger.artifacts[id];
  if (existing === undefined) {
    throw new Error(
      `Cannot validate "${id}": it has never been built, so there is no artifact to validate ` +
        `and no record to record a verdict against. Build it first.`
    );
  }

  // A DECLARED validator is the independent acceptance gate: it judges the artifact that already
  // exists and never re-runs the producer. That is what lets it validate an IMPURE target (whose
  // producer cannot reproduce the bytes, so the self-report path below refuses it) and what stops
  // a generator from certifying its own output.
  if (node.validator !== undefined) {
    return validateWithDeclaredValidator(context, id, node, node.validator, existing);
  }

  // Otherwise, the producer's OWN verdict: re-invoke it and refuse on any divergence. An impure
  // producer with no declared validator therefore cannot be validated — declare a `validator` to
  // close that gap.
  const decl = node.provider;
  if (decl === undefined) {
    throw new Error(`Derived node "${id}" declares no provider, so it has no validation to run.`);
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
      // Spread-guarded for `exactOptionalPropertyTypes`, as in `build.ts`.
      ...(context.onDiagnostic !== undefined ? { onDiagnostic: context.onDiagnostic } : {}),
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

    // The producer's self-report channel has no errors field (contract § BuildValidation), so
    // there is nothing to name here. Its stderr is teed to the operator as it runs.
    const record = await recordVerdict(context, id, existing, validation.state, []);
    return { state: validation.state, errors: [], record };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

/**
 * Runs a target's DECLARED validator against its already-built artifact and records the verdict.
 *
 * This does NOT re-produce anything — that is the whole point. It reads the committed artifact and
 * the resolved inputs, hands them to an independent deterministic validator, and records what the
 * validator decided. Because the bytes are never regenerated, an impure artifact validates here
 * exactly as a pure one does.
 *
 * It first asserts the artifact on disk is byte-for-byte the recorded one. Validating any other
 * bytes would attach a verdict to a record that does not describe them — the same invariant the
 * producer path protects, reached a different way (a hash check instead of a re-derivation).
 */
async function validateWithDeclaredValidator(
  context: BuildContext,
  id: Identity,
  node: Node,
  validator: ValidatorDecl,
  existing: ArtifactRecord
): Promise<Verdict> {
  const artifactPath = path.join(context.episodeDir, existing.output.path);
  let onDiskHash: string;
  try {
    onDiskHash = await hashFile(artifactPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot validate "${id}": its recorded artifact "${existing.output.path}" could not be ` +
        `read: ${message}. Build it first, or restore the file.`,
      { cause: error }
    );
  }
  if (onDiskHash !== existing.output.hash) {
    throw new Error(
      `Cannot validate "${id}": the artifact on disk is ${onDiskHash}, but the record for ` +
        `"${existing.output.path}" names ${existing.output.hash} — it was edited outside the ` +
        `system. Validating it would attach a verdict to bytes the record does not describe. ` +
        `Restore the file, or \`pc build ${id}\` to record the current bytes.`
    );
  }

  const inputs = await resolveInputs(context, node);
  const request: ValidateRequest = {
    version: 1,
    target: id,
    artifact: { path: artifactPath, hash: existing.output.hash },
    inputs,
  };

  // The validator's own stderr is teed to the operator as it runs: a validator that passes can
  // still report a great deal (weak selection, advisories, counts), and a verdict is not a report.
  const response = await subprocessValidatorRunner().run(request, validator, context.onDiagnostic);

  // Everything the validator named, carried through untouched. Absent `errors` is normalized to
  // an empty list — "named nothing" is one fact, not two — and never to a stand-in message: the
  // caller renders what the validator said, or says nothing on its behalf.
  const errors = response.errors ?? [];
  const record = await recordVerdict(context, id, existing, response.state, errors);
  return { state: response.state, errors, record };
}

/**
 * Merges the verdict into the artifact's existing record, leaving every other field exactly as
 * the build wrote it.
 *
 * A validation is a fact recorded ABOUT a build, never a substitute for one: this must not
 * rewrite `inputs`, `output`, `producer`, or `built_at`, or a gate would be quietly claiming to
 * have produced something. The ledger is re-read for the same reason `build.ts` re-reads it —
 * nothing else in it may be disturbed.
 *
 * The verdict's REASONS are recorded with it. A `failed` in the ledger is read long after the run
 * that produced it — `pc status` reports it forever — and a durable claim of a defect that names
 * no defect is the same unactionable report FR-007 forbids elsewhere. They are recorded in full
 * rather than capped: a cap would drop findings, and a validator that names a great many is
 * describing an artifact with a great many things wrong with it. `validation` is rebuilt whole on
 * every verdict, so a later pass clears the earlier failure's reasons rather than leaving them to
 * be read as current.
 */
async function recordVerdict(
  context: BuildContext,
  id: Identity,
  existing: ArtifactRecord,
  state: 'passed' | 'failed',
  errors: readonly string[]
): Promise<ArtifactRecord> {
  const updated: ArtifactRecord = {
    ...existing,
    validation: {
      state,
      at: context.at,
      // Spread-guarded for `exactOptionalPropertyTypes`: an absent `errors` is what every ledger
      // written before this field existed looks like, and an empty array would claim the
      // validator produced a list when it produced none.
      ...(errors.length > 0 ? { errors: [...errors] } : {}),
    },
  };

  const current = await readLedger(context.episodeDir);
  await writeLedger(context.episodeDir, {
    ...current,
    artifacts: { ...current.artifacts, [id]: updated },
  });

  return updated;
}

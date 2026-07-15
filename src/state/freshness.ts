import type { Hash } from '@/hash/content.js';
import type { Node } from '@/graph/build.js';
import type { Ledger } from '@/ledger/schema.js';
import type { Identity } from '@/manifest/schema.js';
import type { Absence, ContentResolver } from '@/state/identity.js';

/**
 * Freshness (T033) and `modified` (T042) for a derived node — the declarative consistency
 * check of data-model.md § Freshness:
 *
 *     for each declared input:
 *         current  = hash(resolve(input))
 *         recorded = ledger.artifacts[node].inputs[input]
 *         if current != recorded  -> stale
 *
 *     # then, and only if no input moved (FR-017a):
 *     current  = hash(node.output.path)
 *     recorded = ledger.artifacts[node].output.hash
 *     if current != recorded  -> modified
 *
 * The question is never "how fresh is this?" — it is "is reality still consistent with what
 * we recorded?". Nothing here computes; it compares content against a record. There is
 * therefore no clock, no mtime and no ordering of events anywhere in this file (FR-008).
 *
 * The two halves resolve DIFFERENT things, and the asymmetry is deliberate. An input resolves
 * to what that input's own ledger record claims (`identity.ts`); a node's own output check
 * reads the real bytes at its own recorded path. So the input comparison is record against
 * record — podcast's copy of voiceover's hash against voiceover's own — while the output
 * comparison is bytes against record. Each question is asked of the node that can answer it.
 *
 * **There is deliberately no propagation pass, and adding one would be a bug (FR-009).**
 * Transitive staleness is emergent from content addressing: rebuilding a node rewrites its own
 * output record, that recorded hash is what resolving its identity yields, and it is a recorded
 * input of every node downstream — so the input comparison above fails for them of its own
 * accord, at any depth, with no graph walk marking anything. This module never looks at a
 * node's consumers, and never looks past its own declared inputs.
 *
 * This module reports FACTS about one node — what moved, and what it was compared against.
 * Turning a fact into a reported state and its cause is `resolve.ts`'s job (FR-006/FR-007);
 * keeping the two apart is what stops the precedence rules from being smeared across both.
 */

/** What the consistency check found. Exactly one, in the order the check asks the questions. */
export type FreshnessAssessment =
  /**
   * A declared input has no content at all, so the question "is the output stale?" cannot be
   * asked — asking it would compare against nothing. Reported ahead of any comparison, which
   * is what makes `blocked` outrank `stale` (FR-006a).
   */
  | { readonly kind: 'input-absent'; readonly identity: Identity; readonly absence: Absence }
  /** No ledger record: the node has never been built, so there is nothing to compare with. */
  | { readonly kind: 'never-built' }
  /**
   * A declared input's content differs from what was recorded when this node was built.
   * `recorded` is null when the input was not recorded at build time at all — the input was
   * declared after the fact, so this node was never built from it.
   */
  | {
      readonly kind: 'input-changed';
      readonly identity: Identity;
      readonly recorded: Hash | null;
      readonly current: Hash;
    }
  /** The recorded output path holds nothing: the built bytes are not there to be checked. */
  | { readonly kind: 'output-absent'; readonly path: string }
  /**
   * No input moved, but the output's own content is not what was recorded — someone edited
   * it outside the system (FR-017a). Distinct from `input-changed` because the remedies are
   * opposite: rebuilding is right for a moved input and destroys work here.
   */
  | {
      readonly kind: 'output-edited';
      readonly path: string;
      readonly recorded: Hash;
      readonly current: Hash;
    }
  /** Every declared input, and the output itself, match what the ledger recorded. */
  | { readonly kind: 'consistent'; readonly path: string };

/**
 * Runs the consistency check for one derived node. The order below is the order in
 * data-model.md § Freshness, and each step exists to keep the next one honest:
 *
 *   1. Every declared input must resolve to content. One that does not makes the rest of the
 *      check unanswerable — `blocked` outranks `stale` (FR-006a) precisely because reporting
 *      "stale" here would assert something unverified. This pass runs over ALL inputs before
 *      any comparison, so an absent input outranks a changed one no matter which was declared
 *      first.
 *   2. No ledger record means never built: there is no recorded basis to compare against.
 *   3. Each input's current content against the hash recorded AT BUILD TIME.
 *   4. Only then, the output's own content against its recorded hash (FR-017a). Last because
 *      if an input moved the output was going to be replaced anyway, and the divergence is
 *      not news.
 */
export async function assessFreshness(
  resolver: ContentResolver,
  ledger: Ledger,
  node: Node
): Promise<FreshnessAssessment> {
  const inputs = declaredInputs(node);

  const blocked = await findAbsentInput(resolver, inputs);
  if (blocked !== null) {
    return blocked;
  }

  const record = ledger.artifacts[node.id];
  if (record === undefined) {
    return { kind: 'never-built' };
  }

  const moved = await findMovedInput(resolver, record.inputs, inputs);
  if (moved !== null) {
    return moved;
  }

  return assessOutput(resolver, node.id, record.output);
}

function declaredInputs(node: Node): readonly Identity[] {
  if (node.kind !== 'derived') {
    throw new Error(
      `Freshness cannot be assessed for "${node.id}": it is an authored node. An authored node ` +
        `has no producer, so staleness is not a question that can be asked of it (FR-006).`
    );
  }
  const inputs = node.inputs;
  if (inputs === undefined) {
    throw new Error(
      `Derived node "${node.id}" declares no inputs. Every derived node carries an inputs list; ` +
        `a node without one cannot be checked and must not be reported as fresh.`
    );
  }
  return inputs;
}

/** Step 1 — the absence pass. Returns the FIRST input, in declared order, with no content. */
async function findAbsentInput(
  resolver: ContentResolver,
  inputs: readonly Identity[]
): Promise<FreshnessAssessment | null> {
  for (const identity of inputs) {
    const resolution = await resolver.resolve(identity);
    if (resolution.kind === 'absent') {
      return { kind: 'input-absent', identity, absence: resolution.absence };
    }
  }
  return null;
}

/** Step 3 — the comparison. Every input resolved in step 1, so each one has content here. */
async function findMovedInput(
  resolver: ContentResolver,
  recorded: Readonly<Record<Identity, Hash>>,
  inputs: readonly Identity[]
): Promise<FreshnessAssessment | null> {
  for (const identity of inputs) {
    const resolution = await resolver.resolve(identity);
    if (resolution.kind === 'absent') {
      throw new Error(
        `Input "${identity}" resolved and then stopped resolving mid-check. State must be read ` +
          `from one consistent view of the content; report nothing rather than a torn answer.`
      );
    }

    const recordedHash = recorded[identity] ?? null;
    if (recordedHash !== resolution.hash) {
      return { kind: 'input-changed', identity, recorded: recordedHash, current: resolution.hash };
    }
  }
  return null;
}

/**
 * Step 4 — the output check (FR-017a, T042). This closes a real false-clean: the ledger has
 * always recorded `output.hash` and, before this check, nothing ever read it. A hand-edited
 * output had unchanged inputs, so it reported `fresh` and would have shipped.
 *
 * This is where — and the ONLY place where — the bytes at an output path are read, hence
 * `readOutputBytes` rather than `resolve`: resolving the node's own identity would yield its
 * recorded claim, and comparing that against itself really would be a record agreeing with
 * itself. Bytes against record is the real comparison.
 *
 * It is asked ONLY of the node itself, never of an input, and that is what keeps the blame
 * honest in both directions. An edit is reported once, as `modified`, at the node whose bytes
 * were edited — downstream never re-detects it by proxy. And an ABSENT output is this node
 * reporting that IT is not built here (the ordinary state of a fresh clone or an `rm -rf
 * dist`), never a consumer reporting an upstream node as `blocked` for the same one absence.
 */
async function assessOutput(
  resolver: ContentResolver,
  id: Identity,
  recorded: { readonly path: string; readonly hash: Hash }
): Promise<FreshnessAssessment> {
  const resolution = await resolver.readOutputBytes(id);

  if (resolution.kind === 'absent') {
    return { kind: 'output-absent', path: recorded.path };
  }
  if (resolution.hash !== recorded.hash) {
    return {
      kind: 'output-edited',
      path: recorded.path,
      recorded: recorded.hash,
      current: resolution.hash,
    };
  }
  return { kind: 'consistent', path: recorded.path };
}

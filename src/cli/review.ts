import { z } from 'zod';
import { EXIT_OK, EXIT_USAGE, runVerb, toJsonText, type CliDeps } from '@/cli/runtime.js';
import type { Hash } from '@/hash/content.js';
import { recordWaiver } from '@/ledger/store.js';
import type { Identity } from '@/manifest/schema.js';
import { createContentResolver } from '@/state/identity.js';

/**
 * `pc review <node> --waive --reason "<text>"` (T051, FR-021, FR-022, FR-022b,
 * contracts/cli.md § `pc review`) — the RESOLUTION half of the advisory edge.
 *
 * Every other verb reads. This one records a human decision, and it is the only thing in
 * Milestone 1 that writes to the ledger. That asymmetry is the design: an advisory `needs-review`
 * is a question addressed to a person, and the system cannot answer it — no rebuild, no
 * revalidation, and no amount of re-running `pc status` clears it. Only a human saying so does,
 * and only with a reason.
 *
 * **What is recorded is a hash, not a flag.** The waiver pins the followed node's content as it
 * stands at the moment of the decision, so it applies to THE CHANGE IT WAS RECORDED AGAINST and
 * to nothing after it (FR-022). The evaluation half lives in `state/resolve.ts`; this verb's job
 * is to observe the followed node's current content and hand that observation to the ledger.
 */

/**
 * `--waive` is a DISPOSITION, not a boolean toggle, and it is modelled as one so that a future
 * disposition (a rejection, an escalation) lands beside it as a sibling rather than as a second
 * boolean that could be passed alongside this one and mean nothing coherent.
 */
const ReviewOptionsSchema = z.object({
  episode: z.string().optional(),
  json: z.boolean().optional(),
  waive: z.boolean().optional(),
  reason: z.string().optional(),
});

export type ReviewOptions = z.infer<typeof ReviewOptionsSchema>;

/** Reads commander's untyped bag into a typed shape; see `runtime.readOptions`. */
export function readReviewOptions(raw: unknown): ReviewOptions {
  const parsed = ReviewOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Could not read command options: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface ReviewJson {
  readonly episode: string;
  readonly node: Identity;
  readonly disposition: 'waived';
  /** The node the decision was ABOUT — a waiver is meaningless without it. */
  readonly follows: Identity;
  /** Snake_case to match the ledger: this reports the record that was written, not a paraphrase. */
  readonly waived_hash: Hash;
  readonly reason: string;
  readonly at: string;
}

/**
 * The human rendering. The last line is not decoration: it states the ONE property of a waiver
 * that surprises people — that it expires the moment the followed node changes again — at the
 * only moment they are guaranteed to be reading (FR-022).
 */
function renderWaiver(answer: ReviewJson): readonly string[] {
  return [
    `waived  ${answer.node}  (follows ${answer.follows})`,
    `  reason:   ${answer.reason}`,
    `  pinned:   ${answer.follows} @ ${answer.waived_hash}`,
    `  recorded: ${answer.at}`,
    `  This applies to ${answer.follows} as it stands now. A later change to it raises ` +
      `needs-review again.`,
  ];
}

/**
 * Records the decision, or refuses NAMING what is wrong.
 *
 * The refusals are all exit 2 — every one of them is the caller having asked for something
 * incoherent (a waiver with no reason, a review of a node that tracks nothing, a node that does
 * not exist), which is neither a problem with the production nor a gate's verdict (FR-035).
 *
 * Order matters. The flags are checked BEFORE the episode is loaded: `--waive --reason ""` is
 * wrong no matter what the episode says, and reporting a manifest problem to someone whose real
 * mistake was an empty reason would send them to the wrong file entirely.
 */
export async function reviewCommand(
  deps: CliDeps,
  id: Identity,
  options: ReviewOptions
): Promise<number> {
  return runVerb(deps.output, 'review', async () => {
    if (options.waive !== true) {
      deps.output.err(
        `pc review: no disposition given for "${id}". ` +
          `\`--waive --reason "<text>"\` is the only one today — reviewing a node means deciding ` +
          `something about it, and this verb does not read.`
      );
      return EXIT_USAGE;
    }

    const reason = options.reason;
    if (reason === undefined) {
      deps.output.err(
        `pc review: --reason is required when waiving "${id}". ` +
          `A waiver without a reason is not a decision (FR-022b).`
      );
      return EXIT_USAGE;
    }
    if (reason.trim().length === 0) {
      deps.output.err(
        `pc review: --reason must not be empty or whitespace-only when waiving "${id}". ` +
          `A waiver without a reason is not a decision — recording one would silence the signal ` +
          `while preserving nothing about why (FR-022b).`
      );
      return EXIT_USAGE;
    }

    const { episodeDir, manifest, graph, ledger } = await deps.loader.load(options.episode);

    const node = graph.nodes.get(id);
    if (node === undefined) {
      const known = [...graph.nodes.keys()].join(', ');
      deps.output.err(
        `pc review: "${id}" is not a node in episode "${manifest.id}". ` +
          `Known nodes: ${known || '(none)'}.`
      );
      return EXIT_USAGE;
    }

    const followed = node.follows;
    if (followed === undefined) {
      // Nothing observes anything about this node, so there is no drift, so there is nothing a
      // human could be deciding. Recording a waiver here would put a decision in the ledger that
      // no state could ever consult — a record that reads as meaningful and is not.
      const hint =
        node.kind === 'derived'
          ? `It is a derived node: what resolves its state is a rebuild, not a human decision.`
          : `Only an authored node that declares \`follows\` can have a review to waive.`;
      deps.output.err(
        `pc review: "${id}" declares no \`follows\`, so there is nothing to review. ${hint}`
      );
      return EXIT_USAGE;
    }

    // The pin, observed from the followed node's CURRENT content — the same resolution the
    // oracle uses to raise `needs-review` in the first place, so the baseline this records is
    // exactly the thing the next `pc status` will compare against. Anything else here would let
    // a waiver be recorded against a hash that never described the file.
    const resolver = createContentResolver({ episodeDir, graph, ledger });
    const resolution = await resolver.resolve(followed);
    if (resolution.kind === 'absent') {
      // FR-022c's rule, from the writing side: the system cannot claim drift against something it
      // cannot read, and it equally cannot record that a human ACCEPTED something it cannot read.
      // A refusal (exit 1), not a usage error: the caller asked a coherent question about a real
      // node; the episode is what is not in a state to answer it.
      throw new Error(
        `Cannot waive the review on "${id}": the node it follows ("${followed}") has no readable ` +
          `content, so there is nothing to pin the waiver to. Resolve "${followed}" first — a ` +
          `waiver recorded now would claim a human accepted content nobody can read.`
      );
    }

    const waiver = await recordWaiver(episodeDir, {
      id,
      waivedHash: resolution.hash,
      reason,
      at: new Date().toISOString(),
    });

    const answer: ReviewJson = {
      episode: manifest.id,
      node: id,
      disposition: 'waived',
      follows: followed,
      waived_hash: waiver.waived_hash,
      reason: waiver.reason,
      at: waiver.at,
    };

    if (options.json === true) {
      deps.output.out(toJsonText(answer));
    } else {
      for (const line of renderWaiver(answer)) {
        deps.output.out(line);
      }
    }

    return EXIT_OK;
  });
}

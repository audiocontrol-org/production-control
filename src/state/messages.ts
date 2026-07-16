import type { Hash } from '@/hash/content.js';
import type { Identity } from '@/manifest/schema.js';
import type { Absence } from '@/state/identity.js';

/**
 * The prose half of a `Cause` (FR-007). Every message here NAMES the responsible thing — the
 * identity at fault, the path that is missing, the record that was compared against. A state
 * word alone ("stale") makes an agent guess which of six inputs moved; the whole reason a
 * cause is mandatory is to end the guessing, so a message that merely restates the state is
 * as useless as no message at all.
 *
 * These are gathered here rather than inlined so that `resolve.ts` reads as the precedence
 * rules it encodes, with nothing between one rule and the next.
 */

/**
 * Hashes appear in messages abbreviated. The full 64 hex characters are unreadable in a
 * sentence and no message asks a reader to verify one — the point is to show that two records
 * differ and which is which. The prefix is kept so it is unmistakably a content address.
 */
function abbreviate(hash: Hash): string {
  const [algorithm, digest] = hash.split(':');
  if (algorithm === undefined || digest === undefined) {
    return hash;
  }
  return `${algorithm}:${digest.slice(0, 12)}…`;
}

/** Renders why an identity has no content, in a form that drops into a sentence. */
export function describeAbsence(absence: Absence): string {
  return absence.kind === 'never-built'
    ? 'it has never been built, so it has no content yet'
    : `its path "${absence.path}" does not exist`;
}

export const message = {
  ok(id: Identity, outputPath: string): string {
    return (
      `Every declared input of "${id}" matches the content recorded when it was built, and its ` +
      `output at "${outputPath}" is unchanged.`
    );
  },

  neverBuilt(id: Identity): string {
    return `"${id}" has no record in the ledger: it has never been built.`;
  },

  inputChanged(id: Identity, input: Identity, recorded: Hash | null, current: Hash): string {
    if (recorded === null) {
      return (
        `Input "${input}" of "${id}" was not recorded when "${id}" was built, so "${id}" was ` +
        `never built from it. Its content is now ${abbreviate(current)}.`
      );
    }
    return (
      `Input "${input}" of "${id}" has changed: its content is now ${abbreviate(current)}, but ` +
      `"${id}" was built from ${abbreviate(recorded)}.`
    );
  },

  inputRemoved(id: Identity, input: Identity, recorded: Hash): string {
    return (
      `"${id}" was built from input "${input}" (recorded as ${abbreviate(recorded)}), but "${input}" ` +
      `is no longer among its declared inputs. The output on disk was built from material the ` +
      `manifest no longer declares, so "${id}" is stale — rebuild it from its current inputs.`
    );
  },

  inputAbsent(id: Identity, input: Identity, absence: string): string {
    return (
      `Input "${input}" of "${id}" is absent (${absence}), so whether "${id}" is stale cannot ` +
      `be known — supply "${input}".`
    );
  },

  outputAbsent(id: Identity, outputPath: string): string {
    return (
      `The ledger records "${id}" as built to "${outputPath}", but nothing is there: the built ` +
      `bytes are absent, so whether they still match what was recorded cannot be checked.`
    );
  },

  outputEdited(id: Identity, outputPath: string, recorded: Hash, current: Hash): string {
    return (
      `The output of "${id}" at "${outputPath}" is ${abbreviate(current)}, but it was built as ` +
      `${abbreviate(recorded)} and no declared input has changed — it was edited outside the ` +
      `system. Rebuilding would discard that edit; a human decides.`
    );
  },

  validationFailed(id: Identity, outputPath: string): string {
    return (
      `The recorded validation of "${id}" (output "${outputPath}") failed. Its inputs and its ` +
      `output are unchanged since that verdict, so the verdict still describes these bytes.`
    );
  },

  present(id: Identity): string {
    return `Authored node "${id}" resolves, and it follows nothing.`;
  },

  reviewed(id: Identity, followed: Identity): string {
    return (
      `Authored node "${id}" resolves, and "${followed}" — which it follows — is unchanged ` +
      `since the review recorded against it.`
    );
  },

  authoredAbsent(id: Identity, absence: string): string {
    return `Authored node "${id}" does not resolve: ${absence}.`;
  },

  followedAbsent(id: Identity, followed: Identity, absence: string): string {
    return (
      `Authored node "${id}" follows "${followed}", which does not resolve (${absence}). "${id}" ` +
      `itself is present, so it is not absent — but whether it still answers "${followed}" cannot ` +
      `be reviewed until "${followed}" is restored. A human must supply it before the question ` +
      `can be resolved (FR-022c).`
    );
  },

  followedChanged(id: Identity, followed: Identity, baseline: Hash, current: Hash): string {
    return (
      `"${followed}" — which "${id}" follows — has changed since the review recorded against ` +
      `it: it is now ${abbreviate(current)}, and the review accepted ${abbreviate(baseline)}. ` +
      `A human decides whether "${id}" still answers it; nothing rebuilds "${id}".`
    );
  },

  neverReviewed(id: Identity, followed: Identity, current: Hash): string {
    return (
      `Authored node "${id}" follows "${followed}", and no review has ever been recorded ` +
      `against it: nobody has confirmed "${id}" answers "${followed}" as it now stands ` +
      `(${abbreviate(current)}). A human decides; nothing rebuilds "${id}".`
    );
  },
};

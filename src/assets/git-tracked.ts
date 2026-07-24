import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Reports whether a path is tracked by version control. */
export interface TrackedCheck {
  isTracked(absolutePath: string): Promise<boolean>;
}

/**
 * Real implementation: shells out to `git ls-files --error-unmatch <path>`. Exit 0 means
 * tracked. Any failure — a plain untracked file, a path outside any repository, or the
 * path not being inside a git repository at all — is treated as untracked, never as an
 * error. This is the only module in the codebase that touches `node:child_process`; it
 * is NOT importable from Milestone 1 modules (see `tests/unit/architecture.test.ts`).
 */
export function gitTrackedCheck(): TrackedCheck {
  return {
    async isTracked(absolutePath: string): Promise<boolean> {
      try {
        await execFileAsync('git', ['ls-files', '--error-unmatch', absolutePath]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Always-false check, for callers with no repo. */
export function untrackedCheck(): TrackedCheck {
  return {
    isTracked(): Promise<boolean> {
      return Promise.resolve(false);
    },
  };
}

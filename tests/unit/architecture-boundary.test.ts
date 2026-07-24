import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ROOT_FILES,
  CLI_ROOT_FILES,
  REPO_ROOT,
  SRC_DIR,
  SHIPPED_ENTRY,
  IMPORTS_BY_FILE,
  EAGER_IMPORTS_BY_FILE,
  walk,
  formatViolation,
  rel,
} from './architecture-support.js';

describe('architecture: the Milestone 1 / Milestone 2 boundary', () => {
  describe('Milestone 1 does not transitively import Milestone 2 (research R6, FR-010)', () => {
    it('no oracle module reaches the execution layer, the network store, or the AWS SDK', () => {
      const failures: string[] = [];
      for (const root of ROOT_FILES) {
        for (const violation of walk(root).violations) {
          failures.push(formatViolation(root, violation));
        }
      }

      expect(
        failures,
        failures.length === 0
          ? ''
          : `Milestone 1 must stand alone. Forbidden import chains:\n${failures.join('\n')}`
      ).toEqual([]);
    });

    it('no READ verb reaches the network or an executable — reporting state is offline BY CONSTRUCTION (T027, SC-001, FR-010)', () => {
      // The mechanical half of T027. The runtime half lives in
      // `tests/integration/offline.test.ts`, which proves `pc status` answers with a hostile
      // asset store standing by and with PATH emptied. Neither is sufficient alone: a runtime
      // test only proves the paths it happens to walk never dialled out, and this only proves
      // the code CANNOT. Together they are the whole claim.
      //
      // `pc build` and `pc validate` are deliberately absent from these roots: they exist to run
      // a craft tool (FR-029). FR-010 is about REPORTING state, and these four are the verbs
      // that report it.
      expect(
        CLI_ROOT_FILES.length,
        'no read verbs are rooted — this test is vacuous'
      ).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const root of CLI_ROOT_FILES) {
        for (const violation of walk(root).violations) {
          failures.push(formatViolation(root, violation));
        }
      }

      expect(
        failures,
        failures.length === 0
          ? ''
          : `Reporting state must require no network and no craft tool (FR-010). ` +
              `Forbidden import chains from a read verb:\n${failures.join('\n')}`
      ).toEqual([]);
    });

    it('the SHIPPED dispatch path (`pc status` through src/cli/index.ts) is offline BY CONSTRUCTION (SC-001, FR-010, AUDIT-20260716-10)', () => {
      // The gap AUDIT-20260716-10 named: the command a user runs is dispatched through
      // `src/cli/index.ts`, but that module used to STATICALLY import `pc build` (which reaches
      // `child_process`), so the test excluded it and proved only that the verb IMPLEMENTATION
      // files were clean — never that dispatching a read verb through the shipped entry avoids
      // loading execution/network code.
      //
      // Now `index.ts` lazy-loads the write verbs, so its EAGER import graph — everything a read
      // dispatch actually loads — reaches nothing forbidden. Rooting the offline walk here closes
      // the gap: dispatching `pc status`/`next`/`explain`/`release-check` loads no craft tool and
      // no network client.
      const entry = path.join(REPO_ROOT, SHIPPED_ENTRY);
      expect(fs.existsSync(entry), `${SHIPPED_ENTRY} is missing`).toBe(true);

      const eager = walk(entry, EAGER_IMPORTS_BY_FILE);

      // Non-vacuous: the eager walk really does reach the read verbs and the oracle behind them, so
      // a forbidden STATIC import planted anywhere under that reachable set would surface here.
      const reachedRel = [...eager.reached].map(rel);
      expect(
        reachedRel,
        'the eager walk does not even reach `pc status` — it is vacuous'
      ).toContain('src/cli/status.ts');
      expect(reachedRel, 'the eager walk does not reach the oracle — it is vacuous').toContain(
        'src/state/resolve.ts'
      );

      const failures = eager.violations.map((violation) => formatViolation(entry, violation));
      expect(
        failures,
        failures.length === 0
          ? ''
          : `Dispatching a read verb through the shipped entry must load no execution or network ` +
              `code (FR-010, SC-001). Forbidden EAGER import chains from src/cli/index.ts:\n${failures.join('\n')}`
      ).toEqual([]);
    });

    it('the write verbs really are behind the lazy boundary — following index.ts DYNAMIC imports DOES reach the execution layer', () => {
      // The complement, and what makes the eager-clean result above mean something. If
      // `src/cli/index.ts` reached `child_process` by NO path, the eager walk would pass for the
      // wrong reason — the builder deleted rather than the builder isolated. Following the FULL
      // graph (dynamic imports included) must still reach the execution layer through the lazy
      // `import('@/cli/build.js')`, and must reach `build.ts` itself.
      const entry = path.join(REPO_ROOT, SHIPPED_ENTRY);
      const full = walk(entry, IMPORTS_BY_FILE);

      expect(
        [...full.reached].map(rel),
        'index.ts no longer even lazy-imports the builder'
      ).toContain('src/cli/build.ts');
      expect(
        full.violations.length,
        'following index.ts through its dynamic imports reaches no execution layer — the lazy ' +
          'boundary is hiding nothing, so the eager-clean proof is empty'
      ).toBeGreaterThan(0);
    });

    it('the read verbs are rooted for real — a violation planted behind one is CAUGHT', () => {
      // Non-vacuity of the check above, in the only way that means anything: prove the walk
      // reaches through a read verb's transitive imports and would fail if something forbidden
      // were there. `src/cli/status.ts` reaches `src/state/resolve.ts` via `src/cli/episode.ts`
      // — three hops — so a forbidden import ANYWHERE under the oracle is visible from the verb.
      const status = path.join(SRC_DIR, 'cli/status.ts');
      const reached = walk(status).reached;

      expect([...reached]).toContain(path.join(SRC_DIR, 'cli/episode.ts'));
      expect([...reached].map(rel)).toContain('src/state/resolve.ts');
    });

    it('`pc build` DOES reach the execution layer — the boundary moved, it did not dissolve', () => {
      // The complement, and the reason this file is not merely passing by omission. If
      // `src/cli/build.ts` did not reach `child_process`, then either the builder is not
      // building or these roots were narrowed to dodge a failure rather than to state a
      // boundary — and the read-verb guarantee above would be worth nothing.
      const build = path.join(SRC_DIR, 'cli/build.ts');
      expect(fs.existsSync(build), 'src/cli/build.ts is missing').toBe(true);

      const violations = walk(build).violations;
      expect(
        violations.length,
        '`pc build` reaches no execution layer at all — it is supposed to exec a craft tool'
      ).toBeGreaterThan(0);
    });

    it('every internal import resolves to a real file (the walk is complete)', () => {
      const unresolved: string[] = [];
      for (const root of ROOT_FILES) {
        unresolved.push(...walk(root).unresolved);
      }
      expect(
        unresolved,
        `Unresolvable internal imports — the import graph has holes, so this test cannot be trusted:\n${unresolved.join('\n')}`
      ).toEqual([]);
    });
  });
});

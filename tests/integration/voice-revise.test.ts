import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYamlText, stringify } from 'yaml';
import { z } from 'zod';
import { impureOutputRoot } from '@/zoning/route.js';
import { readLedger } from '@/ledger/store.js';
import {
  cleanupFixtureCopies,
  copyFixture,
  parseJsonText,
  pc,
  REPO_ROOT,
  StatusJsonSchema,
} from './support.js';

/**
 * T018 (US2, RED-first) — `voice revise` produces a gated, `.ai/`-routed edition
 * (specs/004-voice-editions, US2 Acceptance Scenarios 1-2, quickstart S4, FR-005/FR-028).
 *
 * **Why this is RED right now.** `voice-tooling/bin/voice-revise.mjs` (T019) is still the T001
 * scaffold placeholder:
 *
 *   #!/usr/bin/env node
 *   throw new Error("voice-revise: not yet implemented (task T001)");
 *
 * and the fixture manifest wiring it into a production-control target (T020) does not exist
 * either — this file IS that wiring, written ahead of the provider it wires in. Every assertion
 * below is what US2 promises once T019/T020 land; today `pc build` fails at the very first step
 * (the provider subprocess throws), which is the "missing provider/target wiring" reason this
 * test is expected to fail for. Once T019 ships a real `voice-revise`, this file should need no
 * changes to go green — only its target's provider `cmd` may need adjusting to whatever
 * deterministic/no-network test-mode T019 exposes (mirroring quote-miner's injectable
 * `QUOTE_MINER_MODEL_CMD` seam in `editorial-tooling/src/claude.mjs` — a `VOICE_REVISE_MODEL_CMD`-
 * shaped override is the anticipated, but not yet real, equivalent).
 *
 * **What this wires together**, mirroring `tests/integration/validator.test.ts`'s shape (a
 * `provider` + `validator` pair on one target) but pointed at the REAL voice-editions binaries
 * rather than the generic `fake-provider`/`fake-validator` test doubles:
 *   - a fixture episode (`tests/fixtures/voice-revise/`) with EXACTLY ONE source draft
 *     (`source.md`) and ONE voice document (`voice.yaml`) as its only authored nodes (FR-007/D5);
 *   - one target, `edition`, whose `provider.cmd` names `voice-tooling/bin/voice-revise.mjs` and
 *     whose `validator.cmd` names `voice-tooling/bin/voice-fidelity.mjs` — the latter is ALREADY
 *     real (US1/T016 shipped, git log `26826ea`), so once T019 exists this target validates for
 *     real, with no test-double in the loop at all.
 */

const TARGET = 'edition';
const REVISE_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-revise.mjs');
const FIDELITY_BIN = path.join(REPO_ROOT, 'voice-tooling', 'bin', 'voice-fidelity.mjs');

/**
 * The wire shape of `pc build --json` (`BuildJson`, `src/cli/build.ts`), asserted structurally
 * rather than assumed — the same discipline `validator.test.ts`'s `ValidateJsonSchema` uses.
 */
const BuildJsonSchema = z.object({
  episode: z.string(),
  target: z.string(),
  producer: z.object({ tool: z.string(), version: z.string() }),
  producer_impure: z.object({ reason: z.string() }).nullable(),
  inputs: z.record(z.string(), z.string()),
  output: z.object({ path: z.string(), hash: z.string() }),
  built_at: z.string(),
  validation: z.enum(['passed', 'failed']).nullable(),
});

/** The `ledger:` frontmatter shape asserted here (contracts/coverage-ledger-schema.md). */
const LedgerFrontmatterSchema = z.object({
  ledger: z.object({
    version: z.literal(1),
    coverage: z.array(z.unknown()).min(1),
  }),
});

const ValidateJsonSchema = z.object({
  episode: z.string(),
  valid: z.boolean(),
  targets: z.array(
    z.object({
      target: z.string(),
      state: z.enum(['passed', 'failed', 'unresolved']),
      detail: z.string().nullable(),
      errors: z.array(z.string()).optional(),
    })
  ),
});

/**
 * The `voice-revise` fixture, wired to the REAL provider/validator bin paths — never
 * `fake-provider`/`fake-validator`. `cmd` invokes each `.mjs` via `node` explicitly (rather than
 * relying on the file's executable bit) so a wiring problem shows up as the provider's own thrown
 * error rather than an unrelated `EACCES`.
 */
async function episode(): Promise<string> {
  const dir = await copyFixture('voice-revise');
  const profile = {
    version: 1,
    targets: {
      [TARGET]: {
        inputs: ['source', 'voice'],
        provider: {
          cmd: ['node', REVISE_BIN],
          // FR-005: `voice revise` is never referentially transparent — declared here so a real
          // BuildResponse's own `impure` can only CORROBORATE this, never introduce impurity a
          // pure declaration lacked (FR-012, `refuseImpurityContradiction` in
          // `src/providers/invoke.ts`).
          impure: { reason: 'voice-revise fixture target: model-produced edition' },
        },
        validator: { cmd: ['node', FIDELITY_BIN] },
      },
    },
  };
  await fs.writeFile(path.join(dir, 'voice-editions.yaml'), stringify(profile), 'utf8');
  return dir;
}

afterAll(cleanupFixtureCopies);

describe('US2: `voice revise` produces a gated, `.ai/`-routed edition (T018)', () => {
  it(
    'the provider declares impure, the edition carries a schema-valid frontmatter ledger, ' +
      'routes under `.ai/`, and the independent `voice fidelity` validator accepts it ' +
      '(RED until T019/T020 land)',
    async () => {
      const dir = await episode();

      const built = await pc(['build', TARGET, '--episode', dir, '--json']);

      // THE RED ASSERTION: today this fails — `voice-revise.mjs` throws its T001 placeholder
      // error, `pc build` surfaces that on stderr, and exits 1. `built.stderr` is attached as the
      // failure message so a reader sees the actual missing-wiring reason, not just "0 !== 1".
      expect(built.code, built.stderr).toBe(0);

      const answer = BuildJsonSchema.parse(parseJsonText(built.stdout));
      expect(answer.target).toBe(TARGET);

      // FR-005/FR-032: the provider declares impure with a non-empty reason, never a bare flag.
      expect(answer.producer_impure).not.toBeNull();
      expect(answer.producer_impure?.reason.trim().length ?? 0).toBeGreaterThan(0);

      // D19: the edition is routed under the dot-zoned `.ai/` root, a sibling of `dist/`
      // (`impureOutputRoot()`, `src/zoning/route.ts`) — never into gitignored `dist/`.
      const [root] = answer.output.path.split('/');
      expect(root).toBe(impureOutputRoot());

      // The coverage ledger lives under the edition's leading YAML frontmatter, keyed `ledger:` —
      // the exact carrier `extractLedgerYaml` (voice-tooling/src/fidelity/check-ledger-structure.ts)
      // expects (contracts/coverage-ledger-schema.md).
      const editionPath = path.join(dir, answer.output.path);
      const editionText = await fs.readFile(editionPath, 'utf8');
      const frontmatterMatch = /^---\n([\s\S]*?)\n---\n/.exec(editionText);
      expect(
        frontmatterMatch,
        `edition has no leading frontmatter block:\n${editionText}`
      ).not.toBe(null);
      const frontmatterYaml = frontmatterMatch?.[1] ?? '';
      const frontmatter = LedgerFrontmatterSchema.parse(parseYamlText(frontmatterYaml));
      expect(frontmatter.ledger.coverage.length).toBeGreaterThan(0);

      // The GENERATOR never certifies its own output (Constitution VI): the independent `voice
      // fidelity` validator is the sole arbiter of acceptance.
      const validated = await pc(['validate', TARGET, '--episode', dir, '--json']);
      expect(validated.code, validated.stderr).toBe(0);
      const verdict = ValidateJsonSchema.parse(parseJsonText(validated.stdout));
      expect(verdict.valid).toBe(true);
      expect(verdict.targets[0]?.state).toBe('passed');

      const status = await pc(['status', '--episode', dir, '--json']);
      const nodes = StatusJsonSchema.parse(parseJsonText(status.stdout)).nodes;
      expect(nodes.find((n) => n.id === TARGET)?.validated).toBe('passed');
    }
  );

  it(
    'refuses to accept an edition that no longer matches what `voice fidelity` validated — ' +
      'no partial or unvalidated edition is ever left recorded as accepted (RED until T019/T020 land)',
    async () => {
      const dir = await episode();

      const built = await pc(['build', TARGET, '--episode', dir, '--json']);
      // Same RED point as the test above: nothing past this line runs today.
      expect(built.code, built.stderr).toBe(0);
      const answer = BuildJsonSchema.parse(parseJsonText(built.stdout));

      const passing = await pc(['validate', TARGET, '--episode', dir, '--json']);
      expect(passing.code, passing.stderr).toBe(0);

      // Stand in for quickstart S4's "feed the validator a deliberately tampered edition in place
      // of a real build's output": swap the validated edition's bytes for something the recorded
      // hash no longer describes. `pc validate` checks the on-disk hash against the ledger's
      // recorded one BEFORE ever invoking `voice fidelity` again (`validateWithDeclaredValidator`,
      // `src/providers/validate.ts`) — the same guard `validator.test.ts`'s "refuses an artifact
      // edited outside the system" case exercises, applied here to a real voice edition.
      const editionPath = path.join(dir, answer.output.path);
      await fs.appendFile(editionPath, '\ntampered, outside the system\n', 'utf8');

      const revalidated = await pc(['validate', TARGET, '--episode', dir, '--json']);
      expect(revalidated.code).toBe(1);
      const verdict = ValidateJsonSchema.parse(parseJsonText(revalidated.stdout));
      const target = verdict.targets[0];
      expect(target?.state).toBe('unresolved');
      expect(target?.detail).toMatch(/edited outside the system/);

      // No partial/tampered edition is EVER left recorded as accepted: the ledger's last verdict
      // for this target is still the earlier PASSED one — `pc validate` refused rather than
      // overwriting it with a fabricated verdict about bytes it never actually judged.
      const ledger = await readLedger(dir);
      expect(ledger.artifacts[TARGET]?.validation?.state).toBe('passed');
    }
  );
});

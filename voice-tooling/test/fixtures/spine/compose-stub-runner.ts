/**
 * T013 (spec 006, US1): the runnable half of the deterministic compose model
 * stub. `compose-stub.ts` (T002) only EXPORTS the fixed `{edition, coverage,
 * grounding}` response as a plain function -- it is not itself an executable
 * the `VOICE_REVISE_MODEL` seam (`@/revise/model.ts`) can spawn as a command
 * line. This tiny wrapper is the executable: invoked as
 * `node --import tsx compose-stub-runner.ts`, it ignores the prompt on stdin
 * (the fixture response is fixed, not prompt-derived -- mirrors
 * `compose-stub.ts`'s own design) and writes the fixed response to stdout,
 * exactly the shape `parseModelOutput` (`@/revise/protocol.ts`) expects.
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors the discipline `tests/fixtures/voice-revise/stub-model.mjs` already
 * follows for `voice revise`'s own integration coverage.
 */

import { composeStub } from './compose-stub.ts';

process.stdout.write(JSON.stringify(composeStub()));

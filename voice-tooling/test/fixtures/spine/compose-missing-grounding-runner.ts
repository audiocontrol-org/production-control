/**
 * T018 (spec 006, US2): a deterministic compose model stub whose output OMITS
 * the grounding record for the final edition unit. `buildEdition` still succeeds
 * (the grounding list is non-empty, so index resolution runs), but the
 * producer's PRE-EMIT self-check (`@/revise/preflight.ts`) must catch the
 * unaccounted edition unit and REFUSE before any write (Principle V).
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors `compose-stub-runner.ts`.
 */

import { composeStub } from './compose-stub.ts';

const response = composeStub();
// Drop the record for the last edition unit (index 2): it becomes unaccounted.
response.grounding = response.grounding.filter((record) => record.edition_unit !== 2);
process.stdout.write(JSON.stringify(response));

/**
 * FG-B / D7 (spec 006, AUDIT-20): a deterministic compose model stub whose output
 * declares an EMPTY grounding array (`"grounding": []`) alongside a multi-unit
 * edition. An empty array is a DISTINCT reachable state from ABSENT grounding
 * (which `compose-missing-grounding-runner.ts` covers): the mode-blind parser
 * accepts `[]`, so the mode-aware boundary must refuse it. `mode: 'compose'`
 * requires a NON-EMPTY grounding declaration, so the producer must refuse before
 * any write (Principle V) -- "compose declared nothing" must not be conflated
 * with revise's legitimate "absent".
 *
 * MOCK CODE LIVES HERE, IN TEST FIXTURES, NEVER IN THE SHIPPED PACKAGE --
 * mirrors `compose-missing-grounding-runner.ts`.
 */

import { composeStub } from './compose-stub.ts';

const response = composeStub();
// Declare an EMPTY grounding array: compose must refuse it as "declared nothing".
response.grounding = [];
process.stdout.write(JSON.stringify(response));

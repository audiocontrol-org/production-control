// Wire protocol for the SUBAGENT FAN-OUT model adapter (src/claude-agent.mjs). Pure
// functions only: argv construction, prompt construction, and response parsing. No IO, no
// subprocess, no production-control import.
//
// THE SHAPE OF THE CALL. One `claude` invocation is given the ids and PATHS of a batch of
// sources and told to dispatch one subagent per source (the Task tool); each subagent
// READS its own file (the Read tool) and returns the passages it selected. The top-level
// invocation aggregates them into a schema-conforming envelope:
//
//   claude -p --output-format json --json-schema <inline> --allowedTools Read Task
//
// WHY: the per-source adapter pays Claude Code's system-prompt and tool-definition setup
// on EVERY source — 15,667-37,788 `cache_creation_input_tokens` measured for even a
// trivial prompt, multiplied by a 123-source corpus. Here that setup is paid once per
// BATCH, and source text never travels through the prompt at all, only paths.
//
// FAIL LOUD, ALWAYS. This module never answers "no candidates" because it could not
// understand a response, and never fills in a source the model did not answer for. An
// empty candidate list is a CLAIM that a source has nothing quotable; it is only ever
// relayed when the model actually made that claim.

import { normalizeCandidates } from './corrections.mjs';
import {
  candidateListSchema,
  resolveModelIdentity,
  FIDELITY_RULE,
  CORRECTION_RULES,
} from './claude-protocol.mjs';

/** Tools the batch invocation needs: Task to fan out, Read so each subagent opens its file. */
export const AGENT_ALLOWED_TOOLS = ['Read', 'Task'];

/**
 * The response schema handed to `claude --json-schema`. It must be passed INLINE as an
 * argument: the CLI rejects a file path with "--json-schema is not valid JSON".
 *
 * One entry per REQUESTED source, each carrying that source's candidates in exactly the
 * shape src/corrections.mjs consumes (`text` plus a possibly empty `corrections` list of
 * `{ before, after }`).
 */
export const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          candidates: candidateListSchema(),
        },
        required: ['id', 'candidates'],
      },
    },
  },
  required: ['sources'],
};

/**
 * Argv for the batch fan-out protocol.
 * @returns {string[]}
 */
export function agentArgs() {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(BATCH_SCHEMA),
    '--allowedTools',
    ...AGENT_ALLOWED_TOOLS,
  ];
}

/**
 * Build the batch prompt. It carries ids and PATHS only — never file contents — which is
 * the whole point: the subagents open the files themselves, so a 6.9 MB corpus never
 * passes through a prompt.
 *
 * @param {Array<{ id: string, path: string }>} sources
 * @returns {string}
 */
export function buildBatchPrompt(sources) {
  const manifest = sources.map((s) => `- id: ${s.id}\n  path: ${s.path}`).join('\n');

  return `You are selecting quotable passages from primary source documents for a quote bank.

There are ${sources.length} source document(s) to process:

${manifest}

Dispatch ONE subagent per source document, using the Task tool, and run them in parallel. Give each subagent exactly one source: its id and its path. Do NOT read the source files yourself.

Each subagent must:
1. Read its own source file from the path it was given, using the Read tool. Read the WHOLE file.
2. Select the most quotable passages from it: memorable, self-contained, representative statements.
3. Return, for its source id, the list of selected passages.

${FIDELITY_RULE} Copy each passage precisely as written in the file the subagent read.

${CORRECTION_RULES}

When every subagent has answered, aggregate their results into the required structured output: a "sources" list with ONE entry per source document above, each entry having "id" (the source id exactly as given above) and "candidates" (the list of that source's selected passages, each with "text" and a possibly empty "corrections" list of {"before", "after"} objects).

Report EVERY source id listed above, even one whose subagent selected nothing — in that case give it an empty "candidates" list. Do NOT invent an id that is not listed above. Do NOT omit an id: a source you leave out will fail the run, because a missing answer cannot be told apart from "this source had nothing worth quoting".`;
}

/**
 * Parse a batch envelope into `sourceId -> candidates`.
 *
 * EVERY discrepancy is fatal. In particular:
 *   - an id in the response that was NOT requested means the run answered about something
 *     the miner never asked for, so nothing in the response can be trusted to line up;
 *   - a requested id ABSENT from the response is NOT "nothing quotable" — it is an
 *     unanswered question, and the caller's retry budget exists precisely so a dropped
 *     subagent gets another chance instead of being silently recorded as a barren source
 *     (TASK-15: a quarter of a 123-source corpus once vanished exactly that way).
 *
 * @param {string} stdout
 * @param {string} command names the producer, for error messages
 * @param {Array<{ id: string }>} requested
 * @returns {{
 *   bySource: Map<string, Array<{ text: string, corrections: Array<{ before: string, after: string }> }>>,
 *   modelIdentity: string | null,
 *   usage: object | null,
 *   numTurns: number | null
 * }}
 */
export function parseBatchResponse(stdout, command, requested) {
  const trimmed = stdout.trim();
  const context = `claude agent model adapter: '${command}'`;

  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `${context}: could not parse the --output-format json envelope: ${err.message}. output: ${trimmed}`,
      { cause: err }
    );
  }

  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new Error(`${context}: the --output-format json envelope was not a JSON object: ${trimmed}`);
  }

  if (envelope.is_error === true) {
    throw new Error(`${context}: the envelope reported is_error. result: ${envelope.result ?? '(none)'}`);
  }

  const structured = envelope.structured_output;
  if (structured === undefined || structured === null) {
    throw new Error(
      `${context}: the envelope is missing 'structured_output'. keys: ${Object.keys(envelope).join(', ')}`
    );
  }
  if (typeof structured !== 'object' || Array.isArray(structured)) {
    throw new Error(`${context}: 'structured_output' was not an object: ${JSON.stringify(structured)}`);
  }

  const entries = structured.sources;
  if (!Array.isArray(entries)) {
    throw new Error(
      `${context}: 'structured_output.sources' was missing or not an array: ${JSON.stringify(structured)}`
    );
  }

  const requestedIds = new Set(requested.map((source) => source.id));
  const bySource = new Map();

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'string') {
      throw new Error(
        `${context}: each 'sources' entry must be an object with a string 'id'; got ${JSON.stringify(entry)}`
      );
    }
    if (!requestedIds.has(entry.id)) {
      throw new Error(
        `${context}: the response names source '${entry.id}', which was not requested in this batch ` +
          `(requested: ${[...requestedIds].join(', ')})`
      );
    }
    if (bySource.has(entry.id)) {
      throw new Error(`${context}: the response contains a duplicate entry for source '${entry.id}'`);
    }
    if (!Array.isArray(entry.candidates)) {
      throw new Error(
        `${context}: source '${entry.id}': 'candidates' was missing or not an array: ${JSON.stringify(entry.candidates)}`
      );
    }
    bySource.set(
      entry.id,
      normalizeCandidates(entry.candidates, `${context}: source '${entry.id}'`)
    );
  }

  const missing = [...requestedIds].filter((id) => !bySource.has(id));
  if (missing.length > 0) {
    throw new Error(
      `${context}: the response is missing ${missing.length} requested source(s): ${missing.join(', ')}. ` +
        'A source the model did not answer for is NOT a source with nothing quotable.'
    );
  }

  // Reorder to the REQUESTED order so the map iterates deterministically whatever order
  // the model listed its answers in.
  const ordered = new Map();
  for (const source of requested) {
    ordered.set(source.id, bySource.get(source.id));
  }

  return {
    bySource: ordered,
    modelIdentity: resolveModelIdentity(envelope),
    usage: typeof envelope.usage === 'object' && envelope.usage !== null ? envelope.usage : null,
    numTurns: typeof envelope.num_turns === 'number' ? envelope.num_turns : null,
  };
}

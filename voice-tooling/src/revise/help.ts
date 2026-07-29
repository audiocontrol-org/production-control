import type { ProducerMode } from '@/revise/prompt/types.ts';

/**
 * Per-verb `--help` text (spec 006 T012, contracts/voice-compose-cli.md
 * "Invocation": "Each verb's `--help` states its fidelity contract", R6).
 *
 * Kept as a pure data function (no I/O) so it is unit-testable without
 * spawning a process or touching stdin — `@/revise/cli.ts`'s `runProducer`
 * checks for `--help`/`-h` and writes this text BEFORE ever reading stdin, so
 * `voice compose --help` / `voice revise --help` work standalone with no
 * `BuildRequest` and no model command configured.
 */
export function helpText(mode: ProducerMode): string {
  return mode === 'compose' ? COMPOSE_HELP : REVISE_HELP;
}

const COMPOSE_HELP = [
  'voice-compose -- compose a full narrative chapter, in a given voice, by',
  'EXPANDING a source-cited spine of beats into voiced prose.',
  '',
  'Usage:',
  '  voice-compose < BuildRequest.json',
  '',
  'Reads exactly one BuildRequest JSON object on stdin (contracts/',
  'voice-compose-cli.md "Input"): { version: 1, target, inputs: { <id>: { path,',
  'hash } }, output_dir }. Inputs resolve by TYPE (a valid voice document is the',
  'voice; the remaining input is the spine/source), not by key name. Writes one',
  'BuildResponse JSON object to stdout on success; on any refusal, writes a',
  'named diagnostic to stderr and exits non-zero with NO stdout.',
  '',
  'Fidelity contract (compose):',
  '  - EXPAND, never reproduce: every beat MUST be represented or merged into',
  '    voiced prose -- op is NEVER "verbatim" and NEVER "cut" for any beat.',
  '  - No whole-unit copy: no destination edition unit may be byte-identical to',
  '    the beat it represents.',
  '  - Grounding declared: every edition unit the model writes carries exactly',
  '    one grounding record ("grounded" | "connective" | "framing"); a',
  '    "grounded" record names the beat(s) it is grounded in.',
  '  - Every citation marker and numeral in a beat survives byte-exact into its',
  "    destination; every [OPEN-QUESTION: ...] marker is preserved byte-exact.",
  '  - Invent nothing beyond the beats: added claims must be attributed,',
  '    traceable assertions, never fabricated facts or sources.',
  '',
  'Configure the model command via the VOICE_REVISE_MODEL environment variable',
  '(a command line, e.g. "claude -p") or the request\'s model_cmd -- there is no',
  'default model and no fallback output.',
  '',
].join('\n');

const REVISE_HELP = [
  "voice-revise -- rewrite a source draft's narration in a given voice, while",
  'preserving every VERBATIM-declared span byte-exact.',
  '',
  'Usage:',
  '  voice-revise < BuildRequest.json',
  '',
  'Reads exactly one BuildRequest JSON object on stdin (contracts/',
  'voice-revise-provider.md "Input"): { version: 1, target, inputs: { <id>: {',
  'path, hash } }, output_dir }. Inputs resolve by TYPE (a valid voice document',
  'is the voice; the remaining input is the source draft), not by key name.',
  'Writes one BuildResponse JSON object to stdout on success; on any refusal,',
  'writes a named diagnostic to stderr and exits non-zero with NO stdout.',
  '',
  'Fidelity contract (revise):',
  '  - VERBATIM (byte-exact): a source unit declared "verbatim" MUST land in an',
  '    edition unit whose bytes are identical to the source unit -- no drift is',
  '    tolerated (TASK-50).',
  '  - "represented", "merged", and "cut" are also legal (a "cut" requires a',
  '    non-empty reason); this is the same index-based coverage protocol',
  '    compose uses, without a grounding declaration.',
  '',
  'Configure the model command via the VOICE_REVISE_MODEL environment variable',
  '(a command line, e.g. "claude -p") or the request\'s model_cmd -- there is no',
  'default model and no fallback output.',
  '',
].join('\n');

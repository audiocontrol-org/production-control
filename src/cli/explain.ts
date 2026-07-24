import { explainChain, type Chain, type ChainLink, type LinkKind } from '@/cli/chain.js';
import {
  EXIT_OK,
  EXIT_USAGE,
  runVerb,
  toJsonText,
  type CliDeps,
  type ReadOptions,
} from '@/cli/runtime.js';
import type { Identity } from '@/manifest/schema.js';
import type { NodeState } from '@/state/resolve.js';

/**
 * `pc explain <node>` (T044, FR-011a) — walks the causal chain behind one node's state, back to
 * the authored inputs responsible, naming each link.
 *
 * A read verb: it exits 0 whenever it answers (FR-035). An unknown node is a USAGE error and
 * exits 2 — the caller asked about something that does not exist, which is neither a problem
 * with the production (1) nor a question that was answered (0). The message names the node and
 * lists the known ones, because "unknown node" without the alternatives just moves the guess.
 *
 * The walk itself — and the reason this verb exists at all — lives in `chain.ts`.
 */

export interface HaltJson {
  readonly kind: string;
  readonly message: string;
}

export interface ChainLinkJson {
  readonly id: Identity;
  readonly state: NodeState;
  readonly via: LinkKind;
  readonly from: Identity | null;
  readonly depth: number;
  readonly cause: { readonly code: string; readonly message: string };
  /** `null` where the walk continued — see `chain.ts`: a halt is never routine. */
  readonly halt: HaltJson | null;
}

export interface ExplainJson {
  readonly episode: string;
  readonly node: Identity;
  readonly state: NodeState;
  readonly chain: readonly ChainLinkJson[];
}

export function toExplainJson(episode: string, chain: Chain): ExplainJson {
  return {
    episode,
    node: chain.node,
    state: chain.state,
    chain: chain.links.map((link) => ({
      id: link.id,
      state: link.state,
      via: link.via,
      from: link.from ?? null,
      depth: link.depth,
      cause: { code: link.cause.code, message: link.cause.message },
      halt: link.halt ?? null,
    })),
  };
}

/**
 * Renders the chain as an indented tree. `←` reads "is built from" for a dependency and is
 * annotated for an observation, because those two arrows mean genuinely different things and
 * an unlabelled arrow would let a reader assume they mean the same one.
 */
export function renderChain(chain: Chain): readonly string[] {
  const lines: string[] = [];
  for (const link of chain.links) {
    lines.push(renderLink(link));
    if (link.halt !== undefined) {
      lines.push(`${indentFor(link.depth)}    └─ ${link.halt.message}`);
    }
  }
  return lines;
}

function renderLink(link: ChainLink): string {
  const indent = indentFor(link.depth);
  const arrow = link.depth === 0 ? '' : '← ';
  const label = link.via === 'observation' ? ' (observation, does not propagate)' : '';
  return `${indent}${arrow}${link.id}  ${link.state}${label}  ${link.cause.message}`;
}

function indentFor(depth: number): string {
  return '    '.repeat(depth);
}

export async function explainCommand(
  deps: CliDeps,
  node: Identity,
  options: ReadOptions
): Promise<number> {
  return runVerb(deps.output, 'explain', async () => {
    const { status, graph, manifest } = await deps.loader.load(options.episode);

    if (!graph.nodes.has(node)) {
      const known = [...graph.nodes.keys()].join(', ');
      deps.output.err(
        `pc explain: "${node}" is not a node in episode "${manifest.id}". ` +
          `Known nodes: ${known || '(none)'}.`
      );
      return EXIT_USAGE;
    }

    const chain = explainChain(graph, status, node);

    if (options.json === true) {
      deps.output.out(toJsonText(toExplainJson(status.episode, chain)));
    } else {
      for (const line of renderChain(chain)) {
        deps.output.out(line);
      }
    }

    return EXIT_OK;
  });
}

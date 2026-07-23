import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EXIT_OK, runVerb, toJsonText, type CliDeps, type ReadOptions } from '@/cli/runtime.js';
import { generateReadme } from '@/readme/generate.js';

/**
 * `pc readme` — write the per-episode README describing every object and its provenance.
 *
 * It READS the same facts every other verb reads (manifest, graph, committed ledger) and writes
 * exactly one file: `README.md` in the episode directory. It reaches no network and no craft tool,
 * and it is idempotent — re-running with nothing changed rewrites the same bytes. The document is
 * derived, so it is regenerated rather than hand-edited; that is what keeps its provenance durable
 * instead of drifting from the ledger it describes.
 */
export interface ReadmeJson {
  readonly episode: string;
  readonly path: string;
  readonly bytes: number;
  readonly objects: number;
}

export async function readmeCommand(deps: CliDeps, options: ReadOptions): Promise<number> {
  return runVerb(deps.output, 'readme', async () => {
    const ctx = await deps.loader.load(options.episode);
    const content = generateReadme(ctx);
    await fs.writeFile(path.join(ctx.episodeDir, 'README.md'), content, 'utf8');

    const result: ReadmeJson = {
      episode: ctx.status.episode,
      path: 'README.md',
      bytes: Buffer.byteLength(content),
      objects: ctx.graph.nodes.size,
    };
    if (options.json === true) {
      deps.output.out(toJsonText(result));
    } else {
      deps.output.out(
        `wrote README.md (${String(result.bytes)} bytes) describing ${String(result.objects)} object(s) and their provenance`
      );
    }
    return EXIT_OK;
  });
}

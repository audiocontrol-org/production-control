import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

// The shipped bin (package.json `bin.pc`) is executed directly through a symlink when installed
// (`node_modules/.bin/pc` -> dist/cli/index.js), so the FILE ITSELF must be executable. tsc emits
// it 0644, and only `npm install` sets the bit — so a plain `npm run build` (or a clean rebuild)
// would otherwise leave a shipped CLI that runs as a dependency but fails with EACCES after any
// rebuild. This restores the bit as the last build step. Cross-platform: chmod is a near-no-op on
// Windows and does not throw.
const here = path.dirname(url.fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'dist', 'cli', 'index.js');
fs.chmodSync(bin, 0o755);
process.stdout.write(`postbuild: chmod +x ${path.relative(path.join(here, '..'), bin)}\n`);

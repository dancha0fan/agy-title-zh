import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginPaths } from '../../lib/paths.mjs';
import { createTitleTranslator } from '../../lib/translator.mjs';
import { startTitleSync } from '../../lib/cdp.mjs';
import { serveRuntime } from '../../lib/runtime.mjs';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));
const paths = pluginPaths();
const translator = createTitleTranslator(paths.dataDir);
const sync = startTitleSync({ translator });

const closeControl = await serveRuntime({
  directory: paths.runtimeDir,
  version: pkg.version,
  health: () => sync.health(),
  stop: () => sync.stop()
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await sync.stop(); } catch {}
  try { await closeControl(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

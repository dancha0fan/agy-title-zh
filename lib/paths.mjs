import { homedir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';

export const PLUGIN_ID = 'agy-title-zh';

export function antigravityUserDataDir({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env.ANTIGRAVITY_USER_DATA_DIR) return env.ANTIGRAVITY_USER_DATA_DIR;
  const p = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'Antigravity');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'Antigravity');
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'Antigravity');
}

export function devToolsPortFile(options = {}) {
  const env = options.env || process.env;
  const isWin = options.platform === 'win32' || (!options.platform && process.platform === 'win32');
  const p = isWin ? win32 : posix;
  return (
    options.portFile ||
    env.ANTIGRAVITY_CDP_PORT_FILE ||
    env.AGY_BROWSER_ACTIVE_PORT_FILE ||
    p.join(antigravityUserDataDir(options), 'DevToolsActivePort')
  );
}

export function pluginPaths(home = homedir()) {
  const resolvedHome = resolve(home);
  const root = join(resolvedHome, '.gemini');
  return {
    home: resolvedHome,
    root,
    configFile: join(root, 'config', 'config.json'),
    installedDir: join(root, 'config', 'plugins', PLUGIN_ID),
    dataDir: join(root, 'antigravity', 'plugin_data', PLUGIN_ID),
    runtimeDir: join(root, 'antigravity', 'plugin_data', PLUGIN_ID, 'runtime')
  };
}

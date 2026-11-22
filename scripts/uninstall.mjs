import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PLUGIN_ID, pluginPaths } from '../lib/paths.mjs';
import { stopRuntimes } from '../lib/runtime.mjs';

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${PLUGIN_ID}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch {}
  }
}

export async function uninstall({ home, keepData = false } = {}) {
  const paths = pluginPaths(home);
  if (existsSync(paths.configFile)) {
    const config = JSON.parse(readFileSync(paths.configFile, 'utf8'));
    if (config?.plugins && Object.hasOwn(config.plugins, PLUGIN_ID)) {
      delete config.plugins[PLUGIN_ID];
      atomicJson(paths.configFile, config);
    }
  }

  await stopRuntimes(paths.runtimeDir);

  if (existsSync(paths.installedDir)) {
    const manifestPath = join(paths.installedDir, 'plugin.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== PLUGIN_ID) throw new Error('目标目录不是 agy-title-zh，已取消删除');
    }
    rmSync(paths.installedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
  }

  if (!keepData && existsSync(paths.dataDir)) {
    rmSync(paths.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
  }

  return { id: PLUGIN_ID, removed: true, keptData: keepData };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const homeIndex = args.indexOf('--home');
    const keepData = args.includes('--keep-data') || args.includes('--keep-settings');
    const result = await uninstall({ home: homeIndex >= 0 ? args[homeIndex + 1] : undefined, keepData });
    if (args.includes('--json')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`已卸载 ${result.id}${keepData ? '（已保留数据与缓存）' : ''}`);
    }
  } catch (error) {
    console.error(`卸载失败：${error.message}`);
    process.exitCode = 1;
  }
}

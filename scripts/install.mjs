import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PLUGIN_ID, pluginPaths } from '../lib/paths.mjs';
import { stopRuntimes } from '../lib/runtime.mjs';

const COPY_ITEMS = [
  'LICENSE',
  'README.md',
  'package.json',
  'plugin.json',
  'install.ps1',
  'install.sh',
  'uninstall.ps1',
  'uninstall.sh',
  'lib',
  'scripts',
  'sidecars'
];

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

function updatePluginConfig(configFile, updater) {
  const current = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error('Invalid Antigravity config.json');
  }
  updater(current);
  atomicJson(configFile, current);
}

export async function install({ sourceRoot, home } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error('需要 Node.js 22.13 或更高版本');
  }

  const root = resolve(sourceRoot || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
  if (manifest.name !== PLUGIN_ID || pkg.name !== PLUGIN_ID) {
    throw new Error('源目录不是 agy-title-zh 插件项目');
  }

  const paths = pluginPaths(home);
  if (existsSync(paths.installedDir)) {
    const existing = JSON.parse(readFileSync(join(paths.installedDir, 'plugin.json'), 'utf8'));
    if (existing.name !== PLUGIN_ID) throw new Error('目标插件目录已被其他插件占用');
  }

  updatePluginConfig(paths.configFile, config => {
    config.plugins ||= {};
    config.plugins[PLUGIN_ID] = { ...(config.plugins[PLUGIN_ID] || {}), enabled: false };
  });

  await stopRuntimes(paths.runtimeDir);
  mkdirSync(paths.installedDir, { recursive: true });

  for (const item of COPY_ITEMS) {
    const src = join(root, item);
    if (!existsSync(src)) continue;
    const dst = join(paths.installedDir, item);
    rmSync(dst, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
    cpSync(src, dst, { recursive: true, force: true });
  }

  atomicJson(join(paths.installedDir, '.agy-install.json'), {
    id: PLUGIN_ID,
    version: pkg.version,
    installedAt: new Date().toISOString(),
    sourceRoot: root
  });

  updatePluginConfig(paths.configFile, config => {
    config.plugins ||= {};
    config.plugins[PLUGIN_ID] = { ...(config.plugins[PLUGIN_ID] || {}), enabled: true };
  });

  return { id: PLUGIN_ID, version: pkg.version, destination: paths.installedDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const homeIndex = args.indexOf('--home');
    const result = await install({ home: homeIndex >= 0 ? args[homeIndex + 1] : undefined });
    if (args.includes('--json')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`已安装 ${result.id} ${result.version}`);
      console.log(`安装位置：${result.destination}`);
      console.log('未强制关闭 Antigravity；如未自动生效，完成手头任务后重启一次客户端即可。');
    }
  } catch (error) {
    console.error(`安装失败：${error.message}`);
    process.exitCode = 1;
  }
}

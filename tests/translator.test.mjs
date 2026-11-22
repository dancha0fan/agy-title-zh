import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTitleTranslator, loadConfig, needsTitleTranslation } from '../lib/translator.mjs';
import { install } from '../scripts/install.mjs';
import { uninstall } from '../scripts/uninstall.mjs';

test('needsTitleTranslation filters Chinese, empty, and non-Latin titles', () => {
  assert.equal(needsTitleTranslation('Install Agy Powertools Plugin'), true);
  assert.equal(needsTitleTranslation('安装 Agy Powertools 插件'), false);
  assert.equal(needsTitleTranslation('修复 Bug'), false);
  assert.equal(needsTitleTranslation('12345'), false);
  assert.equal(needsTitleTranslation('A'), false);
  assert.equal(needsTitleTranslation(''), false);
});

test('Google translator translates once and persists cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-title-zh-'));
  let calls = 0;
  try {
    const translator = createTitleTranslator(dir, {
      fetchImpl: async () => {
        calls++;
        return {
          ok: true,
          status: 200,
          async json() {
            return [[['安装 Agy Powertools 插件', 'Install Agy Powertools Plugin', null, null, 10]], null, 'en'];
          }
        };
      }
    });
    const first = await translator.translate('Install Agy Powertools Plugin');
    assert.deepEqual(first, { ok: true, title: '安装 Agy Powertools 插件', cached: false });
    assert.equal(calls, 1);

    const second = await translator.translate('Install Agy Powertools Plugin');
    assert.deepEqual(second, { ok: true, title: '安装 Agy Powertools 插件', cached: true });
    assert.equal(calls, 1);

    const saved = JSON.parse(readFileSync(join(dir, 'title-translations.json'), 'utf8'));
    assert.equal(saved.entries['google:zh-CN:Install Agy Powertools Plugin'], '安装 Agy Powertools 插件');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenAI-compatible translator uses configured endpoint and strips quotes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-title-zh-openai-'));
  try {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        enabled: true,
        provider: 'openai',
        openai: { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'gpt-4o-mini' }
      }),
      'utf8'
    );
    const cfg = loadConfig(dir);
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.openai.baseUrl, 'https://api.example.com/v1');

    let requestedUrl = '';
    const translator = createTitleTranslator(dir, {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return { choices: [{ message: { content: '「优化 YouTube 插件流程」' } }] };
          }
        };
      }
    });
    const res = await translator.translate('Optimize YouTube Plugin Flow');
    assert.equal(requestedUrl, 'https://api.example.com/v1/chat/completions');
    assert.deepEqual(res, { ok: true, title: '优化 YouTube 插件流程', cached: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install and uninstall cleanly manage isolated home directory without touching other plugins', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'agy-title-zh-home-'));
  try {
    const configDir = join(fakeHome, '.gemini', 'config');
    const otherPluginDir = join(configDir, 'plugins', 'other-plugin');
    rmSync(otherPluginDir, { recursive: true, force: true });
    const installed = await install({ home: fakeHome });
    assert.equal(installed.id, 'agy-title-zh');
    assert.equal(existsSync(join(installed.destination, 'plugin.json')), true);
    assert.equal(existsSync(join(installed.destination, '.agy-install.json')), true);

    const cfgAfterInstall = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
    assert.equal(cfgAfterInstall.plugins['agy-title-zh'].enabled, true);

    const removed = await uninstall({ home: fakeHome });
    assert.equal(removed.removed, true);
    assert.equal(existsSync(installed.destination), false);

    const cfgAfterUninstall = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
    assert.equal(Object.hasOwn(cfgAfterUninstall.plugins, 'agy-title-zh'), false);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

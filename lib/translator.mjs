import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CJK_RE = /[\u4e00-\u9fff]/;
const LATIN_RE = /[A-Za-z]/;
const MAX_CACHE_ENTRIES = 1000;

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  provider: 'google',
  targetLang: 'zh-CN',
  pollIntervalMs: 3000,
  batchSize: 2,
  openai: {
    baseUrl: '',
    apiKey: '',
    model: ''
  }
});

export function needsTitleTranslation(text) {
  const clean = String(text || '').trim();
  if (clean.length < 2 || clean.length > 200) return false;
  if (CJK_RE.test(clean)) return false;
  return LATIN_RE.test(clean);
}

export function loadConfig(directory) {
  const path = join(directory, 'config.json');
  try {
    if (!existsSync(path)) return { ...DEFAULT_CONFIG, openai: { ...DEFAULT_CONFIG.openai } };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...DEFAULT_CONFIG, openai: { ...DEFAULT_CONFIG.openai } };
    }
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
      provider: raw.provider === 'openai' ? 'openai' : 'google',
      targetLang: typeof raw.targetLang === 'string' && raw.targetLang.trim() ? raw.targetLang.trim() : DEFAULT_CONFIG.targetLang,
      pollIntervalMs: Number.isInteger(raw.pollIntervalMs) && raw.pollIntervalMs >= 1000 && raw.pollIntervalMs <= 60000
        ? raw.pollIntervalMs
        : DEFAULT_CONFIG.pollIntervalMs,
      batchSize: Number.isInteger(raw.batchSize) && raw.batchSize >= 1 && raw.batchSize <= 5
        ? raw.batchSize
        : DEFAULT_CONFIG.batchSize,
      openai: {
        baseUrl: typeof raw.openai?.baseUrl === 'string' ? raw.openai.baseUrl.trim().replace(/\/+$/, '') : '',
        apiKey: typeof raw.openai?.apiKey === 'string' ? raw.openai.apiKey.trim() : '',
        model: typeof raw.openai?.model === 'string' ? raw.openai.model.trim() : ''
      }
    };
  } catch {
    return { ...DEFAULT_CONFIG, openai: { ...DEFAULT_CONFIG.openai } };
  }
}

function readCache(path) {
  try {
    if (!existsSync(path)) return { entries: {} };
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return { entries: { ...parsed.entries } };
    }
  } catch {}
  return { entries: {} };
}

function writeCache(directory, path, data) {
  try {
    const keys = Object.keys(data.entries);
    if (keys.length > MAX_CACHE_ENTRIES) {
      const trimmed = {};
      for (const key of keys.slice(keys.length - MAX_CACHE_ENTRIES)) trimmed[key] = data.entries[key];
      data.entries = trimmed;
    }
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n', 'utf8');
    renameSync(`${path}.tmp`, path);
  } catch {}
}

async function translateWithGoogle(source, targetLang, fetchImpl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(source)}`;
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.[0])) return '';
  return payload[0]
    .map(segment => (Array.isArray(segment) ? String(segment[0] || '') : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

async function translateWithOpenAI(source, config, fetchImpl) {
  const { baseUrl, apiKey, model } = config.openai || {};
  if (!baseUrl || !model) throw new Error('OpenAI baseUrl and model are required');
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'Translate the short English chat title into concise natural Simplified Chinese. Keep product names, code identifiers, and acronyms as-is. Reply with only the translated title and no quotes or explanations.'
        },
        { role: 'user', content: source }
      ]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return String(content || '')
    .split(/\r?\n/)[0]
    .replace(/^["'「『《]+|["'」』》]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createTitleTranslator(directory, { fetchImpl = fetch } = {}) {
  const cachePath = join(directory, 'title-translations.json');
  let cache = readCache(cachePath);
  const inflight = new Map();

  async function translate(text, configOverride) {
    const source = String(text || '').trim();
    if (!needsTitleTranslation(source)) return { ok: false, skipped: true };

    const config = configOverride || loadConfig(directory);
    if (!config.enabled) return { ok: false, skipped: true };

    const cacheKey = `${config.provider}:${config.targetLang}:${source}`;
    const cached = cache.entries[cacheKey] || (config.provider === 'google' ? cache.entries[source] : undefined);
    if (typeof cached === 'string' && cached.trim()) {
      return { ok: true, title: cached.trim(), cached: true };
    }

    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const task = (async () => {
      try {
        const translated = config.provider === 'openai'
          ? await translateWithOpenAI(source, config, fetchImpl)
          : await translateWithGoogle(source, config.targetLang, fetchImpl);
        if (!translated || translated.toLowerCase() === source.toLowerCase()) {
          return { ok: false, unchanged: true };
        }
        cache.entries[cacheKey] = translated;
        writeCache(directory, cachePath, cache);
        return { ok: true, title: translated, cached: false };
      } catch (error) {
        return { ok: false, error: error?.message || 'translation failed' };
      } finally {
        inflight.delete(cacheKey);
      }
    })();

    inflight.set(cacheKey, task);
    return task;
  }

  return { translate, loadConfig: () => loadConfig(directory) };
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devToolsPortFile } from './paths.mjs';

const bridgePath = join(dirname(fileURLToPath(import.meta.url)), 'page-bridge.js');

export const isHubTarget = target => {
  try {
    const url = new URL(target.url);
    return (
      target.type === 'page' &&
      /(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?$/.test(target.title || '') &&
      url.protocol === 'https:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('CDP connection timed out'));
    }, 4000);

    const failAll = () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('CDP disconnected'));
      }
      pending.clear();
    };

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('CDP unavailable'));
    });
    socket.addEventListener('close', failAll);
    socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve({
        socket,
        send(method, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP disconnected'));
          return new Promise((res, rej) => {
            const id = ++sequence;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`${method} timed out`));
            }, 8000);
            pending.set(id, { resolve: res, reject: rej, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    });
  });
}

export function startTitleSync({ translator, portFile, onStatus = console.log, connect = connectCdp } = {}) {
  const activePortFile = devToolsPortFile({ portFile });
  const bridgeSource = readFileSync(bridgePath, 'utf8');
  const clients = new Map();
  const stateByConversation = new Map();
  let stopped = false;
  let polling = false;
  let lastStatus = '';

  const logStatus = message => {
    if (message !== lastStatus) {
      lastStatus = message;
      onStatus(`[agy-title-zh] ${message}`);
    }
  };

  async function ensureClient(target) {
    let client = clients.get(target.id);
    if (client && client.endpoint !== target.webSocketDebuggerUrl) {
      try { client.socket.close(); } catch {}
      clients.delete(target.id);
      client = null;
    }
    if (!client) {
      client = await connect(target.webSocketDebuggerUrl);
      client.endpoint = target.webSocketDebuggerUrl;
      client.socket.addEventListener('close', () => {
        if (clients.get(target.id) === client) clients.delete(target.id);
      });
      await client.send('Runtime.enable');
      await client.send('Page.enable');
      const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: bridgeSource });
      client.scriptId = installed.identifier;
      await client.send('Runtime.evaluate', { expression: bridgeSource });
      clients.set(target.id, client);
      logStatus('Connected to Antigravity window');
    }
    return client;
  }

  async function syncWindow(client, config) {
    const evalResult = await client.send('Runtime.evaluate', {
      expression: `(() => { if (!globalThis.__agyTitleZhBridge) { ${bridgeSource} } return globalThis.__agyTitleZhBridge?.listCandidates?.() || []; })()`,
      returnByValue: true
    });
    const candidates = Array.isArray(evalResult?.result?.value) ? evalResult.result.value : [];
    if (!candidates.length) return;

    const now = Date.now();
    const batch = [];
    for (const item of candidates) {
      const prev = stateByConversation.get(item.id);
      if (prev && prev.source === item.summary && now < prev.nextRetryAt) continue;
      batch.push(item);
      if (batch.length >= (config.batchSize || 2)) break;
    }

    for (const item of batch) {
      if (stopped) break;
      const result = await translator.translate(item.summary, config);
      if (result.ok && result.title) {
        const applied = await client.send('Runtime.evaluate', {
          expression: `globalThis.__agyTitleZhBridge?.applyTitle(${JSON.stringify(item.id)}, ${JSON.stringify(result.title)})`,
          awaitPromise: true,
          returnByValue: true
        });
        if (applied?.result?.value === true) {
          stateByConversation.set(item.id, { source: item.summary, nextRetryAt: Infinity });
        } else {
          stateByConversation.set(item.id, { source: item.summary, nextRetryAt: Date.now() + 30000 });
        }
      } else if (result.skipped || result.unchanged) {
        stateByConversation.set(item.id, { source: item.summary, nextRetryAt: Infinity });
      } else {
        stateByConversation.set(item.id, { source: item.summary, nextRetryAt: Date.now() + 60000 });
      }
    }
  }

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const config = translator.loadConfig();
      if (!config.enabled) {
        logStatus('Disabled via config.json');
        return;
      }
      const port = Number(readFileSync(activePortFile, 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid debug port');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
      const hubs = targets.filter(isHubTarget);
      const activeIds = new Set(hubs.map(t => t.id));
      for (const [id, client] of clients) {
        if (!activeIds.has(id)) {
          try { client.socket.close(); } catch {}
          clients.delete(id);
        }
      }
      if (!hubs.length) {
        logStatus('Waiting for Antigravity window');
        return;
      }
      for (const target of hubs) {
        try {
          const client = await ensureClient(target);
          await syncWindow(client, config);
        } catch (error) {
          const existing = clients.get(target.id);
          if (existing) {
            try { existing.socket.close(); } catch {}
            clients.delete(target.id);
          }
          logStatus(error?.message || 'Window sync error');
        }
      }
    } catch {
      logStatus('Waiting for Antigravity DevToolsActivePort');
    } finally {
      polling = false;
    }
  }

  const intervalMs = translator.loadConfig().pollIntervalMs || 3000;
  const timer = setInterval(poll, intervalMs);
  void poll();

  return {
    async health() {
      return { healthy: !stopped && clients.size > 0, windows: clients.size };
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const client of clients.values()) {
        try {
          if (client.scriptId) {
            await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
          }
          await client.send('Runtime.evaluate', { expression: 'delete globalThis.__agyTitleZhBridge;' });
        } catch {}
        try { client.socket.close(); } catch {}
      }
      clients.clear();
      stateByConversation.clear();
    }
  };
}

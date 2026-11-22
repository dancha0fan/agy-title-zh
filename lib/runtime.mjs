import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { PLUGIN_ID } from './paths.mjs';

export async function serveRuntime({ directory, version, health, stop, exit = () => process.exit(0) }) {
  const token = randomBytes(24).toString('hex');
  const file = join(directory, `${process.pid}-${randomUUID()}.json`);
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      try {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: PLUGIN_ID, version, ...(await health()) }));
      } catch {
        res.writeHead(503).end();
      }
      return;
    }
    if (req.method === 'POST' && req.url === '/stop') {
      try {
        await stop();
        res.end('{}');
      } catch {
        res.writeHead(500).end('{}');
      } finally {
        try { unlinkSync(file); } catch {}
        server.close();
        setTimeout(exit, 100).unref();
      }
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ id: PLUGIN_ID, version, port: server.address().port, token }),
    { mode: 0o600 }
  );

  return async () => {
    try { unlinkSync(file); } catch {}
    await new Promise(resolve => server.close(resolve));
  };
}

export function runtimeRecords(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(name => /^\d+-[\da-f-]+\.json$/.test(name))
    .flatMap(name => {
      try {
        const record = JSON.parse(readFileSync(join(directory, name), 'utf8'));
        if (
          record.id === PLUGIN_ID &&
          Number.isInteger(record.port) &&
          record.port > 0 &&
          record.port < 65536 &&
          /^[a-f\d]{48}$/.test(record.token)
        ) {
          return [{ ...record, file: join(directory, name) }];
        }
      } catch {}
      return [];
    });
}

export async function stopRuntimes(directory) {
  await Promise.all(
    runtimeRecords(directory).map(async record => {
      try {
        await fetch(`http://127.0.0.1:${record.port}/stop`, {
          method: 'POST',
          headers: { authorization: `Bearer ${record.token}` },
          signal: AbortSignal.timeout(5000)
        });
      } catch {}
      try { unlinkSync(record.file); } catch {}
    })
  );
}

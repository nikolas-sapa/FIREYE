import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const ENDPOINT = '/__dev/ops-handoff';
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createOpsHandoffMiddleware(directory: string, origin: () => string | null) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== ENDPOINT) { next(); return; }
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(JSON.stringify(value));
    };
    const expected = origin();
    if (!expected || !loopback.has(req.socket.remoteAddress ?? '') || req.headers.host !== new URL(expected).host
      || req.headers.origin !== expected || req.headers['x-fcc-local-exercise'] !== '1'
      || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')
      || ['host', 'origin', 'x-fcc-local-exercise'].some(key => req.rawHeaders.filter((v, n) => n % 2 === 0 && v.toLowerCase() === key).length !== 1)) {
      send(403, { error: 'Local exercise access only' }); return;
    }
    if (req.method !== 'POST' || req.url !== ENDPOINT || req.headers['transfer-encoding']
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      send(400, { error: 'Empty POST required' }); return;
    }
    try {
      const files = await readdir(directory, { withFileTypes: true });
      const candidates = await Promise.all(files.filter(f => f.isDirectory() && f.name.startsWith('local-demo-')).map(async f => {
        const path = join(directory, f.name, 'capabilities.json');
        try {
          const stat = await lstat(path);
          if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0) return null;
          return { path, modified: stat.mtimeMs };
        } catch { return null; }
      }));
      const current = candidates.filter((f): f is NonNullable<typeof f> => f !== null).sort((a, b) => b.modified - a.modified)[0];
      if (!current) { send(404, { error: 'No local exercise' }); return; }
      const data = JSON.parse(await readFile(current.path, 'utf8'));
      const url = new URL(data.url);
      const role = (name: string) => {
        const r = data.roles?.[name];
        if (typeof r?.principal_id !== 'string' || typeof r?.capability !== 'string'
          || !/^[A-Za-z0-9_-]{32,256}$/.test(r.capability)) throw new Error('Invalid role');
        return { principal_id: r.principal_id, capability: r.capability };
      };
      if (data.mode !== 'EXERCISE' || data.allowed_origin !== expected || url.protocol !== 'http:'
        || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || typeof data.incident_id !== 'string' || !data.incident_id || typeof data.run_id !== 'string' || !data.run_id
        || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw new Error('Invalid handoff');
      send(200, { mode: data.mode, url: url.origin, incident_id: data.incident_id, run_id: data.run_id,
        roles: { chief: role('chief'), producer: role('producer') } });
    } catch { send(404, { error: 'No current local exercise' }); }
  };
}

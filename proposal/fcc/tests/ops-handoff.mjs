import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createOpsHandoffMiddleware } from '../server/ops-handoff.ts';
import { verifyNoDevHandoff } from '../scripts/check-no-dev-handoff.mjs';

await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
const directory = await mkdtemp(join(process.cwd(), '.scratch/ops-handoff-'));
let origin;
const middleware = createOpsHandoffMiddleware(directory, () => origin);
const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(418); res.end(); }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
async function call(path = '/__dev/ops-handoff', headers = {}, method = 'POST', body = '') {
  return await new Promise((resolve, reject) => {
    const req = request(origin + path, { method, headers: { Origin: origin, 'X-FCC-Local-Exercise': '1', ...headers } }, res => {
      let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject); req.end(body);
  });
}
const roles = Object.fromEntries(['chief', 'producer', 'reader', 'analyst'].map((name, n) => [name, { principal_id: name, capability: String(n).repeat(32) }]));
const handoff = { mode: 'EXERCISE', allowed_origin: origin, url: 'http://127.0.0.1:8787', incident_id: 'exercise-local',
  run_id: 'run1', expires_at: new Date(Date.now() + 60000).toISOString(), roles };
const folder = join(directory, 'local-demo-test');
try {
  assert.equal((await call('/unrelated')).status, 418);
  assert.equal((await call()).status, 404);
  let remoteStatus;
  await middleware({ url: '/__dev/ops-handoff', socket: { remoteAddress: '192.0.2.1' }, headers: {}, rawHeaders: [] },
    { writeHead: status => { remoteStatus = status; }, end() {} }, () => assert.fail('must not pass through'));
  assert.equal(remoteStatus, 403);
  await mkdir(folder, { mode: 0o700 });
  const file = join(folder, 'capabilities.json');
  await writeFile(file, JSON.stringify(handoff), { mode: 0o600 });
  const success = await call();
  assert.equal(success.status, 200); assert.equal(success.headers['cache-control'], 'no-store');
  assert.equal(success.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(Object.keys(JSON.parse(success.data).roles), ['chief', 'producer']);
  for (const headers of [{ Origin: 'http://evil.test' }, { Origin: '' }, { Host: 'evil.test' }, { 'X-FCC-Local-Exercise': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const denied = await call(undefined, headers); assert.equal(denied.status, 403); assert.ok(!denied.data.includes(roles.chief.capability));
  }
  assert.equal((await call(undefined, {}, 'GET')).status, 400);
  assert.equal((await call('/__dev/ops-handoff?copy=1')).status, 400);
  assert.equal((await call(undefined, { 'Content-Length': '1' }, 'POST', 'x')).status, 400);
  await writeFile(file, JSON.stringify({ ...handoff, expires_at: '2000-01-01T00:00:00Z' }));
  assert.equal((await call()).status, 404);
  await writeFile(file, '{'); assert.equal((await call()).status, 404);
  await writeFile(file, JSON.stringify({ ...handoff, allowed_origin: 'http://localhost:9999' })); assert.equal((await call()).status, 404);
  const dist = join(directory, 'dist'); await mkdir(dist);
  await writeFile(join(dist, 'safe.js'), 'console.log("offline")'); await verifyNoDevHandoff(dist);
  for (const value of ['/__dev/ops-handoff', 'dev-autoconnect', roles.chief.capability]) {
    await writeFile(join(dist, 'unsafe.js'), value);
    await assert.rejects(verifyNoDevHandoff(dist, [roles.chief.capability]), /Production output/);
  }
  console.log('OPS-DEV: real loopback exact Origin/Host/header checks, empty/malformed/expired handoffs, role minimization, no-store and dist leak detection PASS');
} finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }

import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMascotServer } from '../server.mjs';

async function withServer(run) {
  const server = createMascotServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try { await run(server.address().port, server); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function localRequest(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('ML05 actual loopback serves only explicit gallery assets with safety headers', async () => {
  await withServer(async (port, server) => {
    assert.equal(server.address().address, '127.0.0.1');
    for (const path of ['/', '/index.html', '/app.mjs', '/styles.css', '/ui-controls.mjs', '/bots-a.mjs', '/bots-b.mjs', '/sprite-core.mjs', '/assets/geist-latin.woff2', '/assets/OFL.txt']) {
      const result = await localRequest(port, path);
      assert.equal(result.status, 200, path);
      assert.ok(result.body.length > 0, path);
      assert.equal(result.headers['x-content-type-options'], 'nosniff');
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.match(result.headers['content-security-policy'], /connect-src 'none'/);
      assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
    }
    const head = await localRequest(port, '/', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    const module = await localRequest(port, '/app.mjs');
    assert.match(module.headers['content-type'], /javascript/);
    assert.equal((await localRequest(port, '/favicon.ico')).status, 204);
  });
});

test('ML05 traversal, private docs, foreign origins/hosts and writes stay closed', async () => {
  await withServer(async (port) => {
    const hostilePaths = ['/../AGENTS.md', '/%2e%2e/AGENTS.md', '/%252e%252e/AGENTS.md', '/.env', '/README.md', '/.impeccable.md', '/server.mjs', '/tests/browser.mjs', '/backend/.env.example', '/proposal/fcc/index.html', '//index.html', '/assets/../index.html', '/%ZZ', '/index.html?path=../.env'];
    for (const path of hostilePaths) {
      const result = await localRequest(port, path);
      assert.ok([400, 403, 404].includes(result.status), path);
      assert.ok(!result.body.toString().includes('Fire Command Center collaboration rules'));
      assert.ok(!result.body.toString().includes(fileURLToPath(new URL('..', import.meta.url))));
    }
    for (const headers of [
      { host: `evil.example:${port}` },
      { host: `127.0.0.1:${port + 1}` },
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'null' },
    ]) assert.equal((await localRequest(port, '/', headers)).status, 403);
    assert.equal((await localRequest(port, '/', { host: `localhost:${port}`, origin: `http://localhost:${port}` })).status, 200);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const result = await localRequest(port, '/', {}, method);
      assert.equal(result.status, 405, method);
      assert.equal(result.headers.allow, 'GET, HEAD');
    }
  });
});

test('ML05 embedded font has authentic WOFF2 magic and retained OFL', async () => {
  const font = await readFile(new URL('../assets/geist-latin.woff2', import.meta.url));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.ok(font.length > 10_000 && font.length < 200_000);
  const license = await readFile(new URL('../assets/OFL.txt', import.meta.url), 'utf8');
  assert.match(license, /Copyright 2024 The Geist Project Authors/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1.1/);
});

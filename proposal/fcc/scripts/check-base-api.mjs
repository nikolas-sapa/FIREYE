import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';

for (const base of ['/', '/FIREYE/']) {
  for (const kind of ['dev', 'preview']) {
    const config = { base, server: { host: '127.0.0.1', port: 0 }, preview: { host: '127.0.0.1', port: 0 } };
    const server = kind === 'dev' ? await createServer(config) : await preview(config);
    if (kind === 'dev') await server.listen();
    const http = server.httpServer;
    try {
      const origin = `http://127.0.0.1:${http.address().port}`;
      for (const api of ['monitor', 'image-lab']) {
        const url = `${origin}${base}api/${api}/config`;
        const response = await fetch(url);
        assert.equal(response.status, 200, url);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal(typeof await response.json(), 'object');
        assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
        assert.equal((await fetch(`${origin}${base}api/${api}/unknown`)).status >= 400, true);
      }
      assert.equal((await fetch(`${origin}${base}api/monitor/config`, { method: 'POST' })).status, 405);
      console.log(`Local APIs: ${kind} ${base} config routes, unknown routes, cross-origin rejection and method guards PASS`);
    } finally {
      if (kind === 'dev') await server.close();
      else await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  }
}

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/ui-controls.mjs', ['ui-controls.mjs', 'text/javascript; charset=utf-8']],
  ['/sprite-core.mjs', ['sprite-core.mjs', 'text/javascript; charset=utf-8']],
  ['/bots-a.mjs', ['bots-a.mjs', 'text/javascript; charset=utf-8']],
  ['/bots-b.mjs', ['bots-b.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/geist-latin.woff2', ['assets/geist-latin.woff2', 'font/woff2']],
  ['/assets/OFL.txt', ['assets/OFL.txt', 'text/plain; charset=utf-8']],
]);

const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

// Fixed public-file map, never a filesystem path derived from request input.
export function createMascotServer() {
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    const reject = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      reject(405, 'Read-only local preview.');
      return;
    }
    const port = request.socket.localPort;
    const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!localHosts.has(request.headers.host)) {
      reject(403, 'Local host required.');
      return;
    }
    const origin = request.headers.origin;
    if ((origin !== undefined && origin !== `http://${request.headers.host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
      reject(403, 'Local origin required.');
      return;
    }
    const requestedPath = request.url;
    if (typeof requestedPath !== 'string' || requestedPath.length > 256 || requestedPath.includes('?') || requestedPath.includes('#')) {
      reject(400, 'Invalid asset path.');
      return;
    }
    if (requestedPath === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const asset = assets.get(requestedPath);
    if (!asset) {
      reject(404, 'Asset not found.');
      return;
    }
    try {
      const body = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      reject(503, 'Preview asset unavailable.');
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const port = args.length === 0 ? 5184 : args.length === 2 && args[0] === '--port' && /^\d{1,5}$/.test(args[1]) ? Number(args[1]) : NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Use node mascot-lab/server.mjs [--port 1024..65535]');
    process.exitCode = 1;
  } else {
    const server = createMascotServer();
    server.once('error', (error) => {
      console.error(error.code === 'EADDRINUSE' ? 'Preview port busy. Choose another --port.' : 'Could not start local preview.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Mascot lab: http://127.0.0.1:${port}`));
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}

// Native service worker, no new runtime/build dependency. Never cache provider tile traffic.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('rev-') || entry.name === 'sw.js') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(dist);
files.sort();
const hash = createHash('sha256');
let bytes = 0;
for (const path of files) {
  const data = await readFile(path);
  hash.update(relative(dist, path)).update(data);
  bytes += data.length;
}
const version = hash.digest('hex').slice(0, 16);
const html = await readFile(join(dist, 'console.html'), 'utf8');
const base = new URL(html.match(/src="([^"]*assets\/[^"/]+\.js)"/)[1], 'https://fcc.test').pathname.split('assets/')[0];
const urls = files.map((p) => base + relative(dist, p).split('\\').join('/'));
const worker = `
const BASE = ${JSON.stringify(base)};
const CACHE_PREFIX = 'fcc-app-' + BASE + '-';
const CACHE = CACHE_PREFIX + ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(urls)};
const KNOWN = new Set(PRECACHE);
const page = path => path === BASE ? BASE + 'index.html' : path;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bound first-install traffic. A failed download leaves the previous worker in charge.
    for (let i = 0; i < PRECACHE.length; i += 12) {
      await cache.addAll(PRECACHE.slice(i, i + 12).map(url => new Request(url, { cache: 'reload' })));
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Provider tiles, credentials and unrelated same-origin APIs never enter this cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = page(url.pathname);
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // Pin the app shell to this worker's assets until all old windows close.
      // Network-first HTML can reference a newer, uncached script during an update.
      const cache = await caches.open(CACHE);
      const shell = KNOWN.has(path) ? await cache.match(path) : undefined;
      if (shell) return shell;
      try { return await fetch(request); }
      catch {
        return await cache.match(BASE + 'offline.html');
      }
    })());
  } else if (KNOWN.has(path)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(path) || fetch(request);
    })());
  }
});
`;
await writeFile(join(dist, 'sw.js'), worker);
console.log(`PWA ${version}: ${files.length} local files, ${(bytes / 1024 / 1024).toFixed(1)} MiB; archives and external tiles excluded.`);

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(await readFile(join(dist, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, './');
assert.equal(manifest.start_url, './console.html?source=pwa');
assert.equal(manifest.id, './');
for (const icon of manifest.icons) {
  const bytes = await readFile(join(dist, icon.src));
  assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
  assert.equal(bytes.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
}
for (const file of ['index.html', 'console.html']) {
  const html = await readFile(join(dist, file), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
}
const worker = await readFile(join(dist, 'sw.js'), 'utf8');
const events = {};
const context = {
  self: { location: { origin: 'https://fcc.test' }, addEventListener: (name, fn) => { events[name] = fn; } },
  URL, Request, Set,
};
vm.runInNewContext(worker + '\nself.__urls = PRECACHE; self.__cache = CACHE;', context);
const urls = context.self.__urls;
const base = new URL(manifest.scope, 'https://fcc.test' + (process.env.VITE_BASE || '/')).pathname;
const local = path => base + path.replace(/^\//, '');
const offline = await readFile(join(dist, 'offline.html'), 'utf8');
const offlineLinks = [...offline.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(offlineLinks, [local('/console.html?tokens=0'), base]);
for (const nested of ['missing', 'nested/uncached/page']) {
  for (const link of offlineLinks) {
    assert.equal(new URL(link, `https://fcc.test${base}${nested}`).pathname.startsWith(base), true);
  }
}
assert.ok(urls.includes(local('/console.html')) && urls.includes(local('/index.html')) && urls.includes(local('/offline.html')));
assert.ok(urls.includes(local('/data/mati/arrival.bin')) && urls.includes(local('/data/caldor/arrival.bin')));
assert.ok(urls.some((u) => u.startsWith(local('/cesium/'))));
assert.ok(urls.every((u) => !u.startsWith(local('/rev-')) && !u.includes('.env') && !u.includes('?') && !u.includes('://')));
for (const url of urls) assert.ok((await stat(join(dist, url.slice(base.length)))).isFile(), url);
for (const url of [
  'https://tile.googleapis.com/v1/3dtiles/root.json?key=EXAMPLE', 'https://api.cesium.com/asset', 'https://fcc.test/private-api',
  'https://queue.fal.run/google/nano-banana-2.1/edit', 'https://fal.media/example.png', 'https://tiles.maps.eox.at/wms',
  'https://fcc.test/api/image-lab/config', 'https://fcc.test/api/image-lab/grid/example/imagery',
  'https://fcc.test/api/image-lab/grid/example/output/0',
]) {
  let intercepted = false;
  events.fetch({ request: new Request(url), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false, 'Must not cache provider or unrelated API traffic');
}
// A waiting update must not mix network HTML with the active worker's old asset allowlist.
let networkCalls = 0;
const cachedShell = new Response('<script src="/assets/previous-version.js"></script>');
context.caches = { open: async () => ({ match: async (path) => path === local('/console.html') ? cachedShell : undefined }) };
context.fetch = async () => { networkCalls++; return new Response('new shell'); };
let response;
events.fetch({
  request: { url: 'https://fcc.test' + local('/console.html?scenario=caldor-2021&appearance=light'), method: 'GET', mode: 'navigate' },
  respondWith: (promise) => { response = promise; },
});
assert.equal(await response, cachedShell, 'Navigation must use the shell matching the active worker');
assert.equal(networkCalls, 0, 'Do not fetch a newer app shell while an older worker is active');
assert.equal(context.self.skipWaiting, undefined, 'Never force activation over a running decision');
context.fetch = async () => { throw new TypeError('Offline'); };
const fallback = new Response(offline);
context.caches = { open: async () => ({ match: async path => path === local('/offline.html') ? fallback : undefined }) };
events.fetch({
  request: { url: `https://fcc.test${base}nested/uncached/page`, method: 'GET', mode: 'navigate' },
  respondWith: promise => { response = promise; },
});
assert.equal(await response, fallback, 'Uncached nested navigation receives the base-absolute offline shell');
console.log('Nested offline navigation and base-absolute recovery links PASS');
console.log(`PWA manifest, PNG dimensions, both entries, ${urls.length} precached files and provider-cache exclusion PASS`);
console.log('Version-pinned navigation, scenario-query canonicalization and deferred activation PASS');

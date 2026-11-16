import assert from 'node:assert/strict';
import { archiveUrls } from './pages-assets.mjs';

const source = '<script src="/rev-a/assets/main.js"></script><a href="/console.html">Console</a>'
  + 'url(/rev-b/assets/font.woff2) url("/rev-c/font.woff2") const pack="/data/caldor/";'
  + '<a href="https://example.org/rev-a/">External</a><a href="//example.org/rev-b/">External</a>';
const rewritten = archiveUrls(source, '/FIREYE/');
for (const path of ['rev-a/assets/main.js', 'console.html', 'rev-b/assets/font.woff2', 'rev-c/font.woff2', 'data/caldor/']) {
  assert.ok(rewritten.includes('/FIREYE/' + path), path);
}
assert.ok(rewritten.includes('https://example.org/rev-a/'));
assert.ok(rewritten.includes('//example.org/rev-b/'));
assert.equal(archiveUrls(source, '/'), source);
assert.equal(archiveUrls('', '/FIREYE/'), '');
assert.equal(archiveUrls(rewritten, '/FIREYE/'), rewritten);
assert.equal(archiveUrls('url(data:image/png;base64,abc) "../relative.js" /invalid/', '/FIREYE/'), 'url(data:image/png;base64,abc) "../relative.js" /invalid/');
console.log('Pages archives: root/subpath assets, empty/unrelated URLs and idempotence PASS');

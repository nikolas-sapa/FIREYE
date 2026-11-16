import assert from 'node:assert/strict';
import { contextAllowed } from '../src/console/stage3d/provider-policy';

for (const env of [{}, { VITE_CESIUM_ION_TOKEN: '' }, { VITE_CESIUM_ION_TOKEN: '  ' }]) {
  assert.equal(contextAllowed('', env), false);
  assert.equal(contextAllowed('?tokens=0', env), false);
  assert.equal(contextAllowed('?context=1', env), true);
}
for (const env of [{ VITE_CESIUM_ION_TOKEN: 'configured' }, { VITE_GOOGLE_MAPS_KEY: 'configured' }]) {
  assert.equal(contextAllowed('', env), true);
  assert.equal(contextAllowed('?tokens=0', env), false);
  assert.equal(contextAllowed('?tokens=0&context=1', env), true);
  assert.equal(contextAllowed('?context=0', env), false);
}
assert.equal(contextAllowed('?tokens=%ZZ&context=unexpected', {}), false);
console.log('Provider policy: token-free fallback, configured tokens and explicit context overrides PASS');

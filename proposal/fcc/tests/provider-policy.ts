import assert from 'node:assert/strict';
import { contextAllowed } from '../src/console/stage3d/provider-policy';
import { tokenOverride } from '../src/console/stage3d/capabilities';

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
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  for (const search of ['?tokens=0', '?tokens=off', '?tokens=none', '?basemap=offline', '?tokens=0&context=1']) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search } } });
    assert.equal(tokenOverride(), 'none');
  }
  for (const search of ['?tokens=ion', '?basemap=ion']) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search } } });
    assert.equal(tokenOverride(), 'ion');
  }
  for (const search of ['', '?tokens=all', '?context=1']) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search } } });
    assert.equal(tokenOverride(), 'all');
  }
} finally {
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
}
console.log('Provider token override: resident embed shares offline/ion/all gating, context cannot bypass tokens=0 PASS');

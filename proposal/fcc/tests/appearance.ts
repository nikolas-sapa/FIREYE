import assert from 'node:assert/strict';
import { appearancePalette, contrast } from '../src/design-system/tokens/appearance-palette';
import { THEMES } from '../src/design-system/tokens/theme';
import { daylight, sunPosition } from '../src/console/stage3d/sun';
import { DEFAULT_MAP_SETTINGS, parseMapSettings } from '../src/console/stage3d/map-settings';

for (const theme of Object.values(THEMES)) {
  let worst = Infinity;
  for (let step = 0; step <= 1000; step++) {
    const p = appearancePalette(step / 1000, theme);
    for (const k of ['bone', 'bone-dim', 'bone-mute', 'signal', 'ember', 'amber', 'phosphor', 'ice', 'violet']) {
      worst = Math.min(worst, contrast(p[k], p['ink-900']));
      assert.ok(contrast(p[k], p['ink-900']) >= 4.5, `${theme.id}/${step}/${k}: illegible twilight text`);
    }
    assert.ok(contrast(p['on-signal'], p.signal) >= 4.5, `${theme.id}/${step}: action text`);
    assert.ok(Object.values(p).every((v) => /^#[0-9A-F]{6}$/i.test(v)));
  }
  assert.notEqual(appearancePalette(0, theme)['ink-900'], appearancePalette(1, theme)['ink-900']);
  console.log(`${theme.id}: 1,001 daylight samples, worst panel text contrast ${worst.toFixed(2)}:1 PASS`);
}
assert.equal(daylight(-6), 0);
assert.equal(daylight(8), 1);
assert.equal(daylight(1), 0.5);
assert.equal(daylight(sunPosition(Date.parse('2018-07-23T13:38:00Z'), 38.04, 23.96).elDeg), 1);
assert.equal(daylight(sunPosition(Date.parse('2018-07-23T19:00:00Z'), 38.04, 23.96).elDeg), 0);
assert.deepEqual(parseMapSettings(null), DEFAULT_MAP_SETTINGS);
assert.equal(parseMapSettings({ mode: 'constructor', layers: { roads: 'yes' } }).mode, 'outline');
assert.equal(parseMapSettings({ mode: 'satellite', layers: { roads: false } }).layers.roads, false);
assert.equal(DEFAULT_MAP_SETTINGS.layers.coverage, false);
assert.equal(DEFAULT_MAP_SETTINGS.layers.projection, false);
console.log('Shared solar endpoints, twilight midpoint and validated independent map settings PASS');

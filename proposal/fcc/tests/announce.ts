import assert from 'node:assert/strict';
import type { ScenarioPack } from '../src/console/contracts';
import { alertFeed, fireUpdates, type RevEntry } from '../src/console/ops/alerts';
import { ANNOUNCE_LABEL, announcementFor, deliverAnnouncement, shouldAnnounce } from '../src/console/ops/announce';
import { opsView } from '../src/console/ops/view';

for (const stage of ['monitor', 'prepare', 'leave', 'shelter'] as const) {
  assert.ok(announcementFor(stage, 'Mati').body.endsWith(ANNOUNCE_LABEL));
}
assert.equal(shouldAnnounce(null, 'mati', 'leave'), false);
assert.equal(shouldAnnounce({ home: 'mati', stage: 'monitor' }, 'other', 'leave'), false);
assert.equal(shouldAnnounce({ home: 'mati', stage: 'leave' }, 'mati', 'prepare'), false);
assert.equal(shouldAnnounce({ home: 'mati', stage: 'prepare' }, 'mati', 'prepare'), false);
assert.equal(shouldAnnounce({ home: 'mati', stage: 'prepare' }, 'mati', 'leave'), true);
const home = { lon: 24, lat: 38 };
const pack = { manifest: { places: [{ id: 'mati', name: 'Mati', pos: home }, { id: 'far', name: 'Far', pos: { lon: 25, lat: 39 } }] } } as unknown as ScenarioPack;
const first: RevEntry = { t: 0, rev: 1, issuedAt: 0, rosMpm: 10, bands: [{ horizonMin: 180, polygon: [home, { lon: 24.01, lat: 38 }, { lon: 24, lat: 38.01 }] }], etaToPlaces: { mati: 90 * 60000 } };
const spread = { ...first, t: 60000, rev: 2, issuedAt: 60000, rosMpm: 13, etaToPlaces: { mati: 85 * 60000, far: 30 * 60000 } };
const log = [first, spread];
const before = alertFeed(pack, 60000);
assert.equal(fireUpdates(pack, 0, home, log).length, 1);
assert.deepEqual(fireUpdates(pack, 60000, home, log).map(r => r.text.split(' · ')[0]), ['NEW FIRE', 'FIRE SPREADING FASTER', 'FIRE ARRIVING EARLIER']);
assert.equal(fireUpdates(pack, 60000, null, log).length, 0);
assert.equal(fireUpdates(pack, 60000, { lon: 26, lat: 40 }, log).length, 0);
assert.equal(fireUpdates(pack, -1, home, log).length, 0);
assert.equal(fireUpdates(pack, 60000, home, []).length, 0);
const noEta = { ...first, etaToPlaces: {} };
assert.ok(fireUpdates(pack, 60000, home, [noEta, { ...spread, etaToPlaces: { mati: 61 * 60000 } }]).some(r => r.stage === 'leave'));
assert.equal(fireUpdates(pack, 60000, home, [first, { ...spread, rosMpm: 12, etaToPlaces: { mati: 86 * 60000 } }]).length, 1);
assert.deepEqual(alertFeed(pack, 60000), before);
assert.deepEqual(fireUpdates(pack, 0, home, log), fireUpdates(pack, 0, home, [first]));

let vibrations = 0, notifications = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: () => { vibrations++; }, serviceWorker: { getRegistration: async () => ({ showNotification: async (_title: string, options: NotificationOptions) => { assert.ok(options.body?.endsWith(ANNOUNCE_LABEL)); notifications++; } }) } } });
Object.defineProperty(globalThis, 'Notification', { configurable: true, value: class { static permission = 'granted'; } });
await deliverAnnouncement('leave', 'Mati', false);
assert.equal(vibrations, 1);
assert.equal(notifications, 1);
let narrations = 0;
Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: { speak: () => { narrations++; } } });
Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: class {} });
for (const permission of ['default', 'denied']) {
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: class { static permission = permission; } });
  await deliverAnnouncement('prepare', 'Mati', false);
  assert.equal(narrations, 0);
}
await deliverAnnouncement('prepare', 'Mati', true);
assert.equal(narrations, 1);
assert.equal(vibrations, 1);
assert.equal(notifications, 1);
Object.defineProperty(globalThis, 'Notification', { configurable: true, value: class { static permission = 'granted'; } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => { throw Error('unavailable'); } } } });
await deliverAnnouncement('leave', 'Mati', false);
delete (globalThis as { Notification?: unknown }).Notification;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: () => { vibrations++; } } });
await deliverAnnouncement('prepare', 'Mati', false);
assert.equal(vibrations, 1);
delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
const location = { href: 'https://fcc.test/console.html?appearance=light#map' };
const historyState = { exercise: true };
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  location, history: { state: historyState, replaceState: (state: unknown, _title: string, url: URL) => {
    assert.equal(state, historyState);
    location.href = url.href;
  } },
} });
for (const view of ['civilian', 'responder'] as const) {
  opsView.set(view);
  const url = new URL(location.href);
  assert.equal(url.searchParams.get('view'), view);
  assert.equal(url.searchParams.get('appearance'), 'light');
  assert.equal(url.hash, '#map');
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location, history: { replaceState: () => { throw Error('unavailable'); } } } });
opsView.set('civilian');
assert.equal(opsView.get(), 'civilian');
delete (globalThis as { window?: unknown }).window;
console.log('Resident announcements: labels, stage rises, revision rules, distance/seek filtering, unchanged alert feed and unavailable browser capabilities PASS');

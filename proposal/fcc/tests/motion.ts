import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FindingKind, Unit, UnitKind } from '../src/console/contracts';
import { UnitMotion, MOTION_DELAY_MS, angleDelta } from '../src/console/stage3d/motion';
import { CameraFilter, FeedCadence, fitFeedFrame } from '../src/console/stage3d/feeds/dynamics';
import { DEFAULT_MAP_SETTINGS, FINDING_LAYERS, UNIT_LAYERS, airUnitsOnly, basemapOnly, findingVisible,
  getMapSettings, parseMapSettings, resetMapSettings, setMapLayer, unitVisible } from '../src/console/stage3d/map-settings';
import { createBus } from '../src/console/bus';
import { loadScenario } from '../src/console/scenario';
import { createSim } from '../src/console/world/engine';
import { stepAircraft, flightEnvelope } from '../src/console/world/flight';
import { distanceM, destination } from '../src/console/world/geo';

const unit: Unit = { id: 'test', callsign: 'TEST', kind: 'drone', pos: { lon: 24, lat: 38, alt: 120 },
  heading: 0, speedMps: 18, status: 'active', trail: [] };
const motion = new UnitMotion();
const times = [0, 97, 211, 315, 430, 535, 641, 752, 860, 970];
for (const at of times) motion.update([{ ...unit, pos: { lon: 24 + at * 1e-6, lat: 38, alt: 120 }, heading: at / 10 }], at);
for (let at = 212; at < 750; at++) {
  const p = motion.position(unit, at + MOTION_DELAY_MS);
  assert.ok(Math.abs(p.lon - (24 + at * 1e-6)) < 1e-10, 'constant-speed interpolation stays constant');
}
for (const at of times.slice(2, -2)) {
  const sample = (d: number) => motion.position(unit, at + MOTION_DELAY_MS + d).lon;
  const left = (sample(0) - sample(-0.01)) / 0.01, right = (sample(0.01) - sample(0)) / 0.01;
  assert.ok(Math.abs(left - right) < 1e-9, 'velocity is continuous across packet boundaries');
}
const corners = new UnitMotion();
for (let i = 0; i < 8; i++) corners.update([{ ...unit, pos: { lon: [0, 1, 2, 2, 2, 1, 0, 0][i], lat: 0 }, heading: 0 }], i * 100);
for (let at = 0; at < 700; at++) {
  const i = Math.floor(at / 100), a = [0, 1, 2, 2, 2, 1, 0, 0];
  const value = corners.position(unit, at + MOTION_DELAY_MS).lon;
  assert.ok(value >= Math.min(a[i], a[i + 1]) - 1e-12 && value <= Math.max(a[i], a[i + 1]) + 1e-12, 'no corner/stop overshoot');
}
const wrap = new UnitMotion();
for (const [i, heading] of [357, 359, 1, 3].entries()) wrap.update([{ ...unit, heading }], i * 100);
assert.ok(Math.abs(angleDelta(wrap.heading(unit, 150 + MOTION_DELAY_MS), 0)) < 1e-8, '359→1 takes the short arc');
motion.update([{ ...unit, pos: { lon: -120, lat: 39 } }], 1000, true);
assert.equal(motion.position(unit, 1000).lon, -120, 'seek resets, never animates across the world');
assert.equal(motion.position(unit, 1e6).lon, -120, 'stale telemetry holds without extrapolation');
motion.update([], 1100);
assert.equal(motion.position(unit, 1200).lon, unit.pos.lon, 'removed tracks are released');
const stationary = new UnitMotion(), heldUnit = { ...unit, pos: { lon: 23.96303103081618, lat: 38.05047421706638 } };
for (const at of [0, 100, 200, 300]) stationary.update([heldUnit], at);
for (let at = 1; at < 300; at += 7) {
  assert.deepEqual(stationary.position(heldUnit, at + MOTION_DELAY_MS), { ...heldUnit.pos, alt: 0 }, 'constant GPS packets remain bitwise stationary');
}

const filter = new CameraFilter();
assert.deepEqual(fitFeedFrame(1600, 900), { left: 0, top: 0, width: 1600, height: 900 });
assert.deepEqual(fitFeedFrame(2000, 900), { left: 200, top: 0, width: 1600, height: 900 });
assert.deepEqual(fitFeedFrame(1600, 1100), { left: 0, top: 100, width: 1600, height: 900 });
const deg = Math.PI / 180;
filter.update({ heading: 359 * deg, pitch: -40 * deg, roll: 0, fovDeg: 45, position: 1 }, 0);
const filtered = filter.update({ heading: deg, pitch: -35 * deg, roll: 0, fovDeg: 30, position: 2 }, 33);
assert.equal(filtered.position, 2, 'gimbal filter must not freeze the carrier position');
assert.ok(angleDelta(359, filtered.heading / deg) > 0 && angleDelta(359, filtered.heading / deg) < 2);
assert.ok(filtered.fovDeg > 30 && filtered.fovDeg < 45);
assert.equal(filter.update({ heading: 2, pitch: -1, roll: 0, fovDeg: 60 }, 2000).heading, 2, 'reacquisition resets stale lens state');
const pausedLens = new CameraFilter();
pausedLens.update({ heading: 0, pitch: 0, roll: 0, fovDeg: 45 }, 0);
let settled = { heading: 0, pitch: 0, roll: 0, fovDeg: 45 };
for (let i = 1; i <= 210; i++) {
  settled = pausedLens.update({ heading: Math.PI, pitch: 0, roll: 0, fovDeg: 45 }, i * 1000 / 60);
}
assert.ok(Math.abs(angleDelta(settled.heading / deg, 180)) * deg < 0.0001, 'worst-case paused gimbal settles within the derived 3.5 s slew/filter bound');
const cadence = new FeedCadence(), frames: number[] = [];
for (let i = 0; i < 360; i++) if (cadence.due(i * 1000 / 60)) frames.push(i * 1000 / 60);
assert.ok(frames.length >= 179 && frames.length <= 181, '30 fps, not the former 20 fps timer alias');
assert.ok(frames.slice(1).every((t, i) => t - frames[i] < 34));
assert.equal(cadence.due(8000), true);
assert.equal(cadence.due(8001), false, 'no catch-up burst after a stall');

assert.equal(parseMapSettings({ layers: { fire: false } }).layers.perimeter, false, 'old hidden fire preference keeps perimeter hidden');
assert.equal(parseMapSettings({ layers: { fire: false, perimeter: true } }).layers.perimeter, true);
for (const [kind, key] of Object.entries(UNIT_LAYERS) as [UnitKind, keyof typeof DEFAULT_MAP_SETTINGS.layers][]) {
  const layers = { ...DEFAULT_MAP_SETTINGS.layers, [key]: false };
  assert.equal(unitVisible(layers, kind), false);
  assert.equal(unitVisible({ ...layers, units: false }, kind), false);
}
for (const [kind, key] of Object.entries(FINDING_LAYERS) as [FindingKind, keyof typeof DEFAULT_MAP_SETTINGS.layers][]) {
  assert.equal(findingVisible({ ...DEFAULT_MAP_SETTINGS.layers, [key]: false }, kind), false);
}
setMapLayer('people', false); airUnitsOnly();
assert.equal(getMapSettings().layers.people, false, 'presets preserve child preferences');
assert.equal(unitVisible(getMapSettings().layers, 'drone'), true);
assert.equal(unitVisible(getMapSettings().layers, 'crew'), false);
basemapOnly();
assert.ok(['units', 'findings', 'fire', 'perimeter', 'actions', 'coverage', 'projection'].every(k => !getMapSettings().layers[k as keyof typeof DEFAULT_MAP_SETTINGS.layers]));
resetMapSettings();

const root = resolve(process.cwd(), 'public');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${String(url)}`);
  assert.ok(path.startsWith(`${root}/`));
  try { return new Response(readFileSync(path)); } catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;
for (const id of ['mati-2018', 'caldor-2021'] as const) {
  const pack = await loadScenario(id), sim = createSim(pack, createBus(), { intro: false });
  let samples = 0;
  for (const u of sim.units.filter(u => ['drone', 'helo', 'tanker'].includes(u.kind))) {
    const meta = sim.umeta.get(u.id)!, env = flightEnvelope(u.kind);
    // Deliberately undersized orbit and a moving mission centre exercise the former teleport paths.
    meta.plan = { mode: 'orbit', center: destination(u.pos, 90, 800), radiusM: 40, ang: 0 };
    meta.altAGL = (u.pos.alt ?? 120) + 100;
    for (let i = 0; i < 720; i++) {
      if (i === 360 && meta.plan.mode === 'orbit') meta.plan.center = destination(meta.plan.center, 270, 1200);
      const previous = { ...u.pos }, heading = u.heading, speed = u.speedMps;
      stepAircraft(sim, u, meta, 0.5);
      assert.ok(distanceM(previous, u.pos) <= (speed + u.speedMps) * 0.25 + 0.001, 'no orbit-entry/retarget teleport');
      assert.ok(Math.abs(u.speedMps - speed) <= env.accel * 0.5 + 1e-9, 'bounded acceleration');
      assert.ok(Math.abs(angleDelta(heading, u.heading)) <= env.yaw * 0.5 + 1e-9, 'bounded turn rate');
      assert.ok(Math.abs(angleDelta(heading, u.heading)) * deg / 0.5 * u.speedMps <= env.lateral + 1e-6, 'bank/lateral-acceleration bound');
      assert.ok(Math.abs((u.pos.alt ?? 0) - (previous.alt ?? 0)) <= env.climb * 0.5 + 1e-8);
      if (u.kind === 'tanker') assert.ok(u.speedMps >= 45, 'fixed wing cannot hover');
      samples++;
    }
    meta.plan = { mode: 'hold' };
    for (let i = 0; i < 120; i++) stepAircraft(sim, u, meta, 0.5);
    assert.ok(u.kind === 'tanker' ? u.speedMps >= 45 : u.speedMps < 0.01, 'loiter versus hover/stop behavior');
  }
  console.log(`${id}: ${samples} aircraft steps, acceleration/turn/climb limits, orbit entry, retarget and holds PASS`);
}
console.log('Motion: C1 packet interpolation, angle wrap, no overshoot, stale/reset, camera isolation, 30 Hz cadence and granular preferences PASS');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBus } from '../src/console/bus';
import { loadScenario } from '../src/console/scenario';
import { contextFor } from '../src/console/world/engine';
import { Runtime } from '../src/console/world/runtime';

const root = resolve('public');
globalThis.fetch = (async (url: string | URL) => {
  const path = resolve(root, '.' + String(url));
  assert.ok(path.startsWith(root + '/'));
  try { return new Response(readFileSync(path)); } catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;
const MIN = 60000;
const pack = await loadScenario('mati-2018'), ctx = contextFor(pack);
const at = (hhmm: number) => ctx.start + (hhmm - 14) * 60 * MIN;

type Picture = { units: { id: string; lon: number; lat: number; alt: number; battery: number | undefined; status: string }[]; events: string[]; drones: string };
const picture = (rt: Runtime): Picture => ({
  units: rt.sim.units.map(u => ({ id: u.id, lon: u.pos.lon, lat: u.pos.lat, alt: u.pos.alt ?? 0, battery: u.battery, status: u.status })),
  events: rt.sim.recon!.events.map(e => e.id),
  drones: JSON.stringify(rt.sim.recon!.drones.map(d => [d.unitId, d.phase, d.sorties])),
});
function same(a: Picture, b: Picture, label: string) {
  assert.deepEqual(b.events, a.events, `${label}: alert history`);
  assert.equal(b.drones, a.drones, `${label}: station lifecycle`);
  for (const [i, u] of a.units.entries()) {
    const v = b.units[i]!;
    assert.equal(v.id, u.id);
    assert.ok(Math.abs(v.lon - u.lon) < 1e-6 && Math.abs(v.lat - u.lat) < 1e-6, `${label}: ${u.id} position ${u.lon},${u.lat} vs ${v.lon},${v.lat}`);
    assert.ok(Math.abs(v.alt - u.alt) < 1e-3, `${label}: ${u.id} altitude`);
    assert.ok(Math.abs((v.battery ?? 0) - (u.battery ?? 0)) < 1e-9, `${label}: ${u.id} battery`);
    assert.equal(v.status, u.status, `${label}: ${u.id} status`);
  }
}

// Continuous play at the default speed with uneven rAF frame lengths, landing exactly on each probe.
const played = new Runtime(pack, createBus(), { profile: 'recon' });
const frames = [0.1, 0.13, 0.1, 0.25, 0.11, 0.1, 0.17];
const probes = [at(16), at(17)];
const truth: Picture[] = [];
let f = 0;
for (const probe of probes) {
  while (played.sim.t + played.sim.carryMs < probe - 1e-3) {
    const need = (probe - played.sim.t - played.sim.carryMs) / 1000 / played.sim.speed;
    played.tick(Math.min(frames[f++ % frames.length]!, need));
  }
  assert.equal(played.sim.t, probe);
  truth.push(picture(played));
}

const seeked = new Runtime(pack, createBus(), { profile: 'recon' });
const timings: number[] = [];
for (const t of [at(19), at(16), at(17)]) {
  const t0 = performance.now();
  seeked.seek(t);
  timings.push(performance.now() - t0);
  assert.equal(seeked.sim.t, t);
  if (t === at(16)) same(truth[0]!, picture(seeked), 'seek 19:00 -> 16:00');
}
same(truth[1]!, picture(seeked), 'seek 16:00 -> 17:00');
seeked.seek(at(16));
same(truth[0]!, picture(seeked), 'seek 17:00 -> 16:00');
console.log(`Rewind determinism: seek 19:00 -> 16:00 -> 17:00 matches continuous play (positions <1e-6 deg, battery, status, ${truth[1]!.events.length} alerts); seek ms ${timings.map(t => t.toFixed(0)).join('/')} PASS`);

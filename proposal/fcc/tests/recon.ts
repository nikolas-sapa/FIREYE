import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBus } from '../src/console/bus';
import type { Projection } from '../src/console/contracts';
import { loadScenario } from '../src/console/scenario';
import { contextFor, createSim, fastForward } from '../src/console/world/engine';
import { Runtime } from '../src/console/world/runtime';
import { projectionDeterioration, tickRecon } from '../src/console/world/recon';
import { answer } from '../src/console/orchestrator/conversation';
import { mapPatch, VIS_PRESETS } from '../src/console/fireye/shell/ui';
import { distanceM } from '../src/console/world/geo';
import { sourceFlow } from '../src/console/fireye/data/source-flow';
import { snapshot } from '../src/console/world/engine';
import { CHARGE_SECONDS, FLIGHT_SECONDS, stepReconDrone } from '../src/console/world/drone-stations';
import { orderFeedsByRelevance } from '../src/console/fireye/data/feed-order';

const root = resolve('public');
globalThis.fetch = (async (url: string | URL) => {
  const path = resolve(root, '.' + String(url));
  assert.ok(path.startsWith(root + '/'));
  try { return new Response(readFileSync(path)); } catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;
const MIN = 60000;
const pack = await loadScenario('mati-2018'), ctx = contextFor(pack);
const bus = createBus(4000);
const sim = createSim(pack, bus, { profile: 'recon', intro: false });
assert.equal(sim.t, ctx.start);
assert.equal(sim.units.length, 6);
assert.ok(sim.units.every(u => u.kind === 'drone' && !u.route && u.trail.length === 0));
assert.equal(sim.feeds.length, 20, '12 drone channels plus eight fixed cameras');
for (const unit of sim.units) {
  const channels = sim.feeds.filter(f => f.unitId === unit.id);
  assert.equal(channels.length, 2);
  assert.deepEqual(channels.map(f => f.modality).sort(), ['eo', 'thermal']);
  assert.equal(new Set(channels.map(f => f.id)).size, 2);
}
assert.equal(sim.feeds.filter(f => f.kind === 'ridge-cam').length, 8);
assert.ok(sim.feeds.every(f => f.kind.startsWith('uav-') || f.kind === 'ridge-cam'));
assert.equal(sim.actions.length, 0);
const ranked = orderFeedsByRelevance([
  { ...sim.feeds[0], id: 'offline', live: false, offlineReason: 'Charging', relevance: 100 },
  { ...sim.feeds[0], id: 'low', live: true, offlineReason: undefined, relevance: 60 },
  { ...sim.feeds[0], id: 'high-b', live: true, offlineReason: undefined, relevance: 63 },
  { ...sim.feeds[0], id: 'high-a', live: true, offlineReason: undefined, relevance: 63 },
]);
assert.deepEqual(ranked.map(f => f.id), ['high-a', 'high-b', 'low', 'offline'], 'single-row ranking uses exact relevance, stable ties and available video before offline reserves');
assert.equal(sim.recon!.stations.length, 2);
assert.ok(distanceM(sim.recon!.stations[0].pos, sim.recon!.stations[1].pos) > 4000);
assert.equal(sim.recon!.tasks.length, 2, 'only a couple of drones launch initially');
assert.equal(new Set(sim.recon!.tasks.map(t => t.cellId)).size, 2, 'drones cover different blind spots');
assert.equal(sim.recon!.drones.filter(d => d.phase === 'docked').length, 4);
for (const d of sim.recon!.drones) {
  const station = sim.recon!.stations.find(s => s.id === d.stationId)!;
  const unit = sim.units.find(u => u.id === d.unitId)!;
  assert.equal(distanceM(unit.pos, station.pos), 0, 'all drones spawn on a station pad');
  assert.equal(unit.pos.alt, 0);
  assert.equal(unit.battery, 1);
}
assert.ok(sim.recon!.tasks.every(t => t.sourceIds?.includes('iot') && /sensitivity/.test(t.reason)));
assert.ok(sim.feeds.filter(f => f.unitId).every(f => !f.live && f.offlineReason), 'on-pad feeds cut off');
assert.equal(sim.recon!.events.filter(e => e.tasking).length, 2, 'opening movement commands are visible agent updates');
const blindPack = { ...pack, arrival: pack.arrival.map(() => Infinity) };
const blindStart = createSim(blindPack, createBus(), { profile: 'recon', intro: false });
assert.deepEqual(blindStart.recon!.tasks, sim.recon!.tasks, 'initial sensitivity patrol does not consult future fire arrivals');
assert.ok(sim.recon!.events.every(e => e.severity === 'info'), 'routine assignments never interrupt');

for (const preset of Object.values(VIS_PRESETS)) {
  const layers = mapPatch(preset);
  for (const key of ['helicopters', 'airplanes', 'engines', 'crews', 'dozers', 'ems', 'law', 'trails', 'actions', 'altitudeStems'] as const) {
    assert.equal(layers[key], false, `${key} cannot return via a visibility preset`);
  }
}

// Real movement, task completion, repeated assignments, and the entire exercise window.
let checkpoints = 0, detected = false, maxActive = 0, minBattery = 1;
const phases = new Set<string>(sim.recon!.drones.map(d => d.phase)), patterns = new Set<string>();
const previous = new Map(sim.units.map(u => [u.id, { battery: u.battery!, phase: sim.recon!.drones.find(d => d.unitId === u.id)!.phase }]));
fastForward(sim, ctx.end, { speed: 600, dtReal: 0.1, onStep: (s) => {
  assert.equal(s.actions.length, 0, 'no dispatch/approval decisions are created');
  assert.ok(s.units.every(u => u.kind === 'drone' && !u.route && !u.trail.length));
  assert.ok(s.feeds.every(f => f.kind.startsWith('uav-') || f.kind === 'ridge-cam'));
  const active = s.recon!.tasks.filter(t => t.status === 'enroute' || t.status === 'observing');
  maxActive = Math.max(maxActive, active.length);
  for (const task of s.recon!.tasks) patterns.add(task.pattern!);
  for (const d of s.recon!.drones) {
    phases.add(d.phase);
    const u = s.units.find(u => u.id === d.unitId)!, prev = previous.get(u.id)!;
    const feed = s.feeds.find(f => f.unitId === u.id)!;
    minBattery = Math.min(minBattery, u.battery!);
    assert.ok(u.battery! >= 0 && u.battery! <= 1);
    if (d.phase === 'docked' || d.phase === 'charging') {
      assert.ok(!feed.live && feed.offlineReason, 'no live, archive or generated video on a pad');
      assert.equal(u.pos.alt, 0);
      assert.ok(distanceM(u.pos, s.umeta.get(u.id)!.home) < 1);
      assert.equal(u.taskId, undefined);
    }
    if (u.battery! > prev.battery + 1e-8) assert.ok(d.phase === 'charging' || d.phase === 'docked' || prev.phase === 'charging', 'battery gain requires a pad interval, including charge-to-launch transitions');
    previous.set(u.id, { battery: u.battery!, phase: d.phase });
  }
  assert.equal(new Set(active.map(t => t.unitId)).size, active.length, 'one active task per drone');
  assert.equal(new Set(active.map(t => t.cellId)).size, active.length, 'no duplicate active blind spots');
  assert.ok(s.recon!.events.every(e => e.t <= s.t && !e.decision));
  detected ||= s.recon!.events.some(e => e.severity === 'critical' && e.kind === 'detection');
  checkpoints++;
} });
assert.ok(sim.recon!.tasks.some(t => t.status === 'complete'), 'drones actually reach and observe targets');
assert.ok(sim.ledger.droneTasksIssued > 6, 'completed scans yield new assignments');
assert.ok(detected, 'a new fire is an important alert');
assert.ok(maxActive > 2, 'fire demand scales up the opening two-drone patrol');
assert.ok(minBattery > 0.05, `return reserves prevent depletion (minimum ${minBattery})`);
for (const phase of ['launching', 'enroute', 'observing', 'returning', 'landing', 'charging', 'docked']) assert.ok(phases.has(phase), `actual ${phase} lifecycle reached`);
assert.deepEqual([...patterns].sort(), ['circle', 'hover', 'line', 'square']);
assert.ok(sim.recon!.drones.every(d => d.sorties >= 2), 'drones relaunch after returning and recharging');

// Independently check the physical time rates, not only sampled end states of minute-long steps.
const energy = createSim(pack, createBus(), { profile: 'recon', intro: false });
const ed = energy.recon!.drones[0], eu = energy.units[0], em = energy.umeta.get(eu.id)!;
ed.phase = 'observing'; eu.taskId = undefined; eu.battery = 0.8; eu.pos.alt = 90; em.plan = { mode: 'hold' };
stepReconDrone(energy, eu, em, 0.5);
assert.ok(Math.abs(eu.battery - (0.8 - 0.5 / FLIGHT_SECONDS)) < 1e-12, 'airborne drain uses elapsed flight time');
ed.phase = 'charging'; eu.battery = 0.4;
stepReconDrone(energy, eu, em, 0.5);
assert.ok(Math.abs(eu.battery - (0.4 + 0.5 / CHARGE_SECONDS)) < 1e-12, 'recharge uses elapsed on-pad time');
ed.phase = 'docked'; eu.battery = 1;
stepReconDrone(energy, eu, em, 0.5);
assert.equal(eu.battery, 1, 'reserve drones do not drain or overcharge');
assert.ok(!bus.history().some(e => e.type === 'action.proposed' || e.type === 'action.decided'));
assert.match(answer(sim, 'Dispatch engines and approve evacuation').text, /only coordinate simulated drone reconnaissance/i);
assert.doesNotMatch(answer(sim, 'What should the drones do?').text, /approve|dispatch|evacuat/i);

const previousProjection: Projection = { rev: 1, issuedAt: 100 * MIN, rosMpm: 10, headDirDeg: 90, bands: [], drivers: [], etaToPlaces: { mati: 160 * MIN } };
assert.equal(projectionDeterioration(previousProjection, { ...previousProjection, rev: 2, issuedAt: 110 * MIN }), null, 'a shrinking countdown is not forecast deterioration');
assert.equal(projectionDeterioration(previousProjection, { ...previousProjection, rev: 2, rosMpm: 11 }), null, 'small forecast noise is quiet');
assert.match(projectionDeterioration(previousProjection, { ...previousProjection, rev: 2, rosMpm: 14 })!, /accelerated/);
assert.match(projectionDeterioration(previousProjection, { ...previousProjection, rev: 2, issuedAt: 110 * MIN, etaToPlaces: { mati: 150 * MIN } })!, /10 minutes earlier/);
assert.match(projectionDeterioration(previousProjection, { ...previousProjection, rev: 2, issuedAt: 110 * MIN, etaToPlaces: { coast: 150 * MIN } })!, /now reaches/);

// Duplicate revisions and repeated observations cannot generate repeated fire alerts.
const before = sim.recon!.events.length;
tickRecon(sim); tickRecon(sim);
assert.equal(sim.recon!.events.length, before);

const runtime = new Runtime(pack, createBus(), { profile: 'recon' });
const target = ctx.tDetect + 50 * MIN;
runtime.seek(target);
const saved = JSON.stringify({ tasks: runtime.sim.recon!.tasks, events: runtime.sim.recon!.events, units: runtime.sim.units });
const savedLifecycle = JSON.stringify(runtime.sim.recon!.drones);
const state = snapshot(runtime.sim, null, true, pack);
const flow = sourceFlow(state, null, 'terrain');
assert.ok(flow.some(e => e.stage === 'orchestrator'), 'source flow shows actual source-linked task decisions');
assert.ok(flow.every(e => e.t <= state.clock.t));
assert.ok(sourceFlow(state, null, 'radio').every(e => e.stage !== 'orchestrator' && e.stage !== 'execution'), 'unlinked radio analysis must not fabricate a command chain');
assert.ok(sourceFlow({ ...state, clock: { ...state.clock, t: ctx.start } }, null, 'terrain').every(e => e.t <= ctx.start));
runtime.seek(ctx.start + 20 * MIN);
assert.ok(runtime.sim.recon!.events.every(e => e.t <= runtime.sim.t));
runtime.seek(target);
assert.equal(JSON.stringify({ tasks: runtime.sim.recon!.tasks, events: runtime.sim.recon!.events, units: runtime.sim.units }), saved, 'seek round trip reproduces missions, alerts and positions');
assert.equal(JSON.stringify(runtime.sim.recon!.drones), savedLifecycle, 'station, charge and sortie state reproduce after a seek');
console.log(`FIREYE reconnaissance: 20 registered channels / 14 physical sources, two stations, staged tasking, four flight patterns, safe recharge/relaunch, source-flow provenance and seek identity (${checkpoints} steps, min battery ${(minBattery * 100).toFixed(1)}%) PASS`);

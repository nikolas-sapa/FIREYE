import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario, weatherAt } from '../src/console/scenario';
import { createBus } from '../src/console/bus';
import { isBusEvent } from '../src/console/bus/adapters';
import { Runtime } from '../src/console/world/runtime';
import { ops } from '../src/console/world/engine';
import { runSpread, runTravelTime, SpreadSeeds, headRos, fineFuelMoisture } from '../src/console/agents/spread';
import { FuelClass } from '../src/console/contracts';
import { emitDirective } from '../src/console/orchestrator/directives';

// Solver regression: on uniform flat shrub the head must advance at exactly the head rate downwind
// (a float32/float64 stale-entry bug once stalled the front), and stronger wind must burn more.
{
  const N = 256, fuel = new Uint8Array(N * N).fill(FuelClass.Shrub), elev = new Float32Array(N * N);
  const solve = (windKph: number, horizonMin = 360) => {
    const seeds = new SpreadSeeds(); seeds.push(128 * N + 32, 0);
    return runTravelTime({ gw: N, gh: N, dxM: 40, dyM: 40, fuel, elev, horizonMin, weatherAt: () => ({ windKph, windDirDeg: 270, tempC: 32, rh: 20 }) }, seeds);
  };
  for (const kph of [10, 30, 60]) {
    const [ros] = headRos(FuelClass.Shrub, kph, fineFuelMoisture(32, 20));
    const t = solve(kph);
    for (const d of [1, 7, 20, 50]) assert.ok(Math.abs(t[128 * N + 32 + d] - (d * 40) / ros) < 1e-3 * d + 1e-3, `head at ${d} cells, ${kph} km/h`);
  }
  // Area grows with wind only while the 16-neighbour stencil can resolve the ellipse (LB below about 3);
  // above roughly 30 km/h it under-represents narrow fires (PROJECTION.md, known limitations).
  const area = (t: Float32Array) => t.reduce((n, v) => n + (v <= 60 ? 1 : 0), 0);
  assert.ok(area(solve(30, 60)) > area(solve(10, 60)) && area(solve(10, 60)) > area(solve(5, 60)), 'stronger wind burns more');
  console.log('Spread solver head rate and wind monotonicity PASS');

  const fractionalSeeds = new SpreadSeeds();
  fractionalSeeds.push(0, 0.50001151);
  fractionalSeeds.push(0, 3);
  const fractional = runTravelTime({ gw: 3, gh: 1, dxM: 1, dyM: 1,
    fuel: new Uint8Array(3).fill(FuelClass.Grass), elev: new Float32Array(3), horizonMin: 10,
    weatherAt: () => ({ windKph: 0, windDirDeg: 0, tempC: 30, rh: 20 }) }, fractionalSeeds);
  assert.equal(fractional[0], Math.fround(0.50001151));
  assert.ok([...fractional].every(Number.isFinite), 'Fractional seeds must expand despite Float32 rounding');
  const lateSeed = new SpreadSeeds();
  lateSeed.push(0, 11);
  assert.ok([...runTravelTime({ gw: 1, gh: 1, dxM: 1, dyM: 1, fuel: new Uint8Array([3]),
    elev: new Float32Array(1), horizonMin: 10, weatherAt: () => ({ windKph: 0, windDirDeg: 0, tempC: 30, rh: 20 }) }, lateSeed)]
    .every(t => t === Infinity), 'A seed beyond the horizon is not a finite arrival');
}
assert.equal(isBusEvent({ type: 'prediction.scored', at: 0 }), true);
assert.equal(isBusEvent({ type: 'prediction.scored', at: Infinity }), false);
assert.equal(isBusEvent({ type: 'prediction.scored', at: NaN }), false);

// Load the same committed files used by the browser, with no network/provider calls.
const root = resolve(process.cwd(), 'public');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${String(url)}`);
  assert.ok(path.startsWith(`${root}/`));
  try {
    const b = readFileSync(path);
    return new Response(b, { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

for (const id of ['mati-2018', 'caldor-2021'] as const) {
  const pack = await loadScenario(id);
  const rt = new Runtime(pack, createBus(), {});
  assert.equal(rt.sim.feeds.find((f) => f.kind === 'satellite')?.live, false, 'archived imagery is not live');
  assert.ok(rt.sim.feeds.filter((f) => f.kind === 'ridge-cam').every((f) => Number.isFinite(f.pose.pitchDeg)));
  if (id === 'mati-2018') assert.ok(rt.sim.feeds.filter((f) => f.kind === 'ridge-cam').every((f) => (f.pose.pitchDeg ?? 0) < -5), 'ridge cameras aim down from the mountain');
  const approved: string[] = [];
  rt.bus.subscribe((e) => {
    if (e.type === 'action.decided' && e.status === 'approved') approved.push(e.actionId);
  });
  rt.director.start();
  let maxZ0 = 0;
  let worstTick = 0;
  for (let n = 0; n < 1900; n++) {
    const start = performance.now();
    rt.tick(0.1);
    worstTick = Math.max(worstTick, performance.now() - start);
    maxZ0 = Math.max(maxZ0, rt.sim.items.filter((i) => i.zone === 'Z0_INTERRUPT').length);
    assert.ok(maxZ0 <= 1, 'at most one interrupt');
    assert.ok(rt.sim.actions.filter((a) => a.requiresApproval).every((a) => a.status === 'proposed' || a.status === 'rejected'), 'no timed human approvals');
  }
  assert.equal(approved.length, 0);
  assert.ok(rt.sim.predictions.some((p) => p.status === 'scored'));
  console.log(id, '190 s no-input tour PASS', { maxZ0, worstTickMs: +worstTick.toFixed(1) });
  console.log('scored', JSON.stringify(rt.sim.predictions.filter((p) => p.status === 'scored').map((p) => ({
    id: p.id, iou: p.iou, predictedHa: p.areaPredHa, replayHa: p.areaActualHa,
    checkpoints: p.checkpoints.map((c) => ({ id: c.id, errorMin: c.errorMin })),
  }))));
  for (let i = 0; i < 6; i++) {
    rt.director.goto(i);
    assert.equal(rt.sim.director.beat, i);
    assert.ok(rt.sim.items.filter((x) => x.zone === 'Z0_INTERRUPT').length <= 1);
    assert.ok(rt.sim.actions.filter((a) => a.requiresApproval).every((a) => a.status === 'proposed' || a.status === 'rejected'));
  }
  rt.director.goto(2);
  const draft = rt.sim.actions.find((a) => a.requiresApproval && a.status === 'proposed');
  assert.ok(draft, 'high-risk draft exists');
  ops.approve(rt.sim, draft.id, 'user');
  assert.notEqual(rt.sim.actions.find((a) => a.id === draft.id)?.status, 'proposed');
  assert.ok(rt.sim.actions.filter((a) => a.requiresApproval && a.id !== draft.id).every((a) => a.status === 'proposed' || a.status === 'rejected'), 'one click approves only one draft');

  // A counterfactual future must not change the issue-time forecast.
  const issue = rt.sim.ctx.tDetect;
  const cutoff = issue - pack.manifest.start;
  const altered = { ...pack, arrival: pack.arrival.map((a) => a > cutoff ? NaN : a), perimeters: [], hotspots: [], checkpoints: [], reports: [] };
  const wx = (t: number) => weatherAt(pack, t);
  const a = runSpread(pack, issue, wx);
  const b = runSpread(altered, issue, wx);
  assert.deepEqual(a.t, b.t, 'future fire data cannot affect forecast');
  ops.setHoldLayout(rt.sim, true);
  const before = { ...rt.sim.stage };
  const held = emitDirective(rt.sim, { kind: 'focusStage', target: pack.manifest.center, rangeM: 1500, reason: 'Hold regression' });
  assert.equal(held.suggested, true);
  assert.deepEqual(rt.sim.stage, before);
  ops.applyDirective(rt.sim, held.id);
  const applied = rt.sim.directives[0];
  assert.notEqual(applied.id, held.id);
  assert.equal(applied.suggested, false);
  assert.ok(!rt.sim.pending.some((d) => d.id === held.id));
  console.log(id, 'all beats, approval isolation, future-fire independence and hold/apply PASS');
}

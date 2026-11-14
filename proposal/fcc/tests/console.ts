import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario, weatherAt } from '../src/console/scenario';
import { createBus } from '../src/console/bus';
import { isBusEvent } from '../src/console/bus/adapters';
import { Runtime } from '../src/console/world/runtime';
import { ops } from '../src/console/world/engine';
import { runSpread } from '../src/console/agents/spread';
import { emitDirective } from '../src/console/orchestrator/directives';

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

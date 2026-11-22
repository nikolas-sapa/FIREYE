import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planDispatch, SWEEP_DEFAULTS, type DispatchParams } from '../src/sim/dispatch';

type Expected = ReturnType<typeof planDispatch>;
interface ParityCase {
  name: string;
  point: [number, number];
  bases: { id: string; xKm: number; yKm: number; available: boolean }[];
  params?: Partial<DispatchParams>;
  expected: Expected;
}
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/sweep-dispatch-parity.json'), 'utf8'),
) as { source: { commit: string; research_py_sha256: string }; defaults: DispatchParams; cases: ParityCase[] };

assert.equal(fixture.source.commit, '66bb3c9f72f0a820c79eb2b495fc80a4ce1a4da6', 'fixture records the wildfire-sweep commit');
assert.ok(fixture.cases.length >= 40, 'at least 40 parity cases');

const statuses = new Set<string>();
const reasons = new Set<string>();
let finiteCompared = 0;
for (const c of fixture.cases) {
  const got = planDispatch(
    { xKm: c.point[0], yKm: c.point[1] },
    c.bases,
    c.params,
  );
  const exp = c.expected;
  const close = (a: number | null, b: number | null, field: string) => {
    if (a == null || b == null) assert.equal(a, b, `${c.name}.${field}: null mismatch`);
    else { assert.ok(Math.abs(a - b) <= 1e-6, `${c.name}.${field}: ${a} vs ${b}`); finiteCompared++; }
  };
  assert.equal(got.status, exp.status, `${c.name}.status`);
  assert.equal(got.selectedBaseId, exp.selectedBaseId, `${c.name}.selectedBaseId`);
  close(got.responseS, exp.responseS, 'responseS');
  assert.equal(got.within15min, exp.within15min, `${c.name}.within15min`);
  close(got.usableAirborneS, exp.usableAirborneS, 'usableAirborneS');
  assert.equal(got.candidates.length, exp.candidates.length, `${c.name}.candidates.length`);
  for (let i = 0; i < got.candidates.length; i++) {
    const g = got.candidates[i]!, e = exp.candidates[i]!;
    assert.equal(g.baseId, e.baseId, `${c.name}.candidates[${i}].baseId`);
    close(g.outboundS, e.outboundS, `candidates[${i}].outboundS`);
    close(g.returnS, e.returnS, `candidates[${i}].returnS`);
    close(g.airborneS, e.airborneS, `candidates[${i}].airborneS`);
    close(g.arrivalS, e.arrivalS, `candidates[${i}].arrivalS`);
    assert.equal(g.flightOk, e.flightOk, `${c.name}.candidates[${i}].flightOk`);
    assert.equal(g.batteryOk, e.batteryOk, `${c.name}.candidates[${i}].batteryOk`);
    assert.equal(g.eligible, e.eligible, `${c.name}.candidates[${i}].eligible`);
    assert.equal(g.reason, e.reason, `${c.name}.candidates[${i}].reason`);
    reasons.add(g.reason);
  }
  statuses.add(got.status);
}

assert.equal(SWEEP_DEFAULTS.dwellS, fixture.defaults.dwellS, 'dwell default matches sweep CONFIG');
assert.ok(finiteCompared > 100, `compared ${finiteCompared} finite times`);
assert.deepEqual([...statuses].sort(), ['battery_rejected', 'flight_rejected', 'served', 'weather_rejected'], 'all statuses covered');
assert.deepEqual([...reasons].sort(), ['battery', 'eligible', 'flight', 'offline', 'weather'], 'all reasons covered');
console.log(`sweep dispatch parity: ${fixture.cases.length} cases, ${finiteCompared} finite times within 1e-6 s PASS`);

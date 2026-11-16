import assert from 'node:assert/strict';
import { daylight, sunPosition } from '../src/console/stage3d/sun';

// Minimal DOM so the appearance module runs its browser path; rAF is pumped by hand.
type MQ = { matches: boolean; listeners: (() => void)[]; addEventListener(e: string, fn: () => void): void };
const mq = (matches: boolean): MQ => ({ matches, listeners: [], addEventListener(_e, fn) { this.listeners.push(fn); } });
const media = { light: mq(false), reduce: mq(false) };
const props = new Map<string, string>();
const dataset: Record<string, string> = {};
let now = 0;
let queue: ((t: number) => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.document = {
  documentElement: { dataset, style: { setProperty: (k: string, v: string) => props.set(k, v), colorScheme: '' } },
  querySelector: () => null,
};
g.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
g.location = { search: '' };
g.matchMedia = (q: string) => (q.includes('reduced') ? media.reduce : media.light);
g.addEventListener = () => undefined;
g.requestAnimationFrame = (fn: (t: number) => void) => { queue.push(fn); return queue.length; };
g.cancelAnimationFrame = () => { queue = []; };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const pump = (ms: number) => {
  let frames = 0;
  for (let t = 0; t < ms && queue.length; t += 16) {
    now += 16;
    const q = queue; queue = [];
    q.forEach((fn) => fn(now));
    frames++;
  }
  return frames;
};

const A = await import('../src/design-system/tokens/appearance');
const repaints: number[] = [];
A.onDaylightRender((b) => repaints.push(b));
const view = A.claimSolarDaylight();
const lat = 38.04, lon = 23.96;
const at = (iso: string) => daylight(sunPosition(Date.parse(iso), lat, lon).elDeg);

// Day → twilight → night seeks, each animated, with a repaint notification on every frame.
const steps = [['2018-07-23T11:00:00Z', 'light'], ['2018-07-23T17:40:00Z', null], ['2018-07-23T19:00:00Z', 'dark']] as const;
for (const [iso, mode] of steps) {
  repaints.length = 0;
  view.set(at(iso));
  const frames = pump(5000);
  assert.ok(Math.abs(A.getDaylightBlend() - at(iso)) < 1e-3, `${iso}: blend reaches the solar value`);
  if (frames > 1) assert.ok(repaints.length >= frames - 1, `${iso}: the globe is told to repaint during the transition`);
  if (mode) assert.equal(dataset.colorMode, mode);
}
assert.ok(at('2018-07-23T17:40:00Z') > 0 && at('2018-07-23T17:40:00Z') < 1, 'twilight is a partial blend');
console.log('Appearance follows day, twilight and night seeks with per-frame repaint PASS');

// Keyed remount: the incoming view claims before the outgoing view's cleanup runs.
const outgoing = A.claimSolarDaylight();
outgoing.set(1);
pump(5000);
const incoming = A.claimSolarDaylight();
incoming.set(0);
outgoing.release();
pump(5000);
assert.equal(A.getDaylightBlend(), 0, 'late cleanup of the old view does not clear the new value');
incoming.release();
view.release();

// Manual overrides win over the solar claim; Auto returns to it.
const c = A.claimSolarDaylight();
c.set(0);
pump(5000);
A.setAppearance('light', { persist: false }); pump(5000);
assert.equal(A.getDaylightBlend(), 1);
A.setAppearance('dark', { persist: false }); pump(5000);
assert.equal(A.getDaylightBlend(), 0);
c.set(1); pump(5000);
assert.equal(A.getDaylightBlend(), 0, 'manual Dark ignores daylight');
A.setAppearance('auto', { persist: false }); pump(5000);
assert.equal(A.getDaylightBlend(), 1, 'Auto follows the claim again');

// A fixed-dark surface can mount over saved Light without an animated light-to-dark interval.
A.setAppearance('light', { persist: false, immediate: true });
assert.equal(A.getDaylightBlend(), 1);
A.setAppearance('dark', { persist: false, immediate: true });
assert.equal(A.getDaylightBlend(), 0, 'fixed dark takes effect before the next animation frame');
assert.equal(queue.length, 0, 'fixed appearance cancels pending transitions');
A.setAppearance('auto', { persist: false }); pump(5000);

// Reduced motion: no animation frames, the value jumps.
media.reduce.matches = true;
media.reduce.listeners.forEach((fn) => fn());
c.set(0);
assert.equal(queue.length, 0);
assert.equal(A.getDaylightBlend(), 0, 'reduced motion applies immediately');
c.release();
console.log('Scoped solar claims, keyed remount, manual overrides and reduced motion PASS');

import assert from 'node:assert/strict';
import { mapFraming } from '../src/console/fireye/shell/map-framing';
import { advanceGlobe, BOOT_MOTION as M, BOOT_RANGE_FACTOR, BOOT_STEPS, bootEnabled, bootReady, globePose, handoffTransform, sourceFrames, sourceLayout, type BootProbe } from '../src/console/fireye/boot/sequence';

const pack = {
  elevation: new Float32Array([1]), fuel: new Uint8Array([1]), arrival: new Float64Array([0]),
  roads: [], weather: [{}],
} as unknown as NonNullable<BootProbe['pack']>;
const ready: BootProbe = { pack, ready: true, drones: 6, sensors: 24, chronicle: 100, feeds: 14, globe: true, painted: true, warm: true };
assert.ok(bootEnabled(''));
assert.ok(!bootEnabled('?boot=0'));
assert.ok(bootReady(ready, 0));
for (const key of ['ready', 'globe', 'painted', 'warm'] as const) {
  assert.ok(!bootReady({ ...ready, [key]: false }, 0), `${key} is a real gate, not an elapsed-time claim`);
}
for (const key of ['drones', 'sensors', 'chronicle', 'feeds'] as const) {
  assert.ok(!bootReady({ ...ready, [key]: 0 }, M.graphicsGrace * 2, true), `skipping never bypasses ${key}`);
}
for (const key of ['elevation', 'fuel', 'weather', 'arrival'] as const) {
  assert.ok(!bootReady({ ...ready, pack: { ...pack, [key]: [] } }, M.graphicsGrace * 2, true), `${key} cannot be faked by the grace timer`);
}
assert.ok(!bootReady({ ...ready, pack: null }, M.graphicsGrace * 2, true));
assert.ok(!bootReady({ ...ready, ready: false }, M.graphicsGrace * 2, true));
const noGraphics = { ...ready, globe: false, painted: false, warm: false };
assert.ok(!bootReady(noGraphics, M.graphicsGrace - 1));
assert.ok(bootReady(noGraphics, M.graphicsGrace), 'unavailable WebGL cannot permanently trap valid data');
assert.ok(bootReady(noGraphics, 0, true), 'an explicit skip may bypass graphics, not required source data');
assert.equal(BOOT_STEPS.length, 8);
assert.equal(new Set(BOOT_STEPS.map(s => s.id)).size, 8);
assert.ok(BOOT_STEPS.every(s => s.done(ready)));

for (const [w, h] of [[320, 568], [390, 844], [844, 390], [1024, 768], [1600, 1000], [2560, 1440]]) {
  const positions = BOOT_STEPS.map((_, i) => sourceLayout(w, h, i));
  assert.equal(positions.filter(p => p.x < 0).length, 4);
  assert.equal(positions.filter(p => p.x > 0).length, 4);
  for (let i = 0; i < 4; i++) {
    const a = positions[i], b = positions[i + 4];
    assert.equal(a.x, -b.x); assert.equal(a.y, b.y);
    assert.ok(a.size >= 72, 'source icons are larger than the previous 56 px steps');
    for (const p of [a, b]) {
      assert.ok(w / 2 + p.x - p.size / 2 >= 0 && w / 2 + p.x + p.size / 2 <= w);
      assert.ok(h / 2 + p.y - p.size / 2 >= 0 && h / 2 + p.y + p.size / 2 < h - 28);
    }
    if (i) assert.ok(a.delay > positions[i - 1].delay, 'pairs fan out in order');
  }
}
assert.equal(handoffTransform(1600, 1000, 320, { left: 752, top: 0, width: 96, height: 96 }),
  'translate(-50%, -50%) translate(0px, -452px) scale(0.3)');
assert.equal(handoffTransform(390, 844, 273, { left: 147, top: 8, width: 96, height: 96 }),
  `translate(-50%, -50%) translate(0px, -366px) scale(${96 / 273})`, 'measured header placement wins over a hardcoded destination');
const opening = M.lineHold + M.outline + M.pupilAppear + M.pupilLine + M.pupil + M.settle;
assert.equal(M.sourceHold, 100, 'each icon rests for exactly 0.1 seconds after appearing');
assert.ok(M.sourceExit <= 300, 'departure is fast');
const sourceDuration = M.sourceAppear + M.sourceHold + M.sourceExit;
const frames = sourceFrames(1600, 1000, 0);
assert.ok(Math.abs((frames[2].offset! - frames[1].offset!) * sourceDuration - 100) < 1e-10, 'the delivered keyframes hold for 100 ms, without a JS timer gap');
assert.equal(frames[1].transform, frames[2].transform, 'the hold is stationary');
assert.equal(frames[1].opacity, 1);
assert.equal(frames[2].opacity, 1);
assert.equal(frames[1].easing, 'linear');
const slots = BOOT_STEPS.map((s, i) => ({ side: i < 4 ? 'left' : 'right', id: s.id, start: sourceLayout(1600, 1000, i).delay }));
assert.deepEqual(slots.map(s => s.side), ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right']);
for (let i = 1; i < slots.length; i++) {
  assert.ok(slots[i].start >= slots[i - 1].start + sourceDuration, 'one icon finishes fading before the next appears');
}
const sources = slots.at(-1)!.start + sourceDuration;
assert.equal(opening + sources + Math.max(M.reveal, M.zoom) + M.panels, 9680);

for (const home of [2000, 10000, 60000]) {
  assert.ok(Math.abs(globePose(0, home).rangeM / home - 1.35) < 1e-12, 'starts only 35% wider than the goal frame, not in orbit');
  assert.equal(globePose(1, home).rangeM, home);
  let previous = globePose(0, home);
  for (let i = 1; i <= 10000; i++) {
    const pose = globePose(i / 10000, home);
    assert.equal(pose.headingDeg, 18, 'no incidental globe spin');
    assert.ok(pose.rangeM <= previous.rangeM && pose.rangeM >= home, 'descent has no reversal or overshoot');
    assert.equal(pose.pitchDeg, -40, 'retain the goal-frame tilt throughout');
    assert.ok(pose.rangeM <= home * 1.35 + 1e-8, 'never pull out farther than the local establishing frame');
    assert.ok(Math.log(previous.rangeM / pose.rangeM) <= Math.log(BOOT_RANGE_FACTOR) * 1.875 / 10000 + 1e-12, 'bounded logarithmic zoom speed');
    previous = pose;
  }
  assert.ok(Math.abs(globePose(0.0001, home).rangeM / (home * BOOT_RANGE_FACTOR) - 1) < 1e-8, 'camera starts at rest');
  assert.ok(Math.abs(globePose(0.9999, home).rangeM / home - 1) < 1e-8, 'camera finishes at rest');
}
assert.equal(advanceGlobe(0.3, 10000, false), 0.3 + 40 / M.zoom, 'a long frame cannot produce a camera jump');
assert.equal(advanceGlobe(0.3, 10000, true), 0.3, 'background tabs do not advance the camera');
assert.equal(advanceGlobe(0.3, -20, false), 0.3);
assert.equal(advanceGlobe(0.999, 40, false), 1);
// Project fixed eye-space rays through the overscan frustum and the original contained viewport.
for (const [width, height] of [[1600, 952], [1024, 720], [800, 1100]]) {
  for (const insets of [{ top: 0, left: 104, right: 380, bottom: 282 }, { top: 16, left: 220, right: 24, bottom: 110 }, { top: 0, left: 0, right: 0, bottom: 0 }]) {
    for (const baseFov of [Math.PI / 4, Math.PI / 3, Math.PI / 2]) {
      const near = 1.5, frame = mapFraming(width, height, insets, baseFov, near)!;
      const w = width - insets.left - insets.right, h = height - insets.top - insets.bottom;
      const oldFocal = Math.max(w, h) / (2 * Math.tan(baseFov / 2));
      const newFocal = Math.max(width, height) / (2 * Math.tan(frame.fov / 2));
      for (const [x, y] of [[0, 0], [-0.3, -0.4], [0.4, 0.3]]) {
        const actualX = width / 2 + newFocal * (x - frame.xOffset / near);
        const actualY = height / 2 - newFocal * (y - frame.yOffset / near);
        assert.ok(Math.abs(actualX - (insets.left + w / 2 + x * oldFocal)) < 1e-10, 'overscan preserves horizontal framing');
        assert.ok(Math.abs(actualY - (insets.top + h / 2 - y * oldFocal)) < 1e-10, 'overscan preserves vertical framing');
      }
    }
  }
}
assert.equal(mapFraming(320, 568, { top: 0, left: 104, right: 380, bottom: 282 }, Math.PI / 3, 1), null, 'no invalid frustum for an occluded window');
console.log('FIREYE boot: readiness/skip/grace, eight serial left-then-right icons (100 ms holds), measured handoff, bounded local approach, overscan framing and frame-gap bounds PASS');

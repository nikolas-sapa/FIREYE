import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TamagotchiSprite } from '../src/console/ui/TamagotchiSprite';

const characters = ['chief', 'ranger', 'rescue', 'scout'] as const;
const states = ['idle', 'thinking', 'working', 'alert'] as const;
const assets = resolve(process.cwd(), 'public/mascots');
const metadata = JSON.parse(readFileSync(resolve(assets, 'source.json'), 'utf8'));
assert.equal(metadata.source_commit, 'dcb58855d11927a5bd99982c08260f8d7e9f959a');
assert.deepEqual(metadata.source_paths, ['mascot-lab/sprite-core.mjs', 'mascot-lab/bots-a.mjs', 'mascot-lab/bots-b.mjs']);
assert.deepEqual(metadata.selected_ids, characters);
assert.deepEqual(metadata.states, states);
assert.equal(metadata.grid, 32);
assert.equal(metadata.frames, 16);
assert.equal(metadata.width, 512);
assert.equal(metadata.height, 128);
assert.equal(metadata.original_art, true);
assert.match(metadata.disclaimer, /not clinical or real status/i);
assert.deepEqual(readdirSync(assets).sort(), ['chief.png', 'ranger.png', 'rescue.png', 'scout.png', 'source.json']);

const hashes = new Set<string>();
for (const character of characters) {
  const png = readFileSync(resolve(assets, `${character}.png`));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 128);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(png[28], 0);
  hashes.add(createHash('sha256').update(png).digest('hex'));
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = 512 * 4;
  const pixels = Buffer.alloc(stride * 128);
  for (let y = 0; y < 128; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const prediction = left + up - corner;
      const distances = [Math.abs(prediction - left), Math.abs(prediction - up), Math.abs(prediction - corner)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : corner;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  const alpha = Array.from(pixels).filter((_, index) => index % 4 === 3);
  assert.ok(alpha.includes(0), `${character}: transparent background`);
  assert.ok(alpha.includes(255), `${character}: visible original art`);
  assert.ok(alpha.every((value) => value === 0 || value === 255), `${character}: crisp pixels`);
}
assert.equal(hashes.size, 4);
console.log('TM01 PASS: exactly4 distinct transparent512x128 original-art sheets, frozen metadata, no Relay/Tender');

let combinations = 0;
for (const character of characters) {
  for (const [row, state] of states.entries()) {
    for (const size of [16, 32, 64] as const) {
      const html = renderToStaticMarkup(createElement(TamagotchiSprite, { character, state, size }));
      assert.match(html, /aria-hidden="true"/);
      assert.doesNotMatch(html, /role=|tabindex=|<button/i);
      assert.ok(html.includes(`background-image:url(/mascots/${character}.png)`));
      assert.ok(html.includes(`width:${size}px;height:${size}px`));
      assert.ok(html.includes(`background-size:${size * 16}px ${size * 4}px`));
      assert.ok(html.includes(`background-position:0px ${-row * size}px`));
      assert.ok(html.includes('image-rendering:pixelated'));
      combinations++;
    }
  }
}
assert.equal(combinations, 48);
const defaults = renderToStaticMarkup(createElement(TamagotchiSprite));
assert.ok(defaults.includes('/mascots/chief.png'));
assert.ok(defaults.includes('width:32px;height:32px'));
assert.ok(defaults.includes('background-position:0px 0px'));
console.log('TM02 PASS:48 SSR combinations plus defaults, frame0, exact dimensions/rows, hidden noninteractive sprite');

type MotionSnapshot = { frame: number; intervals: number; listeners: number; cadence: number[] };
type MotionHarness = {
  snapshot(): Promise<MotionSnapshot>;
  waitForFrame(): Promise<void>;
  pause(value: boolean): Promise<void>;
  reduceMotion(value: boolean): Promise<void>;
  hide(value: boolean): Promise<void>;
  tick(milliseconds: number): Promise<void>;
  unmount(): Promise<void>;
};

export async function verifyTamagotchiMotion(harness: MotionHarness) {
  const frozen = async () => {
    const before = await harness.snapshot();
    assert.equal(before.frame, 0);
    assert.equal(before.intervals, 0);
    await harness.tick(640);
    assert.equal((await harness.snapshot()).frame, 0);
  };
  await harness.waitForFrame();
  assert.equal((await harness.snapshot()).intervals, 1);
  assert.ok((await harness.snapshot()).cadence.every((delay) => delay === 160));
  await harness.pause(true);
  await frozen();
  await harness.pause(false);
  await harness.tick(160);
  assert.equal((await harness.snapshot()).frame, 1);
  await harness.tick(15 * 160);
  assert.equal((await harness.snapshot()).frame, 0);
  await harness.reduceMotion(true);
  await frozen();
  await harness.reduceMotion(false);
  await harness.tick(160);
  assert.equal((await harness.snapshot()).frame, 1);
  await harness.hide(true);
  await frozen();
  await harness.hide(false);
  await harness.tick(160);
  assert.equal((await harness.snapshot()).frame, 1);
  await harness.unmount();
  const cleaned = await harness.snapshot();
  assert.equal(cleaned.intervals, 0);
  assert.equal(cleaned.listeners, 0);
  console.log('TM03 PASS: real-browser advance<800ms,160ms cadence,16-frame wrap, pause/reduced-motion/hidden frame0 with0 intervals, unmount0 listeners/timers');
}

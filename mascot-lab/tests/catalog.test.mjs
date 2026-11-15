import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { primaryBots } from '../bots-a.mjs';
import { alternateBots } from '../bots-b.mjs';
import { GRID_SIZE, STATES, drawSprite, frameFor, validateBot } from '../sprite-core.mjs';

const bots = [...primaryBots, ...alternateBots];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function assertGrid(bot, grid) {
  assert.equal(grid.length, 32);
  for (const row of grid) {
    assert.equal(row.length, 32);
    for (const pixel of row) assert.ok(pixel === '.' || Object.hasOwn(bot.palette, pixel));
  }
}

test('ML01 exactly six original, valid, distinct 32x32 silhouettes', () => {
  assert.equal(GRID_SIZE, 32);
  assert.equal(primaryBots.length, 3);
  assert.equal(alternateBots.length, 3);
  assert.equal(new Set(bots.map((bot) => bot.id)).size, 6);
  assert.equal(new Set(bots.map((bot) => bot.silhouette)).size, 6);
  assert.equal(new Set(bots.map((bot) => hash(bot.pixels))).size, 6);
  const masks = bots.map((bot) => bot.pixels.map((row) => row.replace(/[^.]/g, '#')));
  assert.equal(new Set(masks.map(hash)).size, 6);
  for (const bot of bots) {
    assert.equal(validateBot(bot), true);
    assertGrid(bot, bot.pixels);
    assert.ok(bot.pixels.join('').replaceAll('.', '').length >= 80, bot.id);
    const used = new Set(bot.pixels.join('').replaceAll('.', ''));
    assert.ok(used.size >= 2);
    for (const key of used) assert.match(bot.palette[key], /^#[0-9a-f]{6}$/i);
  }
});

test('MC01 a Chief-first firefighter crew with three supporting drones', () => {
  assert.deepEqual(primaryBots.map(({ id }) => id), ['chief', 'ranger', 'rescue']);
  assert.deepEqual(alternateBots.map(({ id }) => id), ['scout', 'relay', 'tender']);
  for (const bot of bots) {
    assert.ok(bot.pixels.join('').replaceAll('.', '').length >= 120, bot.id);
    assert.ok(new Set(bot.pixels.join('').replaceAll('.', '')).size >= 4, bot.id);
  }
  for (const bot of primaryBots) {
    assert.match(bot.description, /helmet/i);
    assert.match(bot.description, /coat|turnout|reflective/i);
  }
  for (const bot of alternateBots) assert.match(bot.description, /drone|rotor/i);
  assert.match(primaryBots[0].description, /shield|badge/i);
  const pale = new Set(Object.entries(primaryBots[0].palette).filter(([, color]) => {
    const rgb = color.slice(1).match(/../g).map((value) => Number.parseInt(value, 16));
    return Math.min(...rgb) >= 190;
  }).map(([symbol]) => symbol));
  assert.ok(primaryBots[0].pixels.slice(0, 12).join('').split('').filter((symbol) => pale.has(symbol)).length >= 25, 'Chief has a visibly pale helmet');
});

test('ML02 every state has multiple valid frames, originals unchanged', () => {
  assert.deepEqual(STATES, ['idle', 'thinking', 'working', 'alert']);
  for (const bot of bots) {
    const before = hash(bot);
    const stateHashes = [];
    for (const state of STATES) {
      const frames = Array.from({ length: 16 }, (_, frame) => frameFor(bot, state, frame));
      frames.forEach((grid) => assertGrid(bot, grid));
      assert.ok(new Set(frames.map(hash)).size >= 2, `${bot.id}/${state} must animate`);
      stateHashes.push(hash(frames));
      const edited = frameFor(bot, state, 0);
      assert.notEqual(edited, bot.pixels);
      edited[0] = '................................';
      assert.equal(hash(bot), before);
    }
    assert.equal(new Set(stateHashes).size, 4, `${bot.id} states must differ`);
    assert.equal(hash(bot), before);
  }
});

test('ML02 invalid grids, unknown states and numeric inputs fail clearly', () => {
  const bot = bots[0];
  const badRows = structuredClone(bot);
  badRows.pixels[2] = '..';
  assert.throws(() => validateBot(badRows), TypeError);
  const badPalette = structuredClone(bot);
  badPalette.pixels[2] = '?'.repeat(32);
  assert.throws(() => validateBot(badPalette), TypeError);
  assert.throws(() => validateBot(null), TypeError);
  assert.throws(() => frameFor(bot, 'unknown', 0), TypeError);
  for (const frame of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => frameFor(bot, 'idle', frame), TypeError);
  }
});

test('ML02 renderer emits bounded integer pixels and clears transparent backing', () => {
  for (const bot of bots) {
    for (const state of STATES) {
      const rectangles = [];
      const clearCalls = [];
      const context = {
        imageSmoothingEnabled: true,
        fillStyle: '',
        clearRect: (...args) => clearCalls.push(args),
        fillRect: (...args) => rectangles.push(args),
      };
      const canvas = { width: 0, height: 0, getContext: () => context };
      assert.equal(drawSprite(canvas, bot, { state, frame: 3, scale: 4 }), canvas);
      assert.equal(canvas.width, 128);
      assert.equal(canvas.height, 128);
      assert.equal(context.imageSmoothingEnabled, false);
      assert.deepEqual(clearCalls.at(-1), [0, 0, 128, 128]);
      assert.ok(rectangles.reduce((area, [, , width, height]) => area + width * height / 16, 0) >= 80);
      for (const [x, y, w, h] of rectangles) {
        assert.ok([x, y, w, h].every(Number.isInteger));
        assert.ok(x >= 0 && y >= 0 && x + w <= 128 && y + h <= 128);
      }
    }
  }
});

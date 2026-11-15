// Run: node src/console/ops/characters/check-characters.mts (Node >= 23.6 strips TS types).
import assert from 'node:assert/strict';
import { POOL_DEFS } from '../../agents/pools.ts';
import { characterForAgent, stateForPool } from './cast.ts';
import { artFor, blinkArtFor, CHARACTER_IDS, CHARACTER_STATES, CHARACTERS, GRID_SIZE, runsFor } from './sprites.ts';

let checks = 0;
const ok = (cond: boolean, msg: string): void => { assert.ok(cond, msg); checks += 1; };

ok(Object.keys(CHARACTERS).length === 6, 'six characters');
for (const id of CHARACTER_IDS) {
  const art = CHARACTERS[id];
  ok(art.id === id, `${id}: id matches key`);
  ok(art.pixels.length === GRID_SIZE, `${id}: ${art.pixels.length} rows`);
  for (const [i, row] of art.pixels.entries()) {
    ok(row.length === GRID_SIZE, `${id}: row ${i} has ${row.length} cols`);
    for (const symbol of row) ok(symbol === '.' || symbol in art.palette, `${id}: symbol ${symbol} not in palette`);
  }
  for (const hex of Object.values(art.palette)) ok(/^#[\da-f]{6}$/i.test(hex), `${id}: bad hex ${hex}`);
  for (const state of CHARACTER_STATES) {
    const frame = artFor(id, state);
    ok(frame.length === GRID_SIZE && frame.every((r) => r.length === GRID_SIZE), `${id}/${state}: frame 32x32`);
    const rects = runsFor(frame).length;
    ok(rects < 400, `${id}/${state}: ${rects} merged rects >= 400`);
    console.log(`${id.padEnd(7)} ${state.padEnd(9)} rects=${rects}`);
  }
  ok(artFor(id, 'idle').join('') === art.pixels.join(''), `${id}: idle frame 0 equals source art`);
  ok(blinkArtFor(id, 'thinking').join('') !== artFor(id, 'thinking').join(''), `${id}: thinking blink changes pixels`);
  ok(artFor(id, 'alert').join('') !== art.pixels.join(''), `${id}: alert differs from idle`);
}

for (const pool of POOL_DEFS) {
  const a = characterForAgent(pool.id);
  const b = characterForAgent(`${pool.agent}-07`);
  ok(a in CHARACTERS, `${pool.id} maps to a character`);
  ok(a === b, `${pool.id} (${a}) and ${pool.agent}-07 (${b}) agree`);
  console.log(`${pool.id.padEnd(18)} ${pool.agent.padEnd(8)} -> ${a}`);
}
ok(POOL_DEFS.length > 0, 'POOL_DEFS non-empty');

const expect: Record<string, string> = {
  'pool-orchestrator': 'chief', 'ORCH': 'chief', 'pool-drone': 'scout', 'SAT-02': 'scout',
  'pool-radio': 'relay', 'CRAWL-01': 'relay', 'EXTRACT-03': 'relay', 'SOCIAL-09': 'relay',
  'pool-weather': 'tender', 'PROJ-01': 'tender', 'pool-ground': 'ranger', 'RIDGE-04': 'ranger',
  'civilian-alert': 'rescue', 'public-warning': 'rescue',
};
for (const [input, want] of Object.entries(expect)) ok(characterForAgent(input) === want, `${input} -> ${want}`);

ok(stateForPool({ workers: 0, queue: 0 }) === 'idle', 'idle');
ok(stateForPool({ workers: 0, queue: 3 }) === 'thinking', 'thinking');
ok(stateForPool({ workers: 2, queue: 3 }) === 'working', 'working');
ok(stateForPool({ workers: 2, queue: 3 }, true) === 'alert', 'alert');

console.log(`check-characters: ${checks} checks passed`);

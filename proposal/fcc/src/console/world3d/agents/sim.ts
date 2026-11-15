import type { HeightField } from '../frame';
import { Rng, hashString } from '../rng';
import type { Spawns } from '../types';

export type Species = 'person' | 'dog' | 'cat' | 'goat' | 'sheep' | 'bird';
export const SPECIES: Species[] = ['person', 'dog', 'cat', 'goat', 'sheep', 'bird'];
export const AGENT_ID_BASE = 0xf00000;
export const TICK_S = 0.1;

type State = 'idle' | 'walk' | 'home' | 'follow' | 'graze' | 'fly';
export interface Agent {
  index: number;
  species: Species;
  area: string;
  x: number; z: number; y: number;
  px: number; pz: number; py: number;
  heading: number; pheading: number;
  speed: number;
  phase: number; pphase: number;
  state: State;
  timer: number;
  tx: number; tz: number;
  homeX: number; homeZ: number;
  /** 0–1; the person is outdoors while this is below the current activity level. */
  activity: number;
  leader: number;
  ox: number; oz: number;
  alt: number;
  scale: number;
  tint: [number, number, number];
  visible: boolean;
  rng: Rng;
}
export interface AgentArea { id: string; x: number; z: number; r: number; air: boolean }
export interface AgentEnv { daylight: number; rain: number; windMs: number }

const SHIRTS: [number, number, number][] = [[0.75, 0.75, 0.72], [0.12, 0.2, 0.42], [0.55, 0.08, 0.06], [0.08, 0.3, 0.15], [0.62, 0.48, 0.22], [0.06, 0.06, 0.07], [0.45, 0.5, 0.55], [0.7, 0.35, 0.12]];
const MAX_SLOPE: Record<Species, number> = { person: 0.6, dog: 0.75, cat: 0.8, goat: 1.1, sheep: 0.7, bird: 99 };
const WALK: Record<Species, number> = { person: 1.25, dog: 1.6, cat: 0.7, goat: 0.45, sheep: 0.4, bird: 9 };
const GAIT: Record<Species, number> = { person: 3.6, dog: 6, cat: 7, goat: 5, sheep: 5, bird: 1 };

/**
 * Small fixed-step (10 Hz) finite-state simulation for fictional people and animals near active cameras.
 * Deterministic per area seed. Agents never enter water, steep slopes or leave the pack.
 */
export class AgentSim {
  agents: Agent[] = [];
  areas = new Map<string, AgentArea & { herd?: { x: number; z: number; tx: number; tz: number; pasture: number[] } }>();
  private acc = 0;
  private ticks = 0;
  activity = 1;

  constructor(private hf: HeightField) {}

  walkable(x: number, z: number, s: Species) {
    const f = this.hf.frame;
    if (x < f.xMin + 5 || x > f.xMax - 5 || z < f.zMin + 5 || z > f.zMax - 5) return false;
    if (s === 'bird') return true;
    return !this.hf.isWater(x, z) && this.hf.slope(x, z) < MAX_SLOPE[s];
  }

  /** Populate an area once, from the generator's spawn points of loaded tiles. */
  populate(area: AgentArea, spawns: Spawns[]) {
    if (this.areas.has(area.id)) return;
    const r = new Rng(hashString(area.id), 4242);
    const inR = (x: number, z: number) => Math.hypot(x - area.x, z - area.z) < area.r;
    const homes: number[] = [], nodes: number[] = [], pasture: number[] = [];
    for (const s of spawns) {
      for (let i = 0; i < s.homes.length; i += 2) if (inR(s.homes[i], s.homes[i + 1])) homes.push(s.homes[i], s.homes[i + 1]);
      for (let i = 0; i < s.nodes.length; i += 2) if (inR(s.nodes[i], s.nodes[i + 1])) nodes.push(s.nodes[i], s.nodes[i + 1]);
      for (let i = 0; i < s.pasture.length; i += 2) if (inR(s.pasture[i], s.pasture[i + 1]) && this.walkable(s.pasture[i], s.pasture[i + 1], 'sheep')) pasture.push(s.pasture[i], s.pasture[i + 1]);
    }
    const entry: AgentArea & { herd?: { x: number; z: number; tx: number; tz: number; pasture: number[] }; nodes?: number[]; homes?: number[] } = { ...area, nodes, homes };
    this.areas.set(area.id, entry);
    const spot = (pool: number[]): [number, number] | null => {
      if (!pool.length) return null;
      const i = r.int(0, pool.length / 2 - 1) * 2;
      return [pool[i], pool[i + 1]];
    };
    const add = (species: Species, x: number, z: number, extra: Partial<Agent> = {}) => {
      if (!this.walkable(x, z, species)) return -1;
      const y = species === 'bird' ? this.hf.height(x, z) + 30 : this.hf.height(x, z);
      const a: Agent = {
        index: this.agents.length, species, area: area.id, x, z, y, px: x, pz: z, py: y, heading: r.range(0, 6.28), pheading: 0, speed: 0,
        phase: r.range(0, 6.28), pphase: 0, state: 'idle', timer: r.range(0, 6), tx: x, tz: z, homeX: x, homeZ: z, activity: r.next(), leader: -1,
        ox: 0, oz: 0, alt: 0, scale: species === 'person' ? r.range(0.9, 1.08) : r.range(0.85, 1.15), tint: species === 'person' ? r.pick(SHIRTS) : [1, 1, 1],
        visible: true, rng: new Rng(hashString(area.id), this.agents.length, 77), ...extra,
      };
      a.pheading = a.heading; a.pphase = a.phase;
      this.agents.push(a);
      return a.index;
    };
    const people = Math.max(area.air ? 3 : 2, Math.min(area.air ? 18 : 12, Math.round(homes.length / 2 / 3)));
    for (let i = 0; i < people; i++) {
      const h = spot(homes) ?? spot(nodes);
      if (!h) break;
      const p = add('person', h[0] + r.range(-1, 1), h[1] + r.range(-1, 1));
      if (p >= 0 && r.chance(0.3)) add('dog', h[0] + 1, h[1] + 1, { leader: p, ox: r.range(-2, 2), oz: r.range(-2, 2), state: 'follow' });
    }
    for (let i = Math.min(4, Math.floor(homes.length / 2 / 5)); i > 0; i--) { const h = spot(homes); if (h) add('cat', h[0] + r.range(-3, 3), h[1] + r.range(-3, 3)); }
    if (!homes.length) for (let i = 0; i < 2; i++) { const h = spot(nodes); if (h) add('person', h[0], h[1], { activity: r.range(0, 0.6) }); }
    if (pasture.length >= 10) {
      const c = spot(pasture)!;
      entry.herd = { x: c[0], z: c[1], tx: c[0], tz: c[1], pasture };
      const sp: Species = r.chance(0.6) ? 'goat' : 'sheep';
      const herder = add('person', c[0] + 6, c[1] + 6, { activity: 0, state: 'follow', tint: [0.3, 0.28, 0.22] });
      for (let i = r.int(8, 15); i > 0; i--) add(i % 5 ? sp : r.chance(0.5) ? 'goat' : 'sheep', c[0] + r.range(-10, 10), c[1] + r.range(-10, 10), { state: 'graze' });
      if (herder >= 0) add('dog', c[0] + 9, c[1] + 4, { leader: herder, ox: 3, oz: -2, state: 'follow' });
    }
    for (let f = area.air ? 2 : 1; f > 0; f--) {
      const cx = area.x + r.range(-area.r, area.r) * 0.4, cz = area.z + r.range(-area.r, area.r) * 0.4;
      const radius = r.range(40, 140), alt = r.range(25, 70), lead = this.agents.length;
      for (let i = r.int(5, 11); i > 0; i--) add('bird', cx, cz, { state: 'fly', ox: radius, oz: r.range(-6, 6), alt: alt + r.range(-4, 4), tx: cx, tz: cz, phase: r.range(0, 6.28), timer: lead + r.next(), leader: -1 });
    }
  }

  /** Advance at a fixed 10 Hz; returns interpolation alpha for rendering. */
  update(dtS: number, env: AgentEnv) {
    this.activity = Math.max(0.12, env.daylight) * (1 - 0.65 * Math.min(1, env.rain * 1.5));
    this.acc = Math.min(this.acc + Math.max(0, dtS), TICK_S * 5);
    while (this.acc >= TICK_S) { this.tick(); this.acc -= TICK_S; }
    return this.acc / TICK_S;
  }

  tick() {
    this.ticks++;
    const dt = TICK_S;
    for (const area of this.areas.values()) if (area.herd) {
      const h = area.herd;
      if (Math.hypot(h.tx - h.x, h.tz - h.z) < 2) { const i = Math.floor(Math.abs(Math.sin(this.ticks * 0.37 + h.x)) * (h.pasture.length / 2)) * 2; h.tx = h.pasture[i]; h.tz = h.pasture[i + 1]; }
      const d = Math.hypot(h.tx - h.x, h.tz - h.z) || 1, s = Math.min(d, 0.12 * dt * 10);
      const nx = h.x + (h.tx - h.x) / d * s, nz = h.z + (h.tz - h.z) / d * s;
      if (this.walkable(nx, nz, 'sheep')) { h.x = nx; h.z = nz; } else { h.tx = h.x; h.tz = h.z; }
    }
    for (const a of this.agents) {
      a.px = a.x; a.pz = a.z; a.py = a.y; a.pheading = a.heading; a.pphase = a.phase;
      const area = this.areas.get(a.area) as (AgentArea & { herd?: { x: number; z: number }; nodes?: number[]; homes?: number[] }) | undefined;
      if (a.species === 'bird') { this.fly(a, dt); continue; }
      let target: [number, number] | null = null, speed = 0;
      if (a.state === 'follow' && a.leader >= 0) {
        const l = this.agents[a.leader];
        a.visible = l.visible;
        if (!l.visible) { a.x = l.x; a.z = l.z; a.speed = 0; continue; }
        const tx = l.x + a.ox, tz = l.z + a.oz, d = Math.hypot(tx - a.x, tz - a.z);
        if (d > 1.2) { target = [tx, tz]; speed = Math.min(WALK[a.species] * 2.2, 0.6 + d * 0.4); }
        if (a.rng.chance(0.01)) { a.ox = a.rng.range(-4, 4); a.oz = a.rng.range(-4, 4); }
      } else if (a.state === 'follow' && area?.herd) {
        const tx = area.herd.x + 7, tz = area.herd.z + 5, d = Math.hypot(tx - a.x, tz - a.z);
        if (d > 2) { target = [tx, tz]; speed = Math.min(1.4, 0.3 + d * 0.2); }
      } else if (a.state === 'graze' && area?.herd) {
        if (a.timer > 0) a.timer -= dt;
        else { a.tx = area.herd.x + a.rng.range(-12, 12); a.tz = area.herd.z + a.rng.range(-12, 12); a.timer = a.rng.range(3, 14); }
        if (Math.hypot(a.tx - a.x, a.tz - a.z) > 0.6) { target = [a.tx, a.tz]; speed = WALK[a.species]; }
      } else if (a.species === 'person' || a.species === 'cat') {
        const outdoors = a.activity < this.activity;
        if (a.species === 'person' && !outdoors && a.state !== 'home') { a.state = 'walk'; a.tx = a.homeX; a.tz = a.homeZ; if (Math.hypot(a.x - a.homeX, a.z - a.homeZ) < 1) { a.state = 'home'; a.visible = false; } }
        else if (a.state === 'home') { if (outdoors) { a.state = 'idle'; a.visible = true; a.timer = a.rng.range(1, 5); } else { a.speed = 0; continue; } }
        if (a.state === 'idle') {
          a.timer -= dt;
          if (a.timer <= 0) {
            const nodes = area?.nodes ?? [];
            if (a.species === 'cat' || !nodes.length || a.rng.chance(0.3)) { const r = a.species === 'cat' ? 14 : 25; a.tx = a.homeX + a.rng.range(-r, r); a.tz = a.homeZ + a.rng.range(-r, r); }
            else { const i = a.rng.int(0, nodes.length / 2 - 1) * 2; a.tx = nodes[i] + a.rng.range(-1.5, 1.5); a.tz = nodes[i + 1] + a.rng.range(-1.5, 1.5); }
            a.state = 'walk';
          }
        }
        if (a.state === 'walk') {
          if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.6) { a.state = 'idle'; a.timer = a.species === 'cat' ? a.rng.range(6, 30) : a.rng.range(2, 14); }
          else { target = [a.tx, a.tz]; speed = WALK[a.species] * (0.85 + 0.3 * ((a.index * 0.618) % 1)); }
        }
      }
      if (target) {
        const dx = target[0] - a.x, dz = target[1] - a.z, d = Math.hypot(dx, dz) || 1, step = Math.min(d, speed * dt);
        const nx = a.x + dx / d * step, nz = a.z + dz / d * step;
        if (this.walkable(nx, nz, a.species)) {
          a.x = nx; a.z = nz; a.speed = step / dt;
          const want = Math.atan2(dx, dz);
          let dh = want - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          a.heading += dh * Math.min(1, dt * 6);
        } else { a.speed = 0; a.state = a.state === 'walk' ? 'idle' : a.state; a.timer = 0.5; a.tx = a.x; a.tz = a.z; }
      } else a.speed *= 0.5;
      a.phase += a.speed * GAIT[a.species] * dt;
      a.y = this.hf.height(a.x, a.z);
    }
  }

  private fly(a: Agent, dt: number) {
    const w = 9 / a.ox;
    const t = this.ticks * dt * w + a.timer * 2.4;
    const r = a.ox + a.oz;
    const nx = a.tx + Math.cos(t) * r, nz = a.tz + Math.sin(t) * r;
    const ground = this.hf.height(nx, nz);
    a.x = Math.min(this.hf.frame.xMax - 6, Math.max(this.hf.frame.xMin + 6, nx));
    a.z = Math.min(this.hf.frame.zMax - 6, Math.max(this.hf.frame.zMin + 6, nz));
    a.y = Math.max(ground, 0) + a.alt + Math.sin(t * 3 + a.index) * 2;
    a.heading = Math.atan2(-Math.sin(t), Math.cos(t));
    a.speed = 9;
    a.phase += dt * 9;
    a.visible = this.activity > 0.2;
  }
}

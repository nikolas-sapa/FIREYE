import type { ConsoleState, Ms, ScenarioPack } from '../contracts';
import type { Bus } from '../bus';
import type { Sim } from './sim';
import { MIN, clamp } from './geo';
import { DEFAULT_SEED, contextFor, createSim, fastForward, stepSim } from './engine';
import { Director, type DirectorRuntime } from '../director';

const MAX_FF_MS = 6 * 60 * MIN;

/** Owns the current Sim, rebuilds it on backward seeks, and drives the Demo Director. */
export class Runtime implements DirectorRuntime {
  sim: Sim;
  readonly director: Director;
  private readonly seed: number;

  constructor(
    readonly pack: ScenarioPack,
    readonly bus: Bus,
    opts: { seed?: number; tokens?: ConsoleState['settings']['tokens']; t?: Ms } = {},
  ) {
    const ctx = contextFor(pack);
    this.seed = opts.seed ?? DEFAULT_SEED;
    this.sim = createSim(pack, bus, {
      seed: this.seed,
      t: opts.t ?? ctx.T0,
      settings: { autonomy: 'assist', lens: 'ic', holdLayout: false, tokens: opts.tokens ?? { cesium: false, google: false } },
    });
    this.director = new Director(this, ctx.T0, ctx);
    this.sim.director = { ...this.sim.director, beats: this.director.beats };
  }

  rebuild(t: Ms): void {
    const prev = this.sim;
    this.bus.clear();
    this.sim = createSim(this.pack, this.bus, {
      seed: this.seed,
      t,
      speed: prev.speed,
      paused: false,
      settings: { ...prev.settings },
      director: { ...prev.director },
    });
    this.sim.fireRev = prev.fireRev + 1;
  }

  seekForward(t: Ms): void {
    if (t > this.sim.t + 1000) fastForward(this.sim, t, { speed: 60, dtReal: 0.5 });
  }

  setMuted(m: boolean): void {
    this.bus.setMuted(m);
  }

  step(dtReal: number): void {
    stepSim(this.sim, dtReal);
  }

  /** Real-time tick from the clock loop. */
  tick(dtReal: number): void {
    this.director.tick(dtReal);
    stepSim(this.sim, dtReal);
  }

  /** User seek: forward up to 6 h is simulated (keeps decisions and drones consistent), otherwise rebuilt. */
  seek(t: Ms): void {
    const c = this.sim.ctx;
    const to = clamp(t, c.start, c.end);
    if (this.sim.director.enabled) this.director.stop();
    const paused = this.sim.paused;
    this.setMuted(true);
    try {
      if (to > this.sim.t && to - this.sim.t <= MAX_FF_MS) fastForward(this.sim, to, { speed: Math.max(this.sim.speed, 120), dtReal: 0.5 });
      else if (Math.abs(to - this.sim.t) > 1000) this.rebuild(to);
    } finally {
      this.setMuted(false);
    }
    this.sim.paused = paused;
  }
}

import type { ConsoleState, Ms, ScenarioPack } from '../contracts';
import type { Bus } from '../bus';
import type { Sim } from './sim';
import { clamp } from './geo';
import { contextFor, createSim, fastForward, stepSim } from './engine';
import { Director, type DirectorRuntime } from '../director';

/** Owns the current Sim, rebuilds it on backward seeks, and drives the Demo Director. */
export class Runtime implements DirectorRuntime {
  sim: Sim;
  readonly director: Director;
  private readonly seed: number;
  private readonly profile: 'legacy' | 'recon';

  constructor(
    readonly pack: ScenarioPack,
    readonly bus: Bus,
    opts: { seed?: number; tokens?: ConsoleState['settings']['tokens']; t?: Ms; profile?: 'legacy' | 'recon' } = {},
  ) {
    const ctx = contextFor(pack);
    this.seed = opts.seed ?? ctx.script.seed;
    this.profile = opts.profile ?? 'legacy';
    this.sim = createSim(pack, bus, {
      profile: this.profile,
      seed: this.seed,
      t: opts.t ?? (this.profile === 'recon' ? ctx.start : ctx.T0),
      settings: { autonomy: 'assist', lens: 'ic', holdLayout: false, tokens: opts.tokens ?? { cesium: false, google: false } },
    });
    this.director = new Director(this, ctx.T0, ctx);
    this.sim.director = { ...this.sim.director, beats: this.director.beats };
  }

  rebuild(t: Ms): void {
    const prev = this.sim;
    this.bus.clear();
    this.sim = createSim(this.pack, this.bus, {
      profile: this.profile,
      seed: this.seed,
      t: this.profile === 'recon' ? prev.ctx.start : t,
      speed: prev.speed,
      paused: false,
      settings: { ...prev.settings },
      director: { ...prev.director },
    });
    if (this.profile === 'recon' && t > this.sim.t) fastForward(this.sim, t, { speed: 120, dtReal: 0.5 });
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

  /**
   * User seek. The world advances in fixed steps, so simulating forward from the current state or from a rebuild
   * yields the same state as continuous play. Backward seeks rebuild from the start (legacy: from T0, or at t before it).
   */
  seek(t: Ms): void {
    const c = this.sim.ctx;
    const to = clamp(t, c.start, c.end);
    if (this.sim.director.enabled) this.director.stop();
    const paused = this.sim.paused;
    this.setMuted(true);
    try {
      if (to < this.sim.t + this.sim.carryMs) this.rebuild(this.profile === 'recon' || to < c.T0 ? to : c.T0);
      if (to > this.sim.t + this.sim.carryMs) fastForward(this.sim, to, { speed: Math.max(this.sim.speed, 120), dtReal: 0.5 });
    } finally {
      this.setMuted(false);
    }
    this.sim.paused = paused;
  }
}

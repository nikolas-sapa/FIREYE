import type { DirectorState } from '../contracts';
import type { Sim } from '../world/sim';
import { DEMO_LENGTH_S, beatsState, buildBeats, type BeatDef, type DirectorHost } from './beats';

export { DEMO_QUESTION, DEMO_LENGTH_S, buildBeats } from './beats';
export type { BeatDef, DirectorHost } from './beats';

/** What the Director needs from the runtime: rebuild the world at T0 and fast-forward. */
export interface DirectorRuntime extends DirectorHost {
  /** Fresh, seeded world at scenario time `t` (bus muted while rebuilding is handled by the caller). */
  rebuild(t: number): void;
  setMuted(m: boolean): void;
  /** One engine step of `dtReal` wall-clock seconds. */
  step(dtReal: number): void;
}

const VIRTUAL_DT = 0.25;

/**
 * The 3-minute guided demo. Beats are deterministic: goto(i) rebuilds the seeded world at T0 and replays
 * beats 0..i-1 in virtual time, so any beat can be reached from any other.
 */
export class Director {
  readonly defs: BeatDef[];
  readonly beats: DirectorState['beats'];
  private beatS = 0;
  private fired = new Set<string>();
  private marks = new Map<string, number>();

  constructor(
    private rt: DirectorRuntime,
    private T0: number,
    ctx: Parameters<typeof buildBeats>[0],
  ) {
    this.defs = buildBeats(ctx);
    this.beats = beatsState(this.defs);
  }

  private get sim(): Sim {
    return this.rt.sim;
  }

  private set(p: Partial<DirectorState>): void {
    this.sim.director = { ...this.sim.director, beats: this.beats, ...p };
  }

  private enter(i: number): void {
    const d = this.defs[i];
    this.beatS = 0;
    this.fired.clear();
    this.marks.clear();
    this.set({ enabled: true, beat: i, elapsedS: d.at });
    if (d.anchor !== undefined) this.rt.seekForward(d.anchor);
    this.sim.speed = d.speed;
    this.sim.paused = false;
    d.enter?.(this.rt);
  }

  /** Advances demo time; call before each engine step while enabled. */
  tick(dtReal: number): void {
    const st = this.sim.director;
    if (!st.enabled || this.sim.paused) return;
    this.beatS += dtReal;
    const elapsedS = st.elapsedS + dtReal;
    this.sim.director = { ...st, elapsedS: Math.min(elapsedS, DEMO_LENGTH_S) };
    const next = this.defs[st.beat + 1];
    if (next && elapsedS >= next.at) {
      this.enter(st.beat + 1);
      return;
    }
    const d = this.defs[st.beat];
    d.watch?.(this.rt, this.beatS, (k) => (this.fired.has(k) ? false : (this.fired.add(k), true)), this.marks);
  }

  start(): void {
    this.goto(0);
  }

  stop(): void {
    this.set({ enabled: false });
    this.sim.paused = false;
  }

  next(): void {
    const st = this.sim.director;
    if (!st.enabled) return this.goto(0);
    if (st.beat + 1 < this.defs.length) this.enter(st.beat + 1);
  }

  prev(): void {
    const st = this.sim.director;
    this.goto(Math.max(0, (st.enabled ? st.beat : 1) - 1));
  }

  setCaptions(on: boolean): void {
    this.set({ captions: on });
  }

  goto(i: number): void {
    const target = Math.max(0, Math.min(this.defs.length - 1, Math.floor(i)));
    const captions = this.sim.director.captions;
    this.rt.setMuted(true);
    try {
      this.rt.rebuild(this.T0);
      this.set({ captions });
      this.enter(0);
      let guard = 0;
      while (this.sim.director.beat < target && guard++ < 4000) {
        this.tick(VIRTUAL_DT);
        this.rt.step(VIRTUAL_DT);
      }
    } finally {
      this.rt.setMuted(false);
    }
  }
}

import type { DirectorState } from '../contracts';
import type { ScenarioContext } from '../world/context';
import type { Sim } from '../world/sim';
import { ops } from '../world/engine';
import { say } from '../orchestrator/messages';

/** What a beat can do to the running world. */
export interface DirectorHost {
  readonly sim: Sim;
  /** Fast-forwards (deterministically) to scenario time `t` if the clock is behind it. */
  seekForward(t: number): void;
}

export interface BeatDef {
  id: string;
  /** Seconds into the demo. */
  at: number;
  title: string;
  caption: string;
  /** Scenario seconds per real second during the beat. */
  speed: number;
  /** Scenario time the beat starts at (fast-forward if the clock is behind). */
  anchor?: number;
  enter?(h: DirectorHost): void;
  /** Called every tick with seconds since the beat started; `once(key)` is true the first time a key is seen. */
  watch?(h: DirectorHost, beatS: number, once: (key: string) => boolean, mark: Map<string, number>): void;
}

export const DEMO_QUESTION = 'What changed in the last 10 minutes?';
export const DEMO_LENGTH_S = 185;

export function ackInterrupts(sim: Sim): void {
  for (const it of sim.items) if (it.zone === 'Z0_INTERRUPT') ops.acknowledge(sim, it.id);
}

export function remindKinds(sim: Sim, kinds: string[]): void {
  for (const a of sim.actions.slice().reverse()) {
    if (a.status === 'proposed' && a.requiresApproval && kinds.includes(a.kind)) {
      if (sim.cues.has(`approval-reminder-${a.id}`)) continue;
      sim.cues.add(`approval-reminder-${a.id}`);
      say(sim, `Demo Director: review and approve this draft in Decisions. It will not execute without your click: ${a.title}.`, [a.id]);
    }
  }
}

/** Reminds the user after a delay; never impersonates a human approval. */
export function remindAfter(sim: Sim, s: number, mark: Map<string, number>, pick: (a: Sim['actions'][number]) => number): void {
  for (const act of sim.actions) {
    if (act.status !== 'proposed' || !act.requiresApproval) continue;
    const delay = pick(act);
    if (delay < 0) continue;
    if (!mark.has(act.id)) mark.set(act.id, s);
    if (s - mark.get(act.id)! >= delay) {
      remindKinds(sim, [act.kind]);
    }
  }
}

/** The active scenario's beats (each scenario module owns its own demo script). */
export function buildBeats(ctx: ScenarioContext): BeatDef[] {
  return ctx.script.beats(ctx);
}

export function beatsState(defs: BeatDef[]): DirectorState['beats'] {
  return defs.map((d) => ({ id: d.id, at: d.at, title: d.title, caption: d.caption }));
}

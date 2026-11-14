import type { DirectorState } from '../contracts';
import type { ScenarioContext } from '../world/context';
import type { Sim } from '../world/sim';
import { MIN, bearingDeg, distanceM } from '../world/geo';
import { sendTo, unitById } from '../world/units';
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

function ackInterrupts(sim: Sim): void {
  for (const it of sim.items) if (it.zone === 'Z0_INTERRUPT') ops.acknowledge(sim, it.id);
}

function approveKinds(sim: Sim, kinds: string[], note: string): void {
  for (const a of sim.actions.slice().reverse()) {
    if (a.status === 'proposed' && a.requiresApproval && kinds.includes(a.kind)) {
      ops.approve(sim, a.id, 'user');
      say(sim, `${note}: ${a.title}.`, [a.id]);
    }
  }
}

export function buildBeats(ctx: ScenarioContext): BeatDef[] {
  const T0 = ctx.T0;
  const acres = Math.round(ctx.acresAt(T0)).toLocaleString('en-US');
  const etaAfterShift = Math.round((ctx.tGF - ctx.tShift) / MIN);
  const a = Math.round(ctx.shiftFrom.windDirDeg);
  const b = Math.round(ctx.shiftTo.windDirDeg);
  const road = ctx.sites.propaneRoadName;
  return [
    {
      id: 'calm',
      at: 0,
      title: 'Calm monitoring',
      caption: `${ctx.fmtTime(T0)}, ${ctx.fmtDate(T0)}. The Caldor Fire is about ${acres} acres. Six drones sweep the front while agent pools read web, social, camera, satellite, weather and radio sources. The ledger counts the analyst time the swarm saves.`,
      speed: 30,
      enter: (h) => {
        ops.setAutonomy(h.sim, 'assist');
        ops.setLens(h.sim, 'ic');
        ops.setHoldLayout(h.sim, false);
      },
    },
    {
      id: 'hikers',
      at: 20,
      title: 'Two hikers in the fire path',
      caption:
        'A public social clip shows two hikers on a ridge trail. The vision agent flags them with an approximate, fading ring. In Act mode the Orchestrator retasks HAWK-3 (low risk, undoable), promotes its feed, and once the people are confirmed live raises the only Z0 interrupt and drafts a rescue for EMS.',
      speed: 30,
      anchor: T0 + 18.5 * MIN,
      enter: (h) => ops.setAutonomy(h.sim, 'act'),
    },
    {
      id: 'windshift',
      at: 60,
      title: 'Wind shift and re-projection',
      caption: `The real evening wind shift (Open-Meteo archive, ${a}° to ${b}°) reaches the Projection agent. The new run keeps the old bands as a ghost: the head now reaches ${ctx.gfName} in about ${etaAfterShift} min. The Orchestrator drafts an evacuation ORDER and a structure-group move; high-risk actions wait for the IC (auto-approved here after 6 s).`,
      speed: 10,
      anchor: T0 + 59 * MIN,
      enter: (h) => {
        ackInterrupts(h.sim);
        approveKinds(h.sim, ['rescue'], 'Approved by the IC');
      },
      watch: (h, s, _once, mark) => {
        const sim = h.sim;
        for (const act of sim.actions) {
          if (act.status !== 'proposed') continue;
          const delay = act.kind === 'evac-notice' && act.title.includes('ORDER') ? 6 : act.kind === 'move-group' ? 8 : -1;
          if (delay < 0) continue;
          if (!mark.has(act.id)) mark.set(act.id, s);
          if (s - mark.get(act.id)! >= delay) {
            ops.approve(sim, act.id, 'user');
            say(sim, `Demo Director: no input for ${delay} s, so this was approved on behalf of the IC: ${act.title}.`, [act.id]);
          }
        }
      },
    },
    {
      id: 'propane',
      at: 100,
      title: 'Propane tanks, nearby units only',
      caption: `E-41's dash cam spots two propane tanks next to a house on ${road}. The hazard goes only to the units within 1.5 km instead of interrupting everyone. Switching the role lens to OPS re-ranks hazards and movements.`,
      speed: 10,
      anchor: T0 + 97 * MIN,
      enter: (h) => {
        const sim = h.sim;
        ackInterrupts(sim);
        approveKinds(sim, ['evac-notice', 'move-group', 'rescue'], 'Approved by the IC');
        const e41 = unitById(sim, 'e-41');
        if (e41 && !sim.revealed.has('f-propane')) sendTo(sim, 'e-41', sim.ctx.sites.propaneRoad, { road: true, after: 'hold', arriveBy: sim.t + 3 * MIN });
      },
      watch: (h, s, once) => {
        const sim = h.sim;
        const u = unitById(sim, 'e-41');
        const m = sim.umeta.get('e-41');
        if (u && m && m.plan.mode === 'hold' && distanceM(u.pos, sim.ctx.sites.propane) < 400 && once('e41-face')) u.heading = bearingDeg(u.pos, sim.ctx.sites.propane);
        if (s >= 14 && once('lens-ops')) {
          ops.setLens(sim, 'ops');
          say(sim, 'Role lens set to OPS: hazards and movements are weighted ×1.2, so the propane hazard and the structure group move up.');
        }
      },
    },
    {
      id: 'question',
      at: 130,
      title: 'Ask the Orchestrator',
      caption: 'The IC asks a plain question. The answer is assembled from the bus events of the last ten scenario minutes, with links to the items it mentions.',
      speed: 10,
      enter: (h) => ackInterrupts(h.sim),
      watch: (h, s, once) => {
        if (s >= 1.5 && once('ask')) ops.ask(h.sim, DEMO_QUESTION);
      },
    },
    {
      id: 'summary',
      at: 160,
      title: 'Agent work ledger',
      caption: 'In about three minutes the swarm did hours of analyst work: footage reviewed, posts screened, projections run, drafts written. Scenario built from public data; units, people and events are simulated.',
      speed: 10,
      watch: (h, s, once) => {
        if (s >= DEMO_LENGTH_S - 160 && once('end')) h.sim.paused = true;
      },
    },
  ];
}

export function beatsState(defs: BeatDef[]): DirectorState['beats'] {
  return defs.map((d) => ({ id: d.id, at: d.at, title: d.title, caption: d.caption }));
}

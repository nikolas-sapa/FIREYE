import type { Directive } from '../contracts';
import type { Sim } from '../world/sim';
import { nid } from '../world/sim';
import { addLedger } from '../agents/swarm';

type Dist<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;
export type DirectiveInput = Dist<Directive>;

const LAYOUT = new Set<Directive['kind']>(['focusStage', 'promoteFeed', 'restoreStage', 'openPanel', 'highlight', 'dimOthers']);

/**
 * Emits a directive on the bus. Layout directives from the Orchestrator become suggestions (sim.pending)
 * while settings.holdLayout is on; user-originated directives always apply.
 */
export function emitDirective(sim: Sim, input: DirectiveInput, user = false): Directive {
  const held = !user && sim.settings.holdLayout && LAYOUT.has(input.kind);
  const d = { ...input, id: nid(sim, 'dir'), at: sim.t, ...(held ? { suggested: true } : {}) } as Directive;
  sim.bus.publish({ type: 'ui.directive', at: sim.t, directive: d });
  if (held) {
    // Listed in state.directives so the UI can offer it as a suggestion; the layout is not changed.
    sim.pending = [d, ...sim.pending].slice(0, 12);
    sim.directives = [d, ...sim.directives].slice(0, 40);
    return d;
  }
  applyDirective(sim, d);
  return d;
}

export function applyDirective(sim: Sim, d: Directive): void {
  sim.directives = [d, ...sim.directives].slice(0, 40);
  switch (d.kind) {
    case 'promoteFeed':
      sim.stage = { ...sim.stage, mode: 'feed', feedId: d.feedId };
      break;
    case 'restoreStage':
      sim.stage = { mode: 'globe', dimmed: false, highlight: [] };
      break;
    case 'dimOthers':
      sim.stage = { ...sim.stage, dimmed: d.on };
      break;
    case 'highlight':
      sim.stage = { ...sim.stage, highlight: d.ids };
      break;
    case 'notify':
      addLedger(sim, 'ORCH', `Relayed to ${d.audiences.map((a) => a.toUpperCase()).join(', ')}: ${d.message}`, d.audiences.length, { notificationsRelayed: d.audiences.length });
      break;
    default:
      break;
  }
}

/** Applies a held suggestion. Camera moves are re-issued under a new id so the stage (which tracks handled ids) flies. */
export function applyPending(sim: Sim, id: string): boolean {
  const d = sim.pending.find((x) => x.id === id);
  if (!d) return false;
  sim.pending = sim.pending.filter((x) => x.id !== id);
  if (d.kind === 'focusStage') {
    applyDirective(sim, { ...d, suggested: false, id: nid(sim, 'dir'), at: sim.t, reason: `Applied suggestion · ${d.reason}` });
    return true;
  }
  switch (d.kind) {
    case 'promoteFeed':
      sim.stage = { ...sim.stage, mode: 'feed', feedId: d.feedId };
      break;
    case 'restoreStage':
      sim.stage = { mode: 'globe', dimmed: false, highlight: [] };
      break;
    case 'dimOthers':
      sim.stage = { ...sim.stage, dimmed: d.on };
      break;
    case 'highlight':
      sim.stage = { ...sim.stage, highlight: d.ids };
      break;
    default:
      break;
  }
  return true;
}

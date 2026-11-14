import type { Message } from '../contracts';
import type { Sim } from '../world/sim';
import { nid } from '../world/sim';

export function pushMessage(sim: Sim, m: Omit<Message, 'id' | 'at'> & { id?: string }): Message {
  const msg: Message = { ...m, id: m.id ?? nid(sim, 'msg'), at: sim.t };
  sim.messages = [...sim.messages, msg].slice(-60);
  sim.bus.publish({ type: 'message', at: sim.t, message: msg });
  return msg;
}

export function replaceMessage(sim: Sim, id: string, patch: Partial<Message>): void {
  let out: Message | undefined;
  sim.messages = sim.messages.map((m) => {
    if (m.id !== id) return m;
    out = { ...m, ...patch, at: sim.t };
    return out;
  });
  if (out) sim.bus.publish({ type: 'message', at: sim.t, message: out });
}

export function say(sim: Sim, text: string, refs?: string[]): Message {
  return pushMessage(sim, { role: 'orchestrator', text, refs });
}

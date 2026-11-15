import type { BusEvent } from '../contracts';
import { bus, type Bus } from './index';

/**
 * Backend seam (not used by the demo).
 *
 * A real deployment runs the agent swarm server-side (Firecrawl, fal, NASA FIRMS/GIBS, Open-Meteo/NWS,
 * Whisper, treq reasoning) and streams the exact same `BusEvent` JSON objects defined in
 * `src/console/contracts.ts` over a WebSocket, one event per message:
 *
 *   { "type": "analysis.finding", "at": 1629158400000, "finding": { ...Finding } }
 *   { "type": "ui.directive", "at": 1629158400000, "directive": { "id": "dir-12", "kind": "promoteFeed", ... } }
 *
 * This unwired seam only checks the event envelope and republishes it.
 * It does not update ConsoleState, validate payloads, authenticate users or send commands.
 * Production integration needs a validated received-event reducer and command/authority boundary.
 */
const TYPES = new Set<BusEvent['type']>([
  'source.ingested',
  'analysis.job',
  'analysis.finding',
  'projection.updated',
  'prediction.scored',
  'orchestrator.graded',
  'ui.directive',
  'action.proposed',
  'action.decided',
  'brief.updated',
  'message',
  'ledger.entry',
]);

export function isBusEvent(x: unknown): x is BusEvent {
  if (!x || typeof x !== 'object') return false;
  const o = x as { type?: unknown; at?: unknown };
  return typeof o.type === 'string' && TYPES.has(o.type as BusEvent['type']) && typeof o.at === 'number' && Number.isFinite(o.at);
}

export interface WebSocketAdapterOptions {
  /** Called for frames that are not valid BusEvents. */
  onInvalid?: (raw: unknown) => void;
  onStatus?: (s: 'connecting' | 'open' | 'closed' | 'error') => void;
  /** Reconnect delay in ms (0 disables reconnects). */
  reconnectMs?: number;
}

/** Connects to a backend event stream and republishes its events on `target`. Returns a disconnect function. */
export function connectWebSocket(url: string, target: Bus = bus, opts: WebSocketAdapterOptions = {}): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    opts.onStatus?.('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => opts.onStatus?.('open');
    ws.onerror = () => opts.onStatus?.('error');
    ws.onclose = () => {
      opts.onStatus?.('closed');
      if (!stopped && (opts.reconnectMs ?? 3000) > 0) timer = setTimeout(open, opts.reconnectMs ?? 3000);
    };
    ws.onmessage = (m) => {
      let data: unknown;
      try {
        data = JSON.parse(String(m.data));
      } catch {
        opts.onInvalid?.(m.data);
        return;
      }
      const list = Array.isArray(data) ? data : [data];
      for (const e of list) {
        if (isBusEvent(e)) target.publish(e);
        else opts.onInvalid?.(e);
      }
    };
  };
  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}

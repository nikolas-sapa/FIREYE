import type { BusEvent, Ms } from '../contracts';

export type BusListener = (e: BusEvent) => void;

/**
 * Typed pub/sub for every console event. The in-browser agents publish here today; a backend can
 * publish the same `BusEvent` objects later (see ./adapters.ts) without the UI changing.
 */
export interface Bus {
  subscribe(fn: BusListener): () => void;
  publish(e: BusEvent): void;
  /** Ring buffer contents, oldest first. */
  history(): BusEvent[];
  /** Events with `at >= t` (scenario time), oldest first. */
  since(t: Ms): BusEvent[];
  clear(): void;
  /** While muted, events are still recorded in history but listeners are not called (deterministic fast-forward). */
  setMuted(m: boolean): void;
}

export function createBus(capacity = 500): Bus {
  const ring: BusEvent[] = new Array(capacity);
  let head = 0;
  let size = 0;
  let muted = false;
  const listeners = new Set<BusListener>();
  const history = (): BusEvent[] => {
    const out: BusEvent[] = [];
    for (let i = 0; i < size; i++) out.push(ring[(head - size + i + capacity) % capacity]);
    return out;
  };
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    publish(e) {
      ring[head] = e;
      head = (head + 1) % capacity;
      size = Math.min(capacity, size + 1);
      if (muted) return;
      for (const fn of listeners) {
        try {
          fn(e);
        } catch (err) {
          console.error('[fcc bus] listener failed', err);
        }
      }
    },
    history,
    since(t) {
      return history().filter((e) => e.at >= t);
    },
    clear() {
      head = 0;
      size = 0;
    },
    setMuted(m) {
      muted = m;
    },
  };
}

/** The console-wide bus (one console per page). */
export const bus: Bus = createBus(500);

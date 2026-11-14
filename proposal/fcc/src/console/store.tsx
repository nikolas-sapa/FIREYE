import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ConsoleApi, ConsoleState, Geo, Ms } from './contracts';
import { bus } from './bus';
import { loadScenario } from './scenario';
import { emptyLedger, ops, snapshot } from './world/engine';
import { Runtime } from './world/runtime';

export { bus };
export type { Bus, BusListener } from './bus';

/** World/agents tick period (s) and how many ticks per heavy (UI panel) refresh: 10 Hz world, 5 Hz panels. */
const TICK_S = 0.1;
const HEAVY_EVERY = 2;
const MAX_FRAME_S = 0.25;

function initialState(): ConsoleState {
  return {
    ready: false,
    pack: null,
    clock: { t: 0, speed: 60, paused: false },
    units: [],
    findings: [],
    feeds: [],
    projection: null,
    items: [],
    actions: [],
    pools: [],
    jobs: [],
    ledger: emptyLedger(),
    messages: [],
    brief: { headline: 'Loading the Caldor scenario pack', bullets: [], changed: [], at: 0 },
    suggestions: [],
    directives: [],
    stage: { mode: 'globe', dimmed: false, highlight: [] },
    coverage: [],
    settings: { autonomy: 'assist', lens: 'ic', holdLayout: false, tokens: { cesium: false, google: false } },
    director: { enabled: false, beat: 0, beats: [], elapsedS: 0, captions: true },
    fireRev: 0,
  };
}

function envTokens(): ConsoleState['settings']['tokens'] {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return { cesium: !!env.VITE_CESIUM_ION_TOKEN, google: !!env.VITE_GOOGLE_MAPS_KEY };
}

class ConsoleStore {
  private state: ConsoleState = initialState();
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private users = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private ticks = 0;
  runtime: Runtime | null = null;

  get = (): ConsoleState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(heavy: boolean): void {
    const rt = this.runtime;
    if (!rt) return;
    this.state = snapshot(rt.sim, this.state.ready ? this.state : null, heavy, rt.pack);
    for (const fn of this.listeners) fn();
  }

  /** Runs a user operation against the live sim and publishes immediately. */
  private run(fn: (rt: Runtime) => void): void {
    const rt = this.runtime;
    if (!rt) return;
    fn(rt);
    this.emit(true);
  }

  attach(): () => void {
    this.users++;
    if (!this.loading) {
      this.loading = loadScenario()
        .then((pack) => {
          this.runtime = new Runtime(pack, bus, { tokens: envTokens() });
          this.emit(true);
        })
        .catch((err) => {
          console.error('[fcc] scenario load failed', err);
          this.loading = null;
        });
    }
    if (this.users === 1) this.startLoop();
    return () => {
      this.users--;
      if (this.users <= 0) this.stopLoop();
    };
  }

  private startLoop(): void {
    if (typeof window === 'undefined' || this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = window.requestAnimationFrame(frame);
      const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (!this.runtime) return;
      this.acc += dt;
      if (this.acc < TICK_S) return;
      const step = this.acc;
      this.acc = 0;
      try {
        this.runtime.tick(step);
      } catch (err) {
        console.error('[fcc] engine tick failed', err);
      }
      this.ticks++;
      this.emit(this.ticks % HEAVY_EVERY === 0);
    };
    this.raf = window.requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  readonly api: ConsoleApi = {
    setPaused: (p: boolean) => this.run((rt) => (rt.sim.paused = p)),
    setSpeed: (x: number) => this.run((rt) => (rt.sim.speed = Math.max(0.1, Math.min(3600, x)))),
    seek: (t: Ms) => this.run((rt) => rt.seek(t)),
    setAutonomy: (a) => this.run((rt) => ops.setAutonomy(rt.sim, a)),
    setLens: (l) => this.run((rt) => ops.setLens(rt.sim, l)),
    setHoldLayout: (h) => this.run((rt) => ops.setHoldLayout(rt.sim, h)),
    approve: (id) => this.run((rt) => ops.approve(rt.sim, id)),
    reject: (id) => this.run((rt) => ops.reject(rt.sim, id)),
    undo: (id) => this.run((rt) => ops.undo(rt.sim, id)),
    editDraft: (id, body) => this.run((rt) => ops.editDraft(rt.sim, id, body)),
    ask: (text) => this.run((rt) => ops.ask(rt.sim, text)),
    dismiss: (id) => this.run((rt) => ops.dismiss(rt.sim, id)),
    pin: (id) => this.run((rt) => ops.pin(rt.sim, id)),
    markSeen: (id) => this.run((rt) => ops.markSeen(rt.sim, id)),
    acknowledge: (id) => this.run((rt) => ops.acknowledge(rt.sim, id)),
    promoteFeed: (feedId) => this.run((rt) => ops.promoteFeed(rt.sim, feedId)),
    focus: (target: Geo, rangeM?: number) => this.run((rt) => ops.focus(rt.sim, target, rangeM)),
    applyDirective: (id) => this.run((rt) => ops.applyDirective(rt.sim, id)),
    director: {
      start: () => this.run((rt) => rt.director.start()),
      stop: () => this.run((rt) => rt.director.stop()),
      next: () => this.run((rt) => rt.director.next()),
      prev: () => this.run((rt) => rt.director.prev()),
      goto: (i) => this.run((rt) => rt.director.goto(i)),
      setCaptions: (on) => this.run((rt) => rt.director.setCaptions(on)),
    },
  };
}

/** The console-wide store (one console per page). */
export const consoleStore = new ConsoleStore();

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __fcc?: unknown }).__fcc = {
    store: consoleStore,
    api: consoleStore.api,
    bus,
    get runtime() {
      return consoleStore.runtime;
    },
    get sim() {
      return consoleStore.runtime?.sim;
    },
    state: () => consoleStore.get(),
  };
}

/** Loads the scenario, runs the clock (rAF) and owns the console state. */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  useEffect(() => consoleStore.attach(), []);
  return <>{children}</>;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Subscribes to a slice; re-renders only when the selected value changes (shallow reference compare). */
export function useConsoleSelector<T>(sel: (s: ConsoleState) => T): T {
  const cache = useRef<{ state: ConsoleState; sel: (s: ConsoleState) => T; value: T } | null>(null);
  const get = (): T => {
    const s = consoleStore.get();
    const c = cache.current;
    if (c && c.state === s && c.sel === sel) return c.value;
    const v = sel(s);
    if (c && shallowEqual(c.value, v)) {
      cache.current = { state: s, sel, value: c.value };
      return c.value;
    }
    cache.current = { state: s, sel, value: v };
    return v;
  };
  return useSyncExternalStore(consoleStore.subscribe, get, get);
}

export function useConsoleApi(): ConsoleApi {
  return consoleStore.api;
}

/** Whole state + api (re-renders on every store update; prefer useConsoleSelector in panels). */
export function useConsole(): { state: ConsoleState; api: ConsoleApi } {
  const state = useSyncExternalStore(consoleStore.subscribe, consoleStore.get, consoleStore.get);
  return { state, api: consoleStore.api };
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createSimulation } from './engine';
import type { SimEngine, SimSnapshot } from './types';

interface Store {
  engine: SimEngine;
  version: number;
  subscribe(fn: () => void): () => void;
  getVersion(): number;
}

const SimContext = createContext<Store | null>(null);

function createStore(engine: SimEngine): Store {
  const listeners = new Set<() => void>();
  const store: Store = {
    engine,
    version: 0,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    getVersion: () => store.version,
  };
  engine.subscribe(() => {
    store.version++;
    for (const fn of listeners) fn();
  });
  return store;
}

export interface SimProviderProps {
  children: ReactNode;
  seed?: number;
  /** Start running immediately (default true). When false the engine starts paused. */
  autoStart?: boolean;
}

/** Owns one simulation engine and drives it with requestAnimationFrame. */
export function SimProvider({ children, seed = 7, autoStart = true }: SimProviderProps) {
  const ref = useRef<Store | null>(null);
  if (!ref.current) {
    const engine = createSimulation(seed);
    if (!autoStart) engine.setPaused(true);
    ref.current = createStore(engine);
  }
  const store = ref.current;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) return;
      store.engine.tick(dt);
    };
    const onVis = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [store]);

  return <SimContext.Provider value={store}>{children}</SimContext.Provider>;
}

function useStore(): Store {
  const s = useContext(SimContext);
  if (!s) throw new Error('useSim/useSimEngine must be used inside <SimProvider>');
  return s;
}

export interface SimApi {
  engine: SimEngine;
  /** Live snapshot (same object between notifications; arrays replaced on change). */
  state: SimSnapshot;
  /** Increments on every engine notification (~4 Hz while running). */
  version: number;
  paused: boolean;
  speed: number;
  setPaused(p: boolean): void;
  setSpeed(mult: number): void;
  accept(recId: string): void;
  dismiss(recId: string): void;
  reset(): void;
}

/** Re-renders on throttled engine notifications (~4 Hz). */
export function useSim(): SimApi {
  const store = useStore();
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const { engine } = store;
  const setPaused = useCallback((p: boolean) => engine.setPaused(p), [engine]);
  const setSpeed = useCallback((m: number) => engine.setSpeed(m), [engine]);
  const accept = useCallback((id: string) => engine.accept(id), [engine]);
  const dismiss = useCallback((id: string) => engine.dismiss(id), [engine]);
  const reset = useCallback(() => engine.reset(), [engine]);
  return useMemo(
    () => ({ engine, state: engine.state, version, paused: engine.paused, speed: engine.speed, setPaused, setSpeed, accept, dismiss, reset }),
    [engine, version, setPaused, setSpeed, accept, dismiss, reset],
  );
}

/** Engine reference without subscribing; for renderers that read `engine.state` every frame. */
export function useSimEngine(): SimEngine {
  return useStore().engine;
}

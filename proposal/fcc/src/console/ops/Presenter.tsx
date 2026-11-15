import { useSyncExternalStore } from 'react';
import { cn } from '@ds';
import { consoleStore, useConsoleApi } from '../store';
import { localTime, packZone } from '../ui/format';
import { placeAlerts, routeRoads, STAGE_RANK, type EscapeRoute } from './alerts';
import { opsView } from './view';

export interface Caption { id: number; title: string; sub?: string; t: number }

let capSeq = 0;
const listeners = new Set<() => void>();
let presenting = false;
let caption: Caption | null = null;
let snapshot: { on: boolean; caption: Caption | null } = { on: false, caption: null };
let seenKeys = new Set<string>();
let slowTimer: number | null = null;
let capTimer: number | null = null;
let offStore: (() => void) | null = null;

const bump = () => { snapshot = { on: presenting, caption }; listeners.forEach((f) => f()); };

function showCaption(title: string, sub?: string) {
  caption = { id: ++capSeq, title, sub, t: Date.now() };
  bump();
  if (capTimer) window.clearTimeout(capTimer);
  capTimer = window.setTimeout(() => { caption = null; bump(); }, 7000);
}

export function startPresenter(opts: { api: ReturnType<typeof useConsoleApi>; switchView?: boolean }) {
  if (presenting) return;
  presenting = true;
  seenKeys = new Set();
  const s0 = consoleStore.get();
  const ignition = (s0.pack?.manifest as { ignition?: { t?: number } } | undefined)?.ignition?.t;
  const ctxStart = s0.pack ? s0.pack.manifest.start : 0;
  if (ignition) opts.api.seek(Math.max(ctxStart, ignition - 8 * 60000));
  opts.api.setPaused(false);
  opts.api.setSpeed(180);
  bump();

  const slow = (key: string, title: string, sub?: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    showCaption(title, sub);
    if (slowTimer) window.clearTimeout(slowTimer);
    opts.api.setSpeed(10);
    slowTimer = window.setTimeout(() => { if (presenting) opts.api.setSpeed(180); }, 7000);
  };

  const check = () => {
    const s = consoleStore.get();
    if (!s.pack) return;
    const z = packZone(s.pack).label;
    const firstFinding = s.findings[0];
    if (firstFinding && !seenKeys.has('finding')) slow('finding', 'Detection', firstFinding.label);
    if (s.projection && !seenKeys.has('proj')) {
      const firstEta = Object.entries(s.projection.etaToPlaces).sort((a, b) => a[1] - b[1])[0];
      const name = firstEta ? (s.pack.manifest.places.find((p) => p.id === firstEta[0])?.name ?? firstEta[0]) : null;
      slow('proj', 'Projection', name ? `Fire reaches ${name} by ${localTime(firstEta![1], z)}` : 'Spread forecast issued');
    }
    // ETA moved earlier by >10 min vs the previous seen revision.
    if (s.projection) {
      for (const [id, eta] of Object.entries(s.projection.etaToPlaces)) {
        const key = `eta:${id}`;
        const prev = prevEtas.get(id);
        prevEtas.set(id, eta);
        if (prev != null && prev - eta > 10 * 60000 && !seenKeys.has(key)) {
          const name = s.pack.manifest.places.find((p) => p.id === id)?.name ?? id;
          slow(key, 'Wind shift', `ETA for ${name} moved earlier · now ${localTime(eta, z)}`);
        }
      }
    }
    for (const p of placeAlerts(s.pack, s.clock.t)) {
      if (p.stage === 'prepare' && !seenKeys.has(`prep:${p.id}`)) slow(`prep:${p.id}`, 'Alert', `${p.name} · PREPARE TO LEAVE · SMS + calls to ~${p.residents}`);
      if (STAGE_RANK[p.stage] >= 2 && !seenKeys.has(`leave:${p.id}`)) {
        slow(`leave:${p.id}`, 'LEAVE NOW', `${p.name} · SMS + calls to ~${p.residents} residents`);
        if (opts.switchView && opsView.get() !== 'civilian') opsView.set('civilian');
      }
    }
    const proposed = s.actions.find((a) => a.status === 'proposed');
    if (proposed && !seenKeys.has('action')) slow('action', 'Orchestrator proposes', proposed.title);
    const r = lastRoute;
    if (r && !seenKeys.has('route')) slow('route', 'Route out', `${r.exit.label} via ${routeRoads(r).slice(0, 2).join(' → ')}`);
  };
  offStore = consoleStore.subscribe(check);
}

const prevEtas = new Map<string, number>();
let lastRoute: EscapeRoute | null = null;
export function noteRoute(r: EscapeRoute | null) { lastRoute = r; }

export function stopPresenter() {
  presenting = false;
  caption = null;
  if (slowTimer) window.clearTimeout(slowTimer);
  if (capTimer) window.clearTimeout(capTimer);
  offStore?.(); offStore = null;
  bump();
}

export const presenter = {
  get: () => snapshot,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
const ON = { on: true, caption: null as Caption | null };
const OFF = { on: false, caption: null as Caption | null };
export function usePresenter(): { on: boolean; caption: Caption | null } {
  const s = useSyncExternalStore(presenter.subscribe, presenter.get, presenter.get);
  return s.on ? { ...ON, caption: s.caption } : OFF;
}

/** Caption banner rendered at the bottom of the stage while presenting. */
export function PresenterCaption() {
  const { caption } = usePresenter();
  return (
    <div aria-live="polite" className={cn('pointer-events-none absolute inset-x-0 bottom-8 z-[4] flex justify-center transition-opacity duration-base ease-servo', caption ? 'opacity-100' : 'opacity-0')}>
      {caption && (
        <div className="border border-line-strong bg-ink-950/90 px-6 py-3 text-center shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-bone">{caption.title}</div>
          {caption.sub && <div className="mt-1 font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">{caption.sub}</div>}
        </div>
      )}
    </div>
  );
}
